// Web Worker generatora (wersja Vite / GitHub Pages): ten sam kod co strona, bez interfejsu.
// Uruchamiany przez fabrykę z src/main.jsx; protokół wiadomości: startEngineWorker w BuildRecommender.jsx.
import { startEngineWorker } from "./BuildRecommender.jsx";

startEngineWorker(self);
