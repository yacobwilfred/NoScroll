/**
 * Fixed top-right entry point to the user's profile page.
 */
export default function ProfileNavButton({ active, onClick }) {
  return (
    <button
      type="button"
      className={`profile-nav-btn ${active ? "profile-nav-btn--active" : ""}`}
      onClick={onClick}
      aria-label="Profile"
      aria-current={active ? "page" : undefined}
      title="Profile"
    >
      <svg
        className="profile-nav-btn__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5.5 19.5c0-3.2 2.9-5.5 6.5-5.5s6.5 2.3 6.5 5.5" />
      </svg>
    </button>
  );
}
