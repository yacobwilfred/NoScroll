import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import FacialTracker from "./FacialTracker";

const EAR_THRESHOLD = 0.20;
const RING_SIZE = 100;
const RING_STROKE = 7;

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

function CircularBatteryRing({ ratio, color, size = RING_SIZE, stroke = RING_STROKE, className = "", children }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamped);

  return (
    <div className={`cm-ring ${className}`} style={{ width: size, height: size }}>
      <svg className="cm-ring__svg" width={size} height={size} aria-hidden="true">
        <circle
          className="cm-ring__track"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="cm-ring__fill"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className="cm-ring__center">{children}</div>
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
        <span className="cm-ring-btn__hours">
          {hoursRemaining}
          <span className="cm-ring-btn__unit">h</span>
        </span>
        {energySpent > 0.001 && (
          <span className={`cm-ring-btn__spent ${draining ? "cm-spent--pulse" : ""}`}>
            −{energySpent.toFixed(2)}
          </span>
        )}
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
            <CircularBatteryRing ratio={score} color={color} size={128} stroke={8}>
              <div className="cm-ring__hours-inner">
                {hoursRemaining}
                <span className="cm-ring__hours-inner-unit">h</span>
              </div>
            </CircularBatteryRing>
            <div className="cm-panel-hero__text">
              <div className="cm-score-big">
                {hoursRemaining}
                <span className="cm-score-unit">hrs of deep work</span>
              </div>
              <span className="cm-drowsiness-label" style={{ color: drowsiness.color }}>
                {cameraEnabled && trackerStatus === "running" ? drowsiness.label : "Focus capacity"}
              </span>
            </div>
          </div>

          <div className={`cm-consumed ${draining ? "cm-consumed--pulse" : ""}`}>
            Focus spent this session: <strong>{energySpent.toFixed(2)}h</strong>
            <span className="cm-consumed-of"> of {startingHours.toFixed(1)}h capacity</span>
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
