// Makes the value for the ADMIN_PASSWORD_HASH secret: node scripts/hash-password.mjs "your password"
// PBKDF2-SHA256, 100 000 iterations (the most Cloudflare Workers allow), random 16-byte salt.
import { webcrypto as crypto } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: node scripts/hash-password.mjs "a password of at least 12 characters"');
  process.exit(1);
}
const iterations = 100000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
console.log(`pbkdf2-sha256$${iterations}$${Buffer.from(salt).toString("base64")}$${Buffer.from(hash).toString("base64")}`);
