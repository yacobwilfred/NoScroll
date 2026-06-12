import { useEffect, useMemo, useState, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { fibonacciSphere } from "../utils/fibonacciSphere";

const MAX_SUGGESTIONS = 14;
const SPHERE_RADIUS = 6.4;
const CAMERA_Z = 9.8;

const ALL_SUGGESTIONS = [
  "The neuroscience of creativity and flow",
  "How perception shapes reality",
  "The philosophy of consciousness",
  "Memory, emotion, and the brain",
  "Eastern philosophy and mindfulness",
  "Free will, ethics, and moral philosophy",
  "Japanese aesthetics and visual art",
  "The history of modernist painting",
  "Abstract expressionism and its legacy",
  "Bauhaus: design meets philosophy",
  "Photography as a documentary form",
  "Street art and urban visual culture",
  "The art of illustration and drawing",
  "Ceramics, craft, and material culture",
  "Sculpture across history",
  "Typography and graphic design history",
  "Industrial design and everyday objects",
  "Fashion history and cultural identity",
  "Architecture and the city",
  "Cosmology and the nature of the universe",
  "Evolutionary biology and natural selection",
  "The science of colour and light",
  "Plants, ecology, and the natural world",
  "Mythology and ancient storytelling",
  "World religion and ritual",
  "Food, culture, and identity",
  "The craft of documentary filmmaking",
  "Music production and sound design",
  "Graphic novels and visual storytelling",
  "History of modernist architecture",
  "Urban design and public space",
  "How writers develop their voice",
  "Building a creative practice",
];

const RELAX_SUGGESTIONS = [
  "Something to make me smile",
  "A short funny video",
  "Feel-good essay",
  "A quick comic",
  "Live music performance",
  "Easy travel story",
  "Cozy nature documentary",
  "Wholesome short film",
  "Gentle photography",
  "A light podcast episode",
];

function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0, CAMERA_Z);
    camera.fov = 58;
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function SuggestionCard({ text, position, onSelect, loading }) {
  const [hovered, setHovered] = useState(false);

  return (
    <group position={position}>
      <Html
        center
        distanceFactor={5.6}
        occlude={false}
        zIndexRange={[0, 50]}
        style={{ pointerEvents: "auto" }}
      >
        <button
          type="button"
          className={`prompt-sphere-card ${hovered ? "prompt-sphere-card--hovered" : ""}`}
          disabled={loading}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(text);
          }}
        >
          <span className="prompt-sphere-card__text">{text}</span>
        </button>
      </Html>
    </group>
  );
}

function SuggestionSphere({ suggestions, onSelect, loading }) {
  const positions = useMemo(
    () => fibonacciSphere(suggestions.length, SPHERE_RADIUS),
    [suggestions.length],
  );

  return (
    <>
      <CameraRig />
      <ambientLight intensity={0.62} />
      <pointLight position={[8, 8, 8]} intensity={0.35} />

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        autoRotate
        autoRotateSpeed={0.38}
        minDistance={2.4}
        maxDistance={24}
        makeDefault
      />

      {suggestions.map((text, i) => (
        <SuggestionCard
          key={`${text}-${i}`}
          text={text}
          position={positions[i]}
          onSelect={onSelect}
          loading={loading}
        />
      ))}
    </>
  );
}

export default function PromptScreen({ onSubmit, loading, mode = "deep" }) {
  const [prompt, setPrompt] = useState("");
  const isRelax = mode === "relax";

  const suggestions = useMemo(() => {
    if (isRelax) return RELAX_SUGGESTIONS;
    return pickRandom(ALL_SUGGESTIONS, MAX_SUGGESTIONS);
  }, [isRelax]);

  function submitText(text) {
    const trimmed = text.trim();
    if (isRelax) {
      onSubmit(trimmed, "relax");
    } else if (trimmed) {
      onSubmit(trimmed, "deep");
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    submitText(prompt);
  }

  function handleSuggestionSelect(text) {
    setPrompt(text);
    submitText(text);
  }

  return (
    <div className={`prompt-screen ${isRelax ? "prompt-screen--relax" : ""}`}>
      <Canvas
        className="prompt-screen__canvas"
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SuggestionSphere
            suggestions={suggestions}
            onSelect={handleSuggestionSelect}
            loading={loading}
          />
        </Suspense>
      </Canvas>

      <p className="prompt-screen__hint">Drag to browse topics · Scroll to zoom</p>

      <div className="prompt-screen__chrome">
        <form onSubmit={handleSubmit} className="prompt-form">
          <input
            className="prompt-input"
            type="text"
            placeholder={isRelax
              ? "Start somewhere light… (optional)"
              : "What do you want to explore today?"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
            disabled={loading}
          />
          <button
            className="prompt-btn"
            type="submit"
            disabled={loading || (!isRelax && !prompt.trim())}
          >
            {loading ? "Finding…" : isRelax ? "Relax →" : "Explore →"}
          </button>
        </form>
      </div>
    </div>
  );
}
