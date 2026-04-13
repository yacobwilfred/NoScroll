export default function Breadcrumb({ breadcrumb, onReset }) {
  const depth = breadcrumb.length;
  return (
    <div className="breadcrumb">
      <div className="breadcrumb__trail">
        {breadcrumb.map((_, i) => (
          <span key={i} className={`breadcrumb__dot ${i === depth - 1 ? "breadcrumb__dot--active" : ""}`} />
        ))}
      </div>
      <span className="breadcrumb__label">
        {depth === 1 ? "Starting point" : `${depth} hops deep`}
      </span>
      <button className="breadcrumb__reset" onClick={onReset}>
        ↩ Start over
      </button>
    </div>
  );
}
