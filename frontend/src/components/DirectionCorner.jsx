import { motion } from "framer-motion";
import ContentTypeTag from "./ContentTypeTag";

// position: "tl" | "tr" | "bl" | "br"
export default function DirectionCorner({ direction, position, onClick, loading, refCallback, index }) {
  const preview = direction.preview;

  return (
    <motion.div
      ref={refCallback}
      className={`direction-corner direction-corner--${position} ${loading ? "direction-corner--loading" : ""}`}
      onClick={() => !loading && onClick(direction)}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }}
      transition={{
        opacity: { duration: 0.3, delay: 0.35 + index * 0.07 },
        scale:   { duration: 0.3, delay: 0.35 + index * 0.07 },
      }}
      style={{ borderRadius: 6 }}
    >
      <p className="direction-corner__title">
        {preview && <ContentTypeTag type={preview.content_type} />}
        {preview?.title ?? direction.label}
      </p>
    </motion.div>
  );
}
