import React from "react";
import { createRoot } from "react-dom/client";
import BuildRecommender from "./BuildRecommender.jsx";
import "@fontsource/tiny5/400.css";
import "@fontsource/pixelify-sans/400.css";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BuildRecommender />
  </React.StrictMode>
);
