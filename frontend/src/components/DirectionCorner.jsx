import { motion } from "framer-motion";
import ContentTypeTag from "./ContentTypeTag";
import { focusCostTier } from "../cognitive";

const SPRING_CORNER = { type: "spring", stiffness: 220, damping: 26 };

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
      style={{ borderRadius: 0, transformStyle: "preserve-3d" }}
    >
      {isRelax && direction.facet_value && (
        <span className="direction-corner__facet">{direction.label}</span>
      )}
      <p className="direction-corner__title">
        {isRelax
          ? (preview?.format && <span className="format-tag">{preview.format}</span>)
          : (preview && <ContentTypeTag type={preview.content_type} />)}
        {preview?.title ?? direction.label}
      </p>
      {cl !== null && (
        <span className={`direction-corner__cl direction-corner__cl--${focusCostTier(cl)} ${isRelax ? "direction-corner__cl--relax" : ""}`}>
          {formatCL(cl)} focus
        </span>
      )}
    </motion.div>
  );
}
