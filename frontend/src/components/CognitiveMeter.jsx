import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import FacialTracker from "./FacialTracker";

const EAR_THRESHOLD = 0.20;
const RING_SIZE = 88;
const RING_STROKE = 6;
const TICK_COUNT = 12;
const TICK_GAP_DEG = 3.5;

function getMeterColor(score) {
  if (score >= 0.70) return "#57c98a";
  if (score >= 0.40) return "#f5a623";
  return "#e87676";
}

function getDrowsinessLevel(perclos) {
  if (perclos < 0.04) return { label: "Alert",             color: "#57c98a" };
  if (perclos < 0.08) return { label: "Slightly tired",    color: "#9dba69" };
  if (perclos < 0.15) return { label: "Moderately drowsy", color: "#f5a623" };
  return                     { label: "Drowsy",             color: "#e87676" };
}

function tickArcPath(cx, cy, r, index, total, gapDeg) {
  const span = 360 / total;
  const pad = gapDeg / 2;
  const start = -90 + index * span + pad;
  const end = -90 + (index + 1) * span - pad;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(start));
  const y1 = cy + r * Math.sin(toRad(start));
  const x2 = cx + r * Math.cos(toRad(end));
  const y2 = cy + r * Math.sin(toRad(end));
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

function CircularBatteryRing({ ratio, color, size = RING_SIZE, stroke = RING_STROKE, className = "", children }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const filledTicks = clamped <= 0 ? 0 : Math.max(1, Math.round(clamped * TICK_COUNT));

  return (
    <div className={`cm-ring ${className}`} style={{ width: size, height: size }}>
      <svg className="cm-ring__svg" width={size} height={size} aria-hidden="true">
        {Array.from({ length: TICK_COUNT }, (_, i) => {
          const filled = i < filledTicks;
          return (
            <path
              key={i}
              className={`cm-ring__tick ${filled ? "cm-ring__tick--filled" : "cm-ring__tick--empty"}`}
              d={tickArcPath(cx, cy, r, i, TICK_COUNT, TICK_GAP_DEG)}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              style={{ stroke: filled ? color : "rgba(28, 24, 20, 0.14)" }}
            />
          );
        })}
      </svg>
      <div className="cm-ring__center">{children}</div>
    </div>
  );
}

function DockStats({ hoursRemaining, energySpent, draining, drowsiness, cameraEnabled, trackerStatus }) {
  const alertnessLabel = cameraEnabled && trackerStatus === "running"
    ? drowsiness.label
    : "Focus capacity";

  return (
    <div className="cm-ring-btn__stats">
      <div className="cm-ring-btn__hours">
        {hoursRemaining}
        <span className="cm-ring-btn__unit">h left</span>
      </div>
      {energySpent > 0.001 && (
        <span className={`cm-ring-btn__spent ${draining ? "cm-spent--pulse" : ""}`}>
          −{energySpent.toFixed(2)}h spent
        </span>
      )}
      <span
        className="cm-ring-btn__alertness"
        style={{ color: cameraEnabled && trackerStatus === "running" ? drowsiness.color : undefined }}
      >
        {alertnessLabel}
      </span>
    </div>
  );
}

function BreakdownRow({ label, value }) {
  return (
    <div className="cm-breakdown-row">
      <span className="cm-breakdown-label">{label}</span>
      <div className="cm-breakdown-bar-track">
        <div className="cm-breakdown-bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="cm-breakdown-pct">{Math.round(value * 100)}%</span>
    </div>
  );
}

function LiveStatRow({ label, value, unit, bar, barColor }) {
  return (
    <div className="cm-live-row">
      <span className="cm-live-label">{label}</span>
      {bar !== undefined ? (
        <div className="cm-live-bar-track">
          <div className="cm-live-bar-fill" style={{ width: `${Math.round(bar * 100)}%`, background: barColor }} />
        </div>
      ) : null}
      <span className="cm-live-value">{value}{unit}</span>
    </div>
  );
}

function CameraCenter({ cameraEnabled, trackerStatus, previewCanvas, drowsiness }) {
  if (!cameraEnabled) {
    return (
      <div className="cm-ring__placeholder" aria-hidden="true">
        <span className="cm-ring__placeholder-icon">👁</span>
      </div>
    );
  }

  if (trackerStatus === "loading") {
    return <div className="cm-ring__placeholder cm-ring__placeholder--loading">…</div>;
  }

  if (trackerStatus === "denied" || trackerStatus === "error") {
    return (
      <div className="cm-ring__placeholder cm-ring__placeholder--error" title="Camera unavailable">
        ✕
      </div>
    );
  }

  return (
    <div className="cm-ring__preview">
      <canvas
        ref={previewCanvas}
        className="cm-ring__canvas"
        width={128}
        height={128}
      />
      {trackerStatus === "running" && (
        <span
          className="cm-ring__status"
          style={{ background: drowsiness.color }}
          title={drowsiness.label}
        />
      )}
    </div>
  );
}

export default function CognitiveMeter({ meter, cameraEnabled, onFaceUpdate, onOpenSettings }) {
  const [expanded, setExpanded]         = useState(false);
  const [panelPos, setPanelPos]         = useState({ top: 0, left: 0 });
  const [trackerStatus, setTrackerStatus] = useState("idle");
  const [liveStats, setLiveStats]       = useState({ perclos: 0, blinkRate: 15, ear: 0.28 });

  const [draining, setDraining]         = useState(false);

  const toggleRef      = useRef(null);
  const previewCanvas  = useRef(null);
  const lastFwdRef     = useRef(0);
  const prevEnergyRef  = useRef(0);
  const drainTimerRef  = useRef(null);

  const { score, hoursRemaining, breakdown, startingHours = 0, energySpent = 0 } = meter;
  const color          = getMeterColor(score);
  const drowsiness     = getDrowsinessLevel(liveStats.perclos);

  useEffect(() => {
    if (energySpent > prevEnergyRef.current + 1e-6) {
      setDraining(true);
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = setTimeout(() => setDraining(false), 900);
    }
    prevEnergyRef.current = energySpent;
    return () => clearTimeout(drainTimerRef.current);
  }, [energySpent]);

  function handleFaceData(data) {
    setLiveStats(data);
    const now = Date.now();
    if (now - lastFwdRef.current > 3000) {
      lastFwdRef.current = now;
      onFaceUpdate?.(data);
    }
  }

  function handleToggle() {
    if (!expanded) {
      const rect = toggleRef.current?.getBoundingClientRect();
      if (rect) {
        const PANEL_W = 320;
        const left = Math.max(
          12,
          Math.min(rect.left + rect.width / 2 - PANEL_W / 2, window.innerWidth - PANEL_W - 12),
        );
        setPanelPos({ top: rect.bottom + 12, left });
      }
    }
    setExpanded(v => !v);
  }

  useEffect(() => {
    if (!expanded) return;
    function handleClick(e) {
      if (
        !toggleRef.current?.contains(e.target) &&
        !document.querySelector(".cm-panel")?.contains(e.target)
      ) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  return (
    <div className="cognitive-meter">
      {cameraEnabled && (
        <FacialTracker
          enabled={cameraEnabled}
          onUpdate={handleFaceData}
          onStatusChange={setTrackerStatus}
          canvasRef={previewCanvas}
        />
      )}

      <button
        ref={toggleRef}
        type="button"
        className={`cm-ring-btn ${draining ? "cm-ring-btn--draining" : ""}`}
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-label={`Focus battery: ${hoursRemaining} hours remaining`}
      >
        <CircularBatteryRing ratio={score} color={color}>
          <CameraCenter
            cameraEnabled={cameraEnabled}
            trackerStatus={trackerStatus}
            previewCanvas={previewCanvas}
            drowsiness={drowsiness}
          />
        </CircularBatteryRing>
        <DockStats
          hoursRemaining={hoursRemaining}
          energySpent={energySpent}
          draining={draining}
          drowsiness={drowsiness}
          cameraEnabled={cameraEnabled}
          trackerStatus={trackerStatus}
        />
      </button>

      {expanded && createPortal(
        <div
          className="cm-panel"
          style={{ top: panelPos.top, left: panelPos.left }}
        >
          <div className="cm-panel-header">
            <span>Cognitive Meter</span>
            <div className="cm-panel-actions">
              <button
                className="cm-panel-gear"
                title="Cognitive Meter settings"
                onClick={() => { setExpanded(false); onOpenSettings?.(); }}
              >⚙</button>
              <button className="cm-panel-close" onClick={() => setExpanded(false)}>✕</button>
            </div>
          </div>

          <div className="cm-panel-hero">
            <CircularBatteryRing ratio={score} color={color} size={120} stroke={7}>
              <CameraCenter
                cameraEnabled={cameraEnabled}
                trackerStatus={trackerStatus}
                previewCanvas={previewCanvas}
                drowsiness={drowsiness}
              />
            </CircularBatteryRing>
            <div className="cm-panel-hero__text">
              <div className="cm-score-big">
                {hoursRemaining}
                <span className="cm-score-unit">h left</span>
              </div>
              <div className={`cm-panel-hero__spent ${draining ? "cm-consumed--pulse" : ""}`}>
                <strong>−{energySpent.toFixed(2)}h</strong>
                <span className="cm-consumed-of"> spent · {startingHours.toFixed(1)}h capacity</span>
              </div>
              <span className="cm-drowsiness-label" style={{ color: drowsiness.color }}>
                {cameraEnabled && trackerStatus === "running" ? drowsiness.label : "Focus capacity"}
              </span>
            </div>
          </div>

          {cameraEnabled && trackerStatus === "running" && (
            <div className="cm-live-stats">
              <p className="cm-section-label">Live eye analysis</p>
              <LiveStatRow
                label="Eye openness (EAR)"
                value={(liveStats.ear ?? 0.25).toFixed(2)}
                unit=""
                bar={Math.min(1, (liveStats.ear ?? 0.25) / 0.35)}
                barColor={liveStats.ear < EAR_THRESHOLD ? "#e87676" : "#57c98a"}
              />
              <LiveStatRow
                label="PERCLOS (60s)"
                value={`${Math.round((liveStats.perclos ?? 0) * 100)}`}
                unit="%"
                bar={Math.min(1, (liveStats.perclos ?? 0) / 0.25)}
                barColor={drowsiness.color}
              />
              <LiveStatRow
                label="Blink rate"
                value={liveStats.blinkRate ?? 0}
                unit="/min"
                bar={Math.min(1, (liveStats.blinkRate ?? 15) / 30)}
                barColor="#7eb8f7"
              />
            </div>
          )}

          {cameraEnabled && trackerStatus === "loading" && (
            <div className="cm-camera-loading">Starting camera…</div>
          )}
          {(trackerStatus === "denied" || trackerStatus === "error") && cameraEnabled && (
            <div className="cm-camera-error">
              {trackerStatus === "denied" ? "Camera access denied." : "Camera unavailable."}
            </div>
          )}

          {!cameraEnabled && (
            <button className="cm-enable-camera" onClick={() => { setExpanded(false); onOpenSettings?.(); }}>
              👁 Enable camera tracking in settings
            </button>
          )}

          <div className="cm-breakdown">
            <p className="cm-section-label">Starting capacity</p>
            <BreakdownRow label="Recovery (HRV + Sleep)"   value={breakdown.biometric} />
            <BreakdownRow label="Circadian rhythm"         value={breakdown.circadian} />
            <BreakdownRow label="Alertness (eye tracking)" value={breakdown.alertness} />
            <BreakdownRow label="Glucose stability"        value={breakdown.glucose} />
            {breakdown.caffeine > 0 && (
              <BreakdownRow label="Caffeine boost"         value={breakdown.caffeine} />
            )}
          </div>

          <p className="cm-disclaimer">
            Estimated. Accuracy improves with wearable data + eye tracking.
          </p>
        </div>,
        document.body
      )}
    </div>
  );
}
