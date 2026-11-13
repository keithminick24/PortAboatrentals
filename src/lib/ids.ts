import { randomBytes } from "node:crypto";

// No 0/O/1/I/L to avoid confusion when read over the phone
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function bookingCode(): string {
  const bytes = randomBytes(6);
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `PA-${s}`;
}

export function secureToken(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
