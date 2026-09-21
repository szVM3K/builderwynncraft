import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./": ścieżki względne, więc build działa zarówno pod https://<user>.github.io/ jak i pod /<repo>/.
export default defineConfig({ plugins: [react()], base: "./", build: { chunkSizeWarningLimit: 1500 } });
