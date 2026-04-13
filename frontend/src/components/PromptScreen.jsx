import { useState } from "react";

const ALL_SUGGESTIONS = [
  // Mind & consciousness
  "The neuroscience of creativity and flow",
  "How perception shapes reality",
  "The philosophy of consciousness",
  "Memory, emotion, and the brain",
  "Eastern philosophy and mindfulness",
  "Free will, ethics, and moral philosophy",
  // Art & visual culture
  "Japanese aesthetics and visual art",
  "The history of modernist painting",
  "Abstract expressionism and its legacy",
  "Bauhaus: design meets philosophy",
  "Photography as a documentary form",
  "Street art and urban visual culture",
  "The art of illustration and drawing",
  "Ceramics, craft, and material culture",
  "Sculpture across history",
  // Design & making
  "Typography and graphic design history",
  "The Bauhaus movement and modern design",
  "Industrial design and everyday objects",
  "Fashion history and cultural identity",
  "Architecture and the city",
  "Interior design and spatial experience",
  "Furniture design through the centuries",
  // Science & nature
  "Cosmology and the nature of the universe",
  "Evolutionary biology and natural selection",
  "The science of colour and light",
  "Plants, ecology, and the natural world",
  "Materials science and innovation",
  // Society & culture
  "Mythology and ancient storytelling",
  "World religion and ritual",
  "Food, culture, and identity",
  "Fashion as social commentary",
  "Folklore, customs, and oral tradition",
  "The history of protest and social change",
  "Anthropology of everyday life",
  "Gender, identity, and representation",
  // Media & craft
  "The craft of documentary filmmaking",
  "Music production and sound design",
  "Creative routines of great artists",
  "Graphic novels and visual storytelling",
  "The art of printmaking and letterpress",
  "Calligraphy and the art of writing",
  // Architecture & cities
  "History of modernist architecture",
  "Urban design and public space",
  "Brutalism, beauty, and concrete",
  "Landscape architecture and gardens",
  // Creative life
  "How writers develop their voice",
  "The psychology of artistic motivation",
  "Building a creative practice",
  "Collaboration in art and design",
];

function pickRandom(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const SUGGESTIONS = pickRandom(ALL_SUGGESTIONS, 6);

export default function PromptScreen({ onSubmit, loading, savedCount = 0 }) {
  const [prompt, setPrompt] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (prompt.trim()) onSubmit(prompt.trim());
  }

  function handleSuggestion(s) {
    setPrompt(s);
  }

  return (
    <div className="prompt-screen">
      <div className="prompt-inner">

        <form onSubmit={handleSubmit} className="prompt-form">
          <input
            className="prompt-input"
            type="text"
            placeholder="What do you want to explore today?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            autoFocus
            disabled={loading}
          />
          <button
            className="prompt-btn"
            type="submit"
            disabled={loading || !prompt.trim()}
          >
            {loading ? "Finding…" : "Explore →"}
          </button>
        </form>

        <div className="prompt-suggestions">
          <span className="prompt-suggestions-label">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="suggestion-chip"
              onClick={() => handleSuggestion(s)}
              disabled={loading}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
