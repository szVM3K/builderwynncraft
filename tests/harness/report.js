// Findings log: one JSON line per finding in test-results/, plus a readable summary on the console.
import fs from "node:fs";
import path from "node:path";

export const RESULTS_DIR = path.resolve(process.cwd(), "test-results");

export function appendFindings(file, records) {
  if (!records.length) return;
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.appendFileSync(path.join(RESULTS_DIR, file), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

export function writeJson(file, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, file), JSON.stringify(data, null, 2));
}

export function formatFindings(findings, { withInfo = false } = {}) {
  return findings
    .filter((finding) => withInfo || finding.severity !== "info")
    .map((finding) => `    ${finding.severity === "error" ? "✗ ERROR" : "! warn "} ${finding.code}: ${finding.message}`)
    .join("\n");
}
