import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `npm test`: the generator QA matrix (tests/**/*.test.js), one file per class so the classes run in parallel.
// The endless soak run has its own config (vitest.soak.config.js).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    pool: "forks",
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    reporters: ["default"],
  },
});
