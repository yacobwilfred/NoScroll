import { useRef, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import CenterContent from "./CenterContent";
import DirectionCorner from "./DirectionCorner";

const POSITIONS = ["tl", "tr", "bl", "br"];

const SPRING = { type: "spring", stiffness: 260, damping: 28 };

// Where the center slides in FROM based on which corner was clicked
const ENTER_OFFSET = {
  tl: { x: -200, y: -160 },
  tr: { x:  200, y: -160 },
  bl: { x: -200, y:  160 },
  br: { x:  200, y:  160 },
};

export default function NodeGraph({ centerNode, directions, onDirectionClick, loading, enterFrom, savedItemId, onSave, onUnsave }) {
  const containerRef = useRef(null);
  const centerRef = useRef(null);
  const cornerEls = useRef([null, null, null, null]);
  const [lines, setLines] = useState([]);

  const computeLines = useCallback(() => {
    const container = containerRef.current;
    const center = centerRef.current;
    if (!container || !center) return;

    const cRect = container.getBoundingClientRect();
    const nRect = center.getBoundingClientRect();

    // Four corners of the center content box, relative to container
    const boxCorners = [
      { x: nRect.left - cRect.left,  y: nRect.top - cRect.top    }, // TL
      { x: nRect.right - cRect.left, y: nRect.top - cRect.top    }, // TR
      { x: nRect.left - cRect.left,  y: nRect.bottom - cRect.top }, // BL
      { x: nRect.right - cRect.left, y: nRect.bottom - cRect.top }, // BR
    ];

    const newLines = boxCorners.map((corner, i) => {
      const el = cornerEls.current[i];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x1: corner.x,
        y1: corner.y,
        x2: r.left + r.width  / 2 - cRect.left,
        y2: r.top  + r.height / 2 - cRect.top,
      };
    }).filter(Boolean);

    setLines(newLines);
  }, []);

  // Use rAF so Framer Motion's initial transforms are settled before measuring
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      computeLines();
    });
    const ro = new ResizeObserver(computeLines);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [directions, centerNode, computeLines]);

  const offset = ENTER_OFFSET[enterFrom] ?? { x: 0, y: 0 };

  return (
    <motion.div
      ref={containerRef}
      className="node-graph"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02, transition: { duration: 0.2 } }}
      transition={{ duration: 0.15 }}
    >
      {/* SVG connector lines — draw in after center settles */}
      <svg className="node-graph__svg" aria-hidden="true">
        {lines.map((line, i) => {
          const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
          return (
            <motion.line
              key={i}
              x1={line.x1} y1={line.y1}
              x2={line.x2} y2={line.y2}
              stroke="rgba(100, 130, 255, 0.45)"
              strokeWidth="1.5"
              strokeDasharray={len}
              initial={{ strokeDashoffset: len, opacity: 0 }}
              animate={{ strokeDashoffset: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.07, ease: "easeOut" }}
            />
          );
        })}
      </svg>

      {/* 4 corner direction labels */}
      {directions.slice(0, 4).map((dir, i) => (
        <DirectionCorner
          key={`${dir.cluster_id}-${i}`}
          direction={dir}
          position={POSITIONS[i]}
          onClick={(d) => onDirectionClick(d, POSITIONS[i])}
          loading={loading}
          refCallback={(el) => { cornerEls.current[i] = el; }}
          index={i}
        />
      ))}

      {/* Center content — slides in from the clicked corner direction */}
      <motion.div
        ref={centerRef}
        className="center-wrapper"
        initial={{ scale: 0.45, opacity: 0, x: offset.x, y: offset.y }}
        animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
        transition={SPRING}
        style={{ borderRadius: 18 }}
      >
        <CenterContent
          node={centerNode}
          savedItemId={savedItemId}
          onSave={onSave}
          onUnsave={onUnsave}
        />
      </motion.div>
    </motion.div>
  );
}
