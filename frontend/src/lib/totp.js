// RFC 6238 time-based one-time passwords (Google Authenticator / Authy compatible).
import { randomBytes } from "./crypto.js";
import { enc } from "./encoding.js";

const subtle = globalThis.crypto.subtle;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 16-character secret (80 bits), shown to the user as 4 groups of 4. */
export const generateTotpSecret = () => base32Encode(randomBytes(10));

export const formatSecret = (secret) => secret.match(/.{1,4}/g).join(" ");

export async function totpAt(secret, timeMs = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, counter);
  const key = await subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Accepts the current code and one step either side (clock drift). */
export async function verifyTotp(secret, code, timeMs = Date.now()) {
  const c = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  for (const drift of [0, -1, 1]) {
    if ((await totpAt(secret, timeMs + drift * 30000)) === c) return true;
  }
  return false;
}

export function otpauthUri(email, secret, issuer = "Encrypted File Vault") {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// kept so other modules can hash UTF-8 text without importing TextEncoder themselves
export const utf8 = (s) => enc.encode(s);
