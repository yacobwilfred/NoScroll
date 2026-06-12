"""
google_health.py
────────────────
Server-side integration with the Google Health API (the successor to the
Fitbit Web API, which sunsets September 2026). Reads a Fitbit Charge 6's
overnight metrics — HRV (RMSSD), resting heart rate, and sleep — and maps
them into the shape the frontend Cognitive Meter model expects:

    { rmssd, restingHr, sleepScore, sleepMinutes }

Credentials are read from environment variables (or backend/.env):
    GOOGLE_HEALTH_CLIENT_ID
    GOOGLE_HEALTH_CLIENT_SECRET
    GOOGLE_HEALTH_REFRESH_TOKEN

The refresh token is exchanged for short-lived access tokens on demand
(cached in-memory until ~1 min before expiry).
"""

import os
import json
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

TOKEN_URL = "https://oauth2.googleapis.com/token"
BASE_URL  = "https://health.googleapis.com/v4/users/me/dataTypes"

_token_cache = {"access_token": None, "expires_at": 0.0}


class GoogleHealthError(Exception):
    """Raised for configuration or auth problems the user can act on."""


# ── .env loader (minimal, no dependency) ──────────────────────────────────────

def _load_env_file() -> None:
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_env_file()


# ── OAuth token refresh ───────────────────────────────────────────────────────

def _get_access_token() -> str:
    now = time.time()
    if _token_cache["access_token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["access_token"]

    client_id     = os.environ.get("GOOGLE_HEALTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_HEALTH_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_HEALTH_REFRESH_TOKEN")

    if not (client_id and client_secret and refresh_token):
        raise GoogleHealthError(
            "Missing Google Health credentials. Set GOOGLE_HEALTH_CLIENT_ID, "
            "GOOGLE_HEALTH_CLIENT_SECRET and GOOGLE_HEALTH_REFRESH_TOKEN in backend/.env"
        )

    data = urllib.parse.urlencode({
        "client_id":     client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type":    "refresh_token",
    }).encode()

    req = urllib.request.Request(
        TOKEN_URL, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise GoogleHealthError(f"Token refresh failed ({e.code}): {detail}")
    except Exception as e:
        raise GoogleHealthError(f"Token refresh failed: {e}")

    access = payload.get("access_token")
    if not access:
        raise GoogleHealthError(f"Token response missing access_token: {payload}")

    _token_cache["access_token"] = access
    _token_cache["expires_at"]   = now + payload.get("expires_in", 3599)
    return access


# ── Data point listing ────────────────────────────────────────────────────────

def _list_data_points(data_type: str, access_token: str, filter_str=None, page_size: int = 25):
    # Standard List maps to `GET .../dataPoints` (no `:list` suffix).
    params = {"pageSize": page_size}
    if filter_str:
        params["filter"] = filter_str
    url = f"{BASE_URL}/{data_type}/dataPoints?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        e.detail_body = e.read().decode(errors="replace")  # attach body for callers
        raise


def _safe_list(data_type: str, access_token: str, filter_str, page_size: int = 25):
    """
    List data points. Auth/permission errors (401/403) propagate as
    GoogleHealthError so the user sees a clear message; a bad filter (400)
    retries without the filter; anything else degrades to [].
    """
    try:
        return _list_data_points(data_type, access_token, filter_str, page_size).get("dataPoints", [])
    except urllib.error.HTTPError as e:
        body = getattr(e, "detail_body", "")
        if e.code in (401, 403):
            raise GoogleHealthError(f"Google Health API permission error ({e.code}): {body[:400]}")
        if e.code == 400:
            try:
                return _list_data_points(data_type, access_token, None, page_size).get("dataPoints", [])
            except Exception:
                pass
        print(f"[google_health] {data_type} failed: {e.code} {body[:200]}")
        return []
    except Exception as e:
        print(f"[google_health] {data_type} failed: {e}")
        return []


# ── Parsing helpers ───────────────────────────────────────────────────────────

def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _date_key(date_obj) -> str:
    """Turn a {year, month, day} object into a sortable 'YYYY-MM-DD' string."""
    if not isinstance(date_obj, dict):
        return ""
    return f"{date_obj.get('year', 0):04d}-{date_obj.get('month', 0):02d}-{date_obj.get('day', 0):02d}"


def _latest_hrv(points):
    """RMSSD in ms from the most recent daily-heart-rate-variability point."""
    best = None
    for p in points:
        d = p.get("dailyHeartRateVariability")
        if not d:
            continue
        rmssd = _to_float(d.get("averageHeartRateVariabilityMilliseconds"))
        if rmssd is None:
            continue
        key = _date_key(d.get("date"))
        if best is None or key > best[0]:
            best = (key, rmssd)
    return best[1] if best else None


def _latest_resting_hr(points):
    """Resting HR (bpm) from the most recent daily-resting-heart-rate point."""
    best = None
    for p in points:
        d = p.get("dailyRestingHeartRate")
        if not d:
            continue
        bpm = _to_float(d.get("beatsPerMinute"))
        if bpm is None:
            continue
        key = _date_key(d.get("date"))
        if best is None or key > best[0]:
            best = (key, bpm)
    return round(best[1]) if best else None


def _derive_sleep_score(points):
    """
    Google Health gives sleep sessions/stages, not a 0–100 score, so we derive one:
        score = 60% × duration_factor + 40% × stage_quality_factor
      duration_factor       = minutesAsleep / 480 (8h ideal), capped at 1
      stage_quality_factor  = (deep+REM share of sleep) / 0.45 ideal, capped at 1
    Returns (score 0–100, minutesAsleep, wakeTime) where wakeTime is the ISO
    end-of-sleep timestamp of the most recent overnight session (≈ when the
    user woke up).
    """
    best = None  # (endTime, summary)
    for p in points:
        s = p.get("sleep")
        if not s:
            continue
        meta = s.get("metadata") or {}
        if meta.get("nap"):
            continue  # ignore naps — we want the main overnight sleep
        summary = s.get("summary") or {}
        if _to_float(summary.get("minutesAsleep")) is None:
            continue
        end = (s.get("interval") or {}).get("endTime", "")
        if best is None or end > best[0]:
            best = (end, summary)

    if not best:
        return None, None, None

    end_time = best[0] or None
    summary  = best[1]
    asleep   = _to_float(summary.get("minutesAsleep")) or 0.0
    if asleep <= 0:
        return None, None, end_time

    deep_rem = sum(
        _to_float(st.get("minutes")) or 0.0
        for st in (summary.get("stagesSummary") or [])
        if st.get("type") in ("DEEP", "REM")
    )

    duration_factor = min(1.0, asleep / 480.0)
    quality_factor  = min(1.0, (deep_rem / asleep) / 0.45) if deep_rem else 0.5
    score = round(100 * (0.60 * duration_factor + 0.40 * quality_factor))
    return score, round(asleep), end_time


# ── Public entry point ────────────────────────────────────────────────────────

def get_today() -> dict:
    """
    Fetch the most recent HRV, resting HR and sleep, mapped to the model shape.
    Uses a 7-day lookback so we still get data if last night hasn't synced yet.
    """
    access = _get_access_token()

    lookback   = datetime.now(timezone.utc) - timedelta(days=7)
    date_str   = lookback.strftime("%Y-%m-%d")
    dt_str     = lookback.strftime("%Y-%m-%dT00:00:00Z")

    # Filter field names per the API reference:
    #   • daily summaries → camelCase data-type + ".date"
    #   • sleep sessions  → "sleep.interval.end_time" (start_time not supported for sleep)
    hrv_points   = _safe_list("daily-heart-rate-variability", access,
                              f'dailyHeartRateVariability.date >= "{date_str}"')
    rhr_points   = _safe_list("daily-resting-heart-rate", access,
                              f'dailyRestingHeartRate.date >= "{date_str}"')
    sleep_points = _safe_list("sleep", access,
                              f'sleep.interval.end_time >= "{dt_str}"')

    sleep_score, sleep_minutes, wake_time = _derive_sleep_score(sleep_points)

    return {
        "rmssd":        _latest_hrv(hrv_points),
        "restingHr":    _latest_resting_hr(rhr_points),
        "sleepScore":   sleep_score,
        "sleepMinutes": sleep_minutes,
        "wakeTime":     wake_time,   # ISO end-of-sleep ≈ wake-up time, or null
    }
