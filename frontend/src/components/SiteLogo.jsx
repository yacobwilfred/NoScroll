/**
 * Fixed top-left brand mark, visible on every page.
 */
export default function SiteLogo({ onNavigate }) {
  function handleClick(e) {
    e.preventDefault();
    onNavigate?.();
  }

  return (
    <a href="/" className="site-logo" aria-label="Cognitive Meter home" onClick={handleClick}>
      <img
        src="/cognitive-meter-logo.png"
        alt="Cognitive Meter"
        className="site-logo__img"
        width={900}
        height={208}
        decoding="async"
      />
    </a>
  );
}
