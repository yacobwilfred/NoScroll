import { useState, useRef, useLayoutEffect } from "react";
import { motion } from "framer-motion";
import ContentTypeTag from "./ContentTypeTag";
import { focusCostTier } from "../cognitive";

const SPRING_CORNER = { type: "spring", stiffness: 220, damping: 26 };
const TITLE_LINE_GAP_PX = 6;

function fitTextLength(text, maxWidth, probe) {
  if (!text || maxWidth <= 0) return 0;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    probe.textContent = text.slice(0, mid);
    if (probe.offsetWidth <= maxWidth) lo = mid;
    else hi = mid - 1;
  }

  if (lo > 0 && lo < text.length) {
    const lastSpace = text.lastIndexOf(" ", lo);
    if (lastSpace > 0) return lastSpace;
  }
  return lo;
}

function DirectionCornerTitle({ title, contentType, format, isRelax }) {
  const containerRef = useRef(null);
  const tagsRef = useRef(null);
  const [lines, setLines] = useState({ line1: title, line2: "" });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const fullTitle = title || "";
      const style = getComputedStyle(container);
      const probe = document.createElement("span");
      probe.style.cssText = [
        "position:absolute",
        "visibility:hidden",
        "white-space:nowrap",
        `font:${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      ].join(";");
      document.body.appendChild(probe);

      const containerWidth = container.clientWidth;
      const tagsWidth = tagsRef.current?.offsetWidth ?? 0;
      const hasTags = tagsWidth > 0;
      const line1Budget = hasTags
        ? containerWidth - tagsWidth - TITLE_LINE_GAP_PX
        : containerWidth;

      const line1Len = fitTextLength(fullTitle, line1Budget, probe);
      const line1 = fullTitle.slice(0, line1Len).trimEnd();
      let line2 = fullTitle.slice(line1Len).trimStart();

      if (line2) {
        const line2Len = fitTextLength(line2, containerWidth, probe);
        if (line2Len < line2.length) {
          line2 = `${line2.slice(0, line2Len).trimEnd()}…`;
        }
      }

      document.body.removeChild(probe);
      setLines({ line1, line2 });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    if (tagsRef.current) ro.observe(tagsRef.current);
    return () => ro.disconnect();
  }, [title, contentType, format, isRelax]);

  return (
    <div className="direction-corner__title" ref={containerRef}>
      <div className="direction-corner__title-line1">
        {(contentType || (isRelax && format)) && (
          <span className="direction-corner__title-tags" ref={tagsRef}>
            {contentType && <ContentTypeTag type={contentType} />}
            {isRelax && format && <span className="format-tag">{format}</span>}
          </span>
        )}
        {lines.line1 && (
          <span className="direction-corner__title-line1-text">{lines.line1}</span>
        )}
      </div>
      {lines.line2 && (
        <div className="direction-corner__title-line2">{lines.line2}</div>
      )}
    </div>
  );
}

function formatCL(clHours) {
  if (!clHours) return null;
  if (clHours < 1) return `~${Math.round(clHours * 60)}m`;
  return `~${clHours.toFixed(1)}h`;
}

// position: "tl" | "tr" | "bl" | "br"
export default function DirectionCorner({
  direction,
  position,
  onClick,
  loading,
  refCallback,
  index,
  mode = "deep",
  animate: animateProp,
  transition: transitionProp,
  visible = true,
}) {
  const preview = direction.preview;
  const cl      = preview?.cognitive_load ?? null;
  const isRelax = mode === "relax";

  const defaultAnimate = visible
    ? { opacity: 1, scale: 1, x: 0, y: 0, z: 0 }
    : { opacity: 0, scale: 0.85, z: -60 };

  return (
    <motion.div
      ref={refCallback}
      className={`direction-corner direction-corner--${position} ${loading ? "direction-corner--loading" : ""} ${isRelax ? "direction-corner--relax" : ""}`}
      onClick={() => !loading && onClick(direction)}
      initial={{ opacity: 0, scale: 0.85, z: 32 }}
      animate={animateProp ?? defaultAnimate}
      transition={transitionProp ?? {
        opacity: { duration: 0.3, delay: 0.2 + index * 0.06 },
        scale:   { duration: 0.3, delay: 0.2 + index * 0.06 },
        default: SPRING_CORNER,
      }}
      style={{ transformStyle: "preserve-3d" }}
    >
      {isRelax && direction.facet_value && (
        <span className="direction-corner__facet">{direction.label}</span>
      )}
      <DirectionCornerTitle
        title={preview?.title ?? direction.label}
        contentType={preview?.content_type}
        format={preview?.format}
        isRelax={isRelax}
      />
      {cl !== null && (
        <span className={`direction-corner__cl direction-corner__cl--${focusCostTier(cl)} ${isRelax ? "direction-corner__cl--relax" : ""}`}>
          {formatCL(cl)} focus
        </span>
      )}
    </motion.div>
  );
}
