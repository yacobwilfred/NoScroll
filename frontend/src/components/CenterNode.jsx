import ContentTypeTag from "./ContentTypeTag";

export default function CenterNode({ node, onClick }) {
  const meta = node.duration_minutes
    ? `${node.duration_minutes} min`
    : node.read_time_minutes
    ? `${node.read_time_minutes} min read`
    : null;

  return (
    <div className="center-node" onClick={onClick} title="Click to view content">
      <div className="center-node__header">
        <ContentTypeTag type={node.content_type} />
        {meta && <span className="center-node__meta">{meta}</span>}
      </div>
      <h2 className="center-node__title">{node.title}</h2>
      {node.author && <p className="center-node__author">{node.author}</p>}
      {node.summary && (
        <p className="center-node__summary">
          {node.summary.length > 180
            ? node.summary.slice(0, 180) + "…"
            : node.summary}
        </p>
      )}
      <span className="center-node__cta">Tap to explore this content</span>
    </div>
  );
}
