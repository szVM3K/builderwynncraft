import React from "react";
import { createRoot } from "react-dom/client";
import BuildRecommender from "./BuildRecommender.jsx";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "./index.css";

// generator w Web Workerach (równoległe starty, strona się nie zacina); bez workerów liczy w tym wątku
globalThis.__WBR_WORKER_FACTORY = () => new Worker(new URL("./engine-worker.js", import.meta.url), { type: "module" });

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BuildRecommender />
  </React.StrictMode>
);
