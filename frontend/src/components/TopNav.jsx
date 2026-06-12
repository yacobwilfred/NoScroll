/**
 * Floating capsule switch between Deep and Relax.
 */
import { motion } from "framer-motion";

const THUMB_SPRING = { type: "spring", stiffness: 420, damping: 34 };

export default function TopNav({ activeTab, onDeep, onRelax }) {
  return (
    <nav className="topnav" aria-label="Browse mode">
      <div className="topnav__capsule" role="tablist">
        <CapsuleOption
          label="Deep"
          active={activeTab === "deep"}
          onClick={onDeep}
        />
        <CapsuleOption
          label="Relax"
          active={activeTab === "relax"}
          onClick={onRelax}
        />
      </div>
    </nav>
  );
}

function CapsuleOption({ label, active, onClick }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`topnav-btn ${active ? "topnav-btn--active" : ""}`}
      onClick={onClick}
    >
      {active && (
        <motion.span
          className="topnav__thumb"
          layoutId="topnav-thumb"
          transition={THUMB_SPRING}
        />
      )}
      <span className="topnav-btn__label">{label}</span>
    </button>
  );
}
