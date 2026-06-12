/**
 * Cognitive Meter — heuristic model (Path A)
 *
 * Outputs a 0–4 hour "deep work capacity" estimate from:
 *   - Biometrics  (HRV, sleep score, resting HR)
 *   - Circadian   (time since waking)
 *   - Alertness   (PERCLOS + blink rate from webcam)
 *   - Glucose     (approximated from meal timing)
 *   - Task load   (time spent in current session)
 *
 * All intermediate values are 0–1. Final score × 4 = hours remaining.
 */

// ── helpers ───────────────────────────────────────────────────────────────────

/** Clamp-normalize value between min and max → 0–1 */
function norm(value, min, max) {
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// ── biometric score ───────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {number|null} params.rmssd       - HRV in ms (raw). Population norms: poor~15, avg~45, great~75+
 * @param {number|null} params.sleepScore  - 0–100 sleep quality score
 * @param {number|null} params.restingHr   - BPM. Poor~85+, avg~65, great~45
 */
export function computeBiometricScore({
  rmssd = null,
  sleepScore = null,
  restingHr = null,
}) {
  // HRV — raw RMSSD, or a neutral assumption when unavailable
  const hrvScore = rmssd !== null
    ? norm(rmssd, 15, 75)
    : 0.65; // unknown → assume slightly above average

  // Sleep — raw 0–100 score, or a neutral assumption
  const sleepS = sleepScore !== null
    ? sleepScore / 100
    : 0.70;

  // HR — lower is better
  const hrScore = restingHr !== null
    ? norm(restingHr, 85, 45) // inverted: 85bpm→0, 45bpm→1
    : 0.65;

  return 0.50 * hrvScore + 0.30 * sleepS + 0.20 * hrScore;
}

/**
 * Convert a wake-up timestamp (ISO string, e.g. Fitbit sleep end time) into
 * "hours since waking". Returns null when the value is missing, unparseable,
 * or stale (not plausibly today's wake — negative or > 20h ago), so callers
 * can fall back to a manual estimate.
 *
 * @param {string|null} wakeTimeISO
 * @param {number} now - epoch ms (injectable for testing)
 */
export function hoursSinceWake(wakeTimeISO, now = Date.now()) {
  if (!wakeTimeISO) return null;
  const t = new Date(wakeTimeISO).getTime();
  if (Number.isNaN(t)) return null;
  const h = (now - t) / 3_600_000;
  if (h < 0 || h > 20) return null; // stale / hasn't synced today
  return h;
}

// ── circadian factor ──────────────────────────────────────────────────────────

/**
 * Approximates cognitive performance curve relative to waking time.
 * Based on circadian rhythm research (Folkard & Monk, 1985; Van Dongen, 2003).
 *
 * @param {number|null} hoursSinceWaking
 */
export function computeCircadianFactor(hoursSinceWaking) {
  if (hoursSinceWaking === null) return 0.88; // unknown → conservative estimate
  if (hoursSinceWaking < 1)  return 0.60; // still waking up
  if (hoursSinceWaking < 2)  return 0.82; // warming up
  if (hoursSinceWaking <= 5) return 1.00; // peak window
  if (hoursSinceWaking <= 7) return 0.85; // post-lunch dip
  if (hoursSinceWaking <= 11) return 0.90; // second wind
  return 0.72;                              // evening decline
}

// ── glucose factor (approximated from meal timing) ───────────────────────────

/**
 * Estimates glucose stability from time since last meal.
 * Post-meal spike (30–90 min) temporarily impairs sustained focus.
 *
 * @param {number|null} lastMealHrsAgo
 */
export function computeGlucoseFactor(lastMealHrsAgo) {
  if (lastMealHrsAgo === null) return 0.90; // unknown → assume stable
  if (lastMealHrsAgo < 0.5)   return 0.78; // eating / just finished
  if (lastMealHrsAgo < 1.5)   return 0.65; // glucose spike period
  if (lastMealHrsAgo < 2.5)   return 0.82; // returning to baseline
  return 1.00;                              // stable baseline (fasted 2.5h+)
}

// ── caffeine factor ───────────────────────────────────────────────────────────

/**
 * Caffeine blocks adenosine, reducing perceived fatigue.
 * Peak effect 30–120min after intake; half-life ~5hrs.
 *
 * @param {number|null} caffeineHrsAgo  null = no caffeine today
 */
export function computeCaffeineFactor(caffeineHrsAgo) {
  if (caffeineHrsAgo === null) return 0.0;  // no boost
  if (caffeineHrsAgo < 0.5)   return 0.05; // too recent — minimal absorption
  if (caffeineHrsAgo < 2.0)   return 0.12; // near peak
  if (caffeineHrsAgo < 4.0)   return 0.08; // post-peak, still active
  if (caffeineHrsAgo < 7.0)   return 0.04; // fading
  return 0.0;                               // fully metabolised
}

// ── alertness from facial tracking ───────────────────────────────────────────

/**
 * @param {number} perclos      - fraction of frames eye is closed (0–1); normal <0.08
 * @param {number} blinkRate    - blinks per minute; normal 12–20, fatigued 20–35+
 */
export function computeAlertnessScore(perclos, blinkRate) {
  const perclosScore = norm(perclos, 0, 0.30);         // 0 = alert, 1 = very drowsy
  const blinkScore   = norm(blinkRate, 12, 35);        // 0 = normal, 1 = very fatigued
  const fatigueScore = 0.70 * perclosScore + 0.30 * blinkScore;
  return 1 - fatigueScore; // alertness (higher = better)
}

// ── combined meter ────────────────────────────────────────────────────────────

/**
 * Main entry point. Returns the cognitive meter result.
 *
 * @param {object} params
 * @returns {{ score: number, hoursRemaining: number, breakdown: object }}
 */
export function computeCognitiveMeter({
  // Biometrics (raw values from wearable / Fitbit via Google Health)
  rmssd = null,
  sleepScore = null,
  restingHr = null,
  // Circadian
  hoursSinceWaking = null,
  // Glucose approximation
  lastMealHrsAgo = null,
  // Caffeine
  caffeineHrsAgo = null,
  // Facial tracking
  perclos = 0,
  blinkRate = 15,
  cameraEnabled = false,
  // Consumption — hours of focus already spent engaging with content this session
  energySpent = 0,
}) {
  const biometric   = computeBiometricScore({ rmssd, sleepScore, restingHr });
  const circadian   = computeCircadianFactor(hoursSinceWaking);
  const glucose     = computeGlucoseFactor(lastMealHrsAgo);
  const caffeine    = computeCaffeineFactor(caffeineHrsAgo);
  const alertness   = cameraEnabled
    ? computeAlertnessScore(perclos, blinkRate)
    : 0.85; // assume decent if no camera

  // Capacity = the focus battery you START a session with. Weights are the
  // original four physiological factors renormalized to sum to 1 (the old
  // 0.15 "depletion" weight was removed — consumption is now a direct debit).
  const capacityBase = (
    0.35294 * biometric +
    0.23529 * circadian +
    0.23529 * alertness +
    0.17647 * glucose
  );
  const capacityScore  = Math.min(1, Math.max(0, capacityBase + caffeine));
  const startingHours  = Math.round(capacityScore * 40) / 10; // 0–4.0

  // Engaging with content debits its cognitive-load-worth of hours directly.
  const remaining      = Math.max(0, startingHours - energySpent);
  const hoursRemaining = Math.round(remaining * 10) / 10;
  const score          = Math.min(1, Math.max(0, remaining / 4));

  return {
    score,
    hoursRemaining,
    startingHours,
    energySpent,
    breakdown: { biometric, circadian, alertness, glucose, caffeine },
  };
}

/** Content focus-cost tier for styling (hours of cognitive load). */
export function focusCostTier(clHours) {
  if (!clHours) return null;
  if (clHours < 0.25) return "low";
  if (clHours < 1.0) return "mid";
  return "high";
}
