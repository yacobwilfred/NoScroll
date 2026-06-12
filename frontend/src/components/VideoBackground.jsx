import { useEffect, useRef, useState } from "react";

const DEFAULT_SRC = "/backgrounds/ambient.mp4";

export default function VideoBackground({ src = DEFAULT_SRC }) {
  const videoRef = useRef(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setActive(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;

    const onVisibility = () => {
      if (document.hidden) {
        video.pause();
      } else {
        video.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    video.play().catch(() => {});

    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, src]);

  if (!active) return null;

  return (
    <div className="video-bg" aria-hidden="true">
      <video
        ref={videoRef}
        className="video-bg__media"
        src={src}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        onError={() => setActive(false)}
      />
      <div className="video-bg__scrim" />
    </div>
  );
}
