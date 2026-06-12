import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/stack-sans-text/wght.css";
import "@fontsource-variable/stack-sans-headline/wght.css";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
