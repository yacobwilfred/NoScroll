const TYPE_LABELS = {
  video: "Video",
  article: "Article",
  podcast: "Podcast",
  paper: "Paper",
  image: "Visual",
};

export default function ContentTypeTag({ type }) {
  return (
    <span className={`type-tag type-tag--${type}`}>
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}
