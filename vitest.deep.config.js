import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `npm run test:deep`: deep optimality certificate (exhaustive pair swaps over wide candidate lists + triples) for a
// handful of builds - tests/deep/*.deep.js, two files in parallel. Takes a while (minutes per build).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/deep/*.deep.js"],
    pool: "forks",
    maxWorkers: 2,
    minWorkers: 1,
    testTimeout: 0,
    reporters: ["default"],
  },
});
