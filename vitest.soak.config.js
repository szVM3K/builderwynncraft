import os from "node:os";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `npm run test:soak`: endless randomized generator QA in parallel shards (tests/soak/shard-1..4.soak.js).
// SOAK_SHARDS (default: CPU cores - 1, at most 4) shards run at the same time; SOAK_MINUTES=60 stops after an
// hour, without it the run goes on until Ctrl+C.
const shards = Math.min(4, Math.max(1, Number(process.env.SOAK_SHARDS) || os.cpus().length - 1));
process.env.SOAK_SHARDS = String(shards);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/soak/*.soak.js"],
    pool: "forks",
    maxWorkers: 4,
    minWorkers: 1,
    fileParallelism: true,
    testTimeout: 0,
    reporters: ["default"],
  },
});
