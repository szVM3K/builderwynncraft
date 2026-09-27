import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";

// Google AdSense (opcjonalnie, src/ads-config.json): gdy jest "client" (ca-pub-...), do <head> trafia metatag
// weryfikacyjny i skrypt AdSense (tego szuka AdSense przy dodawaniu witryny); bez niego nic się nie dodaje.
function adsense() {
  return {
    name: "wbr-adsense",
    transformIndexHtml(html) {
      let client = "";
      try {
        client = JSON.parse(fs.readFileSync(new URL("./src/ads-config.json", import.meta.url), "utf8")).client || "";
      } catch (error) {
        client = "";
      }
      if (!/^ca-pub-\d{10,20}$/.test(client)) return html;
      return html.replace(
        "</head>",
        `  <meta name="google-adsense-account" content="${client}" />\n    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>\n  </head>`
      );
    },
  };
}

// base "./": ścieżki względne, więc build działa zarówno pod https://<user>.github.io/ jak i pod /<repo>/.
export default defineConfig({ plugins: [react(), adsense()], base: "./", build: { chunkSizeWarningLimit: 1500 } });
