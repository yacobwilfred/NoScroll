import ContentTypeTag from "./ContentTypeTag";

// position: "top" | "bottom" | "left" | "right"
export default function DirectionNode({ direction, position, onClick, loading }) {
  const preview = direction.preview;

  return (
    <div
      className={`direction-node direction-node--${position} ${loading ? "direction-node--loading" : ""}`}
      onClick={() => !loading && onClick(direction)}
    >
      <div className="direction-node__label">{direction.label}</div>
      <div className="direction-node__description">{direction.description}</div>
      {preview && (
        <div className="direction-node__preview">
          <ContentTypeTag type={preview.content_type} />
          <span className="direction-node__preview-title">{preview.title}</span>
        </div>
      )}
    </div>
  );
}
