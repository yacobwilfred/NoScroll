import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { motion } from "framer-motion";
import CenterContent from "./CenterContent";
import DirectionCorner from "./DirectionCorner";

const POSITIONS = ["tl", "tr", "bl", "br"];

const SPRING = { type: "spring", stiffness: 220, damping: 26 };
const EXIT_EASE = { duration: 0.42, ease: [0.4, 0, 0.2, 1] };
const EXIT_MS = 420;

const CENTER_IDLE = {
  x: 0, y: 0, z: 0,
  scale: 1,
  rotateX: 0, rotateY: 0,
  opacity: 1,
};

// Peripheral slot on the 3D ring (receding from camera)
const SLOT_3D = {
  tl: { x: -240, y: -185, z: -220, scale: 0.38, rotateX: 14,  rotateY: 22,  opacity: 0.45 },
  tr: { x:  240, y: -185, z: -220, scale: 0.38, rotateX: 14,  rotateY: -22, opacity: 0.45 },
  bl: { x: -240, y:  185, z: -220, scale: 0.38, rotateX: -14, rotateY: 22,  opacity: 0.45 },
  br: { x:  240, y:  185, z: -220, scale: 0.38, rotateX: -14, rotateY: -22, opacity: 0.45 },
};

// Whole ring tilts toward the chosen direction during exit
const RING_TILT = {
  tl: { rotateX: -16, rotateY: 20 },
  tr: { rotateX: -16, rotateY: -20 },
  bl: { rotateX: 16,  rotateY: 20 },
  br: { rotateX: 16,  rotateY: -20 },
};

// z lifts corners above center for clicks; no x/y offset to avoid clipping
const CORNER_SLOT = {
  tl: { x: 0, y: 0, z: 48, scale: 0.92, opacity: 1 },
  tr: { x: 0, y: 0, z: 48, scale: 0.92, opacity: 1 },
  bl: { x: 0, y: 0, z: 48, scale: 0.92, opacity: 1 },
  br: { x: 0, y: 0, z: 48, scale: 0.92, opacity: 1 },
};

function rectEdgeToward(rect, svgRect, targetX, targetY) {
  const cx = rect.left - svgRect.left + rect.width / 2;
  const cy = rect.top - svgRect.top + rect.height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const scale = Math.min(
    rect.width / 2 / Math.abs(dx),
    rect.height / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

const NodeGraph = forwardRef(function NodeGraph({
  centerNode,
  directions,
  onDirectionClick,
  onBackPrepare,
  loading,
  savedItemId,
  onSave,
  onUnsave,
  mode = "deep",
  isInitial = false,
}, ref) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const centerRef = useRef(null);
  const cornerEls = useRef([null, null, null, null]);

  const [lines, setLines] = useState([]);
  const [phase, setPhase] = useState(isInitial ? "entering" : "idle");
  const [navFrom, setNavFrom] = useState(null);
  const [ringTilt, setRingTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [linesVisible, setLinesVisible] = useState(!isInitial);

  const computeLines = useCallback(() => {
    const svg = svgRef.current;
    const center = centerRef.current;
    if (!svg || !center) return;

    const svgRect = svg.getBoundingClientRect();
    const nRect = center.getBoundingClientRect();

    const newLines = cornerEls.current.map((el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x2 = r.left + r.width / 2 - svgRect.left;
      const y2 = r.top + r.height / 2 - svgRect.top;
      const edge = rectEdgeToward(nRect, svgRect, x2, y2);
      return { x1: edge.x, y1: edge.y, x2, y2 };
    }).filter(Boolean);

    setLines(newLines);
  }, []);

  useEffect(() => {
    if (phase !== "idle" || !linesVisible) return;

    const observed = new Set();
    const ro = new ResizeObserver(computeLines);
    const observe = (el) => {
      if (el && !observed.has(el)) {
        observed.add(el);
        ro.observe(el);
      }
    };

    observe(svgRef.current);
    observe(centerRef.current);
    cornerEls.current.forEach(observe);

    const frame = requestAnimationFrame(computeLines);
    const delayed = [80, 240, 520].map((ms) => setTimeout(computeLines, ms));
    window.addEventListener("resize", computeLines);

    return () => {
      cancelAnimationFrame(frame);
      delayed.forEach(clearTimeout);
      window.removeEventListener("resize", computeLines);
      ro.disconnect();
    };
  }, [directions, centerNode, computeLines, phase, linesVisible]);

  // Guarantee we return to idle after enter animations (spring complete can be unreliable)
  useEffect(() => {
    if (phase !== "entering") return;
    const t = setTimeout(() => {
      setPhase("idle");
      setNavFrom(null);
      setLinesVisible(true);
    }, isInitial ? 520 : 580);
    return () => clearTimeout(t);
  }, [phase, isInitial, centerNode.id]);

  const runExitTransition = useCallback(async (position) => {
    setNavFrom(position);
    setPhase("exiting");
    setLinesVisible(false);
    setRingTilt(RING_TILT[position] ?? { rotateX: 0, rotateY: 0 });
    await new Promise((r) => setTimeout(r, EXIT_MS));
  }, []);

  const runEnterTransition = useCallback(() => {
    setRingTilt({ rotateX: 0, rotateY: 0 });
    setPhase("entering");
  }, []);

  const handleCornerClick = useCallback(async (direction, position) => {
    if (phase === "exiting" || loading) return;

    await runExitTransition(position);

    try {
      await onDirectionClick(direction, position);
      runEnterTransition();
    } catch {
      setPhase("idle");
      setNavFrom(null);
      setRingTilt({ rotateX: 0, rotateY: 0 });
      setLinesVisible(true);
    }
  }, [phase, loading, onDirectionClick, runExitTransition, runEnterTransition]);

  const goBack = useCallback(async () => {
    if (phase === "exiting" || loading) return;
    const prep = onBackPrepare?.();
    if (!prep) return;

    const position = prep.exitVia ?? "tr";
    await runExitTransition(position);
    prep.commit();
    runEnterTransition();
  }, [phase, loading, onBackPrepare, runExitTransition, runEnterTransition]);

  useImperativeHandle(ref, () => ({ goBack }), [goBack]);

  const handleEnterComplete = useCallback(() => {
    if (phase === "entering") {
      setPhase("idle");
      setNavFrom(null);
      setLinesVisible(true);
      requestAnimationFrame(() => requestAnimationFrame(computeLines));
    }
  }, [phase, computeLines]);

  const cornersVisible = phase === "idle" || phase === "entering";
  const centerExiting = phase === "exiting" && navFrom;
  const centerEntering = phase === "entering" && navFrom;

  const centerInitial = centerEntering && navFrom
    ? SLOT_3D[navFrom]
    : isInitial
      ? { scale: 0.42, opacity: 0, z: -160, rotateX: 8, rotateY: 0 }
      : false;

  const centerAnimate = centerExiting && navFrom
    ? SLOT_3D[navFrom]
    : CENTER_IDLE;

  const centerTransition = centerExiting
    ? EXIT_EASE
    : SPRING;

  return (
    <motion.div
      ref={containerRef}
      className="node-graph"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="node-graph__carousel"
        animate={{ rotateX: ringTilt.rotateX, rotateY: ringTilt.rotateY }}
        transition={phase === "exiting" ? EXIT_EASE : SPRING}
      >
        <svg ref={svgRef} className="node-graph__svg" aria-hidden="true">
          {lines.map((line, i) => (
            <motion.line
              key={i}
              x1={line.x1} y1={line.y1}
              x2={line.x2} y2={line.y2}
              stroke="var(--line-color)"
              initial={{ opacity: 0 }}
              animate={{ opacity: linesVisible ? 1 : 0 }}
              transition={{ duration: 0.35 }}
            />
          ))}
        </svg>

        <motion.div
          ref={centerRef}
          className="center-wrapper"
          key={phase === "entering" ? `enter-${centerNode.id}` : "center-stable"}
          initial={centerInitial}
          animate={centerAnimate}
          transition={centerTransition}
          onAnimationComplete={handleEnterComplete}
          style={{
            transformStyle: "preserve-3d",
            borderRadius: 0,
          }}
        >
          <CenterContent
            node={centerNode}
            savedItemId={savedItemId}
            onSave={onSave}
            onUnsave={onUnsave}
            mode={mode}
          />
        </motion.div>

        {directions.slice(0, 4).map((dir, i) => {
          const pos = POSITIONS[i];
          const isTarget = navFrom === pos;
          const cornerAnimate = !cornersVisible
            ? { opacity: 0, scale: 0.7, z: -80 }
            : phase === "exiting" && isTarget
              ? { x: 0, y: 0, z: 60, scale: 1.08, opacity: 1 }
              : CORNER_SLOT[pos];

          return (
            <DirectionCorner
              key={`${dir.cluster_id}-${i}-${centerNode.id}`}
              direction={dir}
              position={pos}
              onClick={(d) => handleCornerClick(d, pos)}
              loading={loading || phase === "exiting"}
              refCallback={(el) => { cornerEls.current[i] = el; }}
              index={i}
              mode={mode}
              animate={cornerAnimate}
              transition={phase === "exiting" ? EXIT_EASE : SPRING}
              visible={cornersVisible}
            />
          );
        })}
      </motion.div>
    </motion.div>
  );
});

export default NodeGraph;
