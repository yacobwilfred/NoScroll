import { useState } from "react";
import { createPortal } from "react-dom";
import { fetchGoogleHealthToday } from "../api";
import { hoursSinceWake } from "../cognitive";

const WAKE_OPTIONS = [
  { label: "Just woke up", value: 0.5 },
  { label: "1–2 hrs ago",  value: 1.5 },
  { label: "2–4 hrs ago",  value: 3 },
  { label: "4–6 hrs ago",  value: 5 },
  { label: "6+ hrs ago",   value: 7 },
];

const MEAL_OPTIONS = [
  { label: "Currently eating",     value: 0.25 },
  { label: "~30–60 min ago",       value: 0.75 },
  { label: "1–2 hrs ago",          value: 1.5 },
  { label: "2–4 hrs ago",          value: 3 },
  { label: "4+ hrs ago / fasted",  value: 5 },
];

const CAFFEINE_OPTIONS = [
  { label: "None today",   value: null },
  { label: "~30 min ago",  value: 0.5 },
  { label: "~1–2 hrs ago", value: 1.5 },
  { label: "3–4 hrs ago",  value: 3.5 },
  { label: "5+ hrs ago",   value: 6 },
];

function ManualSlider({ label, min, max, step, value, unit, onChange }) {
  return (
    <div className="setup-field">
      <label className="setup-label">{label}</label>
      <div className="setup-slider-row">
        <input
          type="range" min={min} max={max} step={step}
          value={value}
          onChange={e => onChange(+e.target.value)}
          className="setup-slider"
        />
        <span className="setup-slider-val">{value}{unit}</span>
      </div>
    </div>
  );
}

export default function CognitiveSettings({ config, onChange, onClose }) {
  const [fitbitStatus, setFitbitStatus] = useState(config.fitbit ? "ok" : "idle"); // idle | loading | ok | error
  const [fitbitError, setFitbitError]   = useState("");

  const {
    bioMode = "fitbit",
    fitbit = null,
    manual = { rmssd: 45, restingHr: 60, sleepScore: 75 },
    hoursSinceWaking = 3,
    lastMealHrsAgo = 3,
    caffeineHrsAgo = null,
    cameraEnabled = false,
  } = config;

  async function handleFitbitRefresh() {
    setFitbitStatus("loading");
    setFitbitError("");
    try {
      const data = await fetchGoogleHealthToday();
      onChange({
        fitbit: {
          rmssd:      data.rmssd ?? null,
          restingHr:  data.restingHr ?? null,
          sleepScore: data.sleepScore ?? null,
          wakeTime:   data.wakeTime ?? null,
        },
      });
      setFitbitStatus("ok");
    } catch (e) {
      setFitbitError(e?.message || "Could not connect.");
      setFitbitStatus("error");
    }
  }

  function setManual(patch) {
    onChange({ manual: { ...manual, ...patch } });
  }

  // In Fitbit mode, wake-up time can come straight from last night's sleep.
  const autoWakeHrs = bioMode === "fitbit" ? hoursSinceWake(fitbit?.wakeTime) : null;
  const wakeClock = autoWakeHrs != null
    ? new Date(fitbit.wakeTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  return createPortal(
    <div className="cs-overlay" onMouseDown={onClose}>
      <div className="setup-card cs-card" onMouseDown={e => e.stopPropagation()}>
        <div className="cs-header">
          <div>
            <span className="setup-logo">NoScroll</span>
            <h2 className="setup-title">Cognitive Meter settings</h2>
          </div>
          <button className="cm-panel-close" onClick={onClose}>✕</button>
        </div>

        {/* ── Biometrics ───────────────────────────────────────── */}
        <div className="setup-body">
          <div className="setup-field">
            <p className="setup-section-label">Biometric source</p>
            <div className="cs-mode-toggle">
              <button
                className={`cs-mode-btn ${bioMode === "fitbit" ? "cs-mode-btn--active" : ""}`}
                onClick={() => onChange({ bioMode: "fitbit" })}
              >Fitbit</button>
              <button
                className={`cs-mode-btn ${bioMode === "manual" ? "cs-mode-btn--active" : ""}`}
                onClick={() => onChange({ bioMode: "manual" })}
              >Manual</button>
            </div>
          </div>

          {bioMode === "fitbit" ? (
            <div className="setup-field">
              <button
                className={`setup-fitbit-btn ${fitbitStatus === "ok" ? "setup-fitbit-btn--ok" : ""}`}
                onClick={handleFitbitRefresh}
                disabled={fitbitStatus === "loading"}
              >
                {fitbitStatus === "loading"
                  ? "Fetching latest data…"
                  : fitbitStatus === "ok"
                  ? "✓ Synced — refresh"
                  : "Connect Fitbit Charge 6"}
              </button>
              {fitbit && (
                <div className="setup-fitbit-stats">
                  {fitbit.rmssd != null     && <span>HRV {Math.round(fitbit.rmssd)} ms</span>}
                  {fitbit.restingHr != null && <span>Resting HR {fitbit.restingHr} bpm</span>}
                  {fitbit.sleepScore != null && <span>Sleep {fitbit.sleepScore}</span>}
                </div>
              )}
              {fitbitStatus === "error" && <p className="setup-error">{fitbitError}</p>}
              <p className="setup-hint">
                Pulls last night&apos;s HRV, resting heart rate and sleep via the Google Health API.
              </p>
            </div>
          ) : (
            <>
              <ManualSlider
                label="HRV (RMSSD)" min={10} max={120} step={1}
                value={manual.rmssd} unit=" ms"
                onChange={v => setManual({ rmssd: v })}
              />
              <ManualSlider
                label="Resting heart rate" min={40} max={100} step={1}
                value={manual.restingHr} unit=" bpm"
                onChange={v => setManual({ restingHr: v })}
              />
              <ManualSlider
                label="Sleep score" min={0} max={100} step={1}
                value={manual.sleepScore} unit=""
                onChange={v => setManual({ sleepScore: v })}
              />
              <p className="setup-hint">Override values to simulate different states.</p>
            </>
          )}
        </div>

        {/* ── Context ──────────────────────────────────────────── */}
        <div className="setup-body">
          <div className="setup-field">
            <label className="setup-label">When did you wake up?</label>
            {autoWakeHrs != null ? (
              <div className="cs-auto-value">
                <span className="cs-auto-badge">Fitbit</span>
                Woke at {wakeClock} · {autoWakeHrs.toFixed(1)}h ago
              </div>
            ) : (
              <div className="setup-chips">
                {WAKE_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    className={`setup-chip ${hoursSinceWaking === o.value ? "setup-chip--active" : ""}`}
                    onClick={() => onChange({ hoursSinceWaking: o.value })}
                  >{o.label}</button>
                ))}
              </div>
            )}
          </div>

          <div className="setup-field">
            <label className="setup-label">Last meal?</label>
            <div className="setup-chips">
              {MEAL_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`setup-chip ${lastMealHrsAgo === o.value ? "setup-chip--active" : ""}`}
                  onClick={() => onChange({ lastMealHrsAgo: o.value })}
                >{o.label}</button>
              ))}
            </div>
          </div>

          <div className="setup-field">
            <label className="setup-label">Caffeine today?</label>
            <div className="setup-chips">
              {CAFFEINE_OPTIONS.map(o => (
                <button
                  key={String(o.value)}
                  className={`setup-chip ${caffeineHrsAgo === o.value ? "setup-chip--active" : ""}`}
                  onClick={() => onChange({ caffeineHrsAgo: o.value })}
                >{o.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Camera ───────────────────────────────────────────── */}
        <div className="setup-body">
          <div className="setup-camera-card">
            <div className="setup-camera-icon">👁</div>
            <h3>Real-time fatigue tracking</h3>
            <p>
              Uses your webcam to measure blink rate and PERCLOS — two validated
              indicators of cognitive fatigue. Video never leaves your device.
            </p>
            <button
              className={`setup-camera-toggle ${cameraEnabled ? "setup-camera-toggle--on" : ""}`}
              onClick={() => onChange({ cameraEnabled: !cameraEnabled })}
            >
              {cameraEnabled ? "✓ Enabled" : "Enable camera tracking"}
            </button>
          </div>
        </div>

        <div className="cs-footer">
          <button className="setup-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
