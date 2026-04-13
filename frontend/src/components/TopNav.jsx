/**
 * Global persistent top navigation bar.
 * Always visible. Active tab is highlighted.
 * In the graph phase, "New Prompt" is hidden — the graph's own "↩ New topic" handles that.
 */
import { motion } from "framer-motion";

export default function TopNav({ activeTab, onNewPrompt, onFriendsPicks, onProfile }) {
  return (
    <nav className="topnav">
      <NavBtn
        label="New Prompt"
        active={activeTab === "prompt"}
        onClick={onNewPrompt}
      />
      <NavBtn
        label="Friends' Picks"
        active={activeTab === "friends"}
        onClick={onFriendsPicks}
      />
      <NavBtn
        label="Profile"
        active={activeTab === "profile"}
        onClick={onProfile}
      />
    </nav>
  );
}

function NavBtn({ label, active, onClick }) {
  return (
    <button
      className={`topnav-btn ${active ? "topnav-btn--active" : ""}`}
      onClick={onClick}
    >
      {label}
      {active && (
        <motion.span
          className="topnav-btn__pip"
          layoutId="topnav-pip"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
    </button>
  );
}
