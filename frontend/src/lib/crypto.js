// ---------------------------------------------------------------------------
// All cryptography in the app lives in this file. It only uses the browser's
// built-in Web Crypto API (no home-made algorithms):
//
//   SHA-256        file integrity hash (what the smart contract stores)
//   AES-256-GCM    file, metadata and key encryption (authenticated)
//   PBKDF2-SHA256  master password  ->  key-encryption key (600,000 rounds)
//   HKDF-SHA256    recovery key     ->  key-encryption key
//   ECDH P-256     sealing a file key for another user (ECIES style)
// ---------------------------------------------------------------------------
import { enc, dec, toB64, fromB64, concat } from "./encoding.js";

const subtle = globalThis.crypto.subtle;

export const PBKDF2_ITERATIONS = 600_000;
const IV_BYTES = 12;

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export async function sha256(bytes) {
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

// ------------------------------------------------------------- AES-256-GCM
export const importAesKey = (raw, usages = ["encrypt", "decrypt"]) =>
  subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages);

export const newFileKey = () => randomBytes(32);

/** Returns iv || ciphertext || tag as one byte array. */
export async function aesEncrypt(key, bytes) {
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, bytes));
  return concat(iv, ct);
}

/** Throws if the data was modified or the key is wrong (GCM authentication). */
export async function aesDecrypt(key, packed) {
  if (packed.length < IV_BYTES + 16) throw new Error("Ciphertext is too short");
  const iv = packed.subarray(0, IV_BYTES);
  const ct = packed.subarray(IV_BYTES);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, ct));
}

// Short strings for storing small secrets (keys, metadata) in JSON / on-chain.
const SEAL_PREFIX = "efv1.";

export async function sealBytes(key, bytes) {
  return SEAL_PREFIX + toB64(await aesEncrypt(key, bytes));
}
export async function openBytes(key, sealed) {
  if (typeof sealed !== "string" || !sealed.startsWith(SEAL_PREFIX)) throw new Error("Unknown sealed format");
  return aesDecrypt(key, fromB64(sealed.slice(SEAL_PREFIX.length)));
}
export const sealText = (key, text) => sealBytes(key, enc.encode(text));
export const openText = async (key, sealed) => dec.decode(await openBytes(key, sealed));
export const sealJson = (key, value) => sealText(key, JSON.stringify(value));
export const openJson = async (key, sealed) => JSON.parse(await openText(key, sealed));

// ------------------------------------------------------------- files
export async function encryptFile(fileKeyRaw, plaintext) {
  return aesEncrypt(await importAesKey(fileKeyRaw), plaintext);
}
export async function decryptFile(fileKeyRaw, packed) {
  return aesDecrypt(await importAesKey(fileKeyRaw), packed);
}

// ------------------------------------------------------- master password
export async function deriveKek(password, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------- recovery key
// 16 characters from a 32-symbol alphabet (no 0/O/1/I) = 80 bits, shown as EFV-XXXX-XXXX-XXXX-XXXX
const RK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRecoveryKey() {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => RK_ALPHABET[b & 31]).join("");
  return "EFV-" + chars.match(/.{4}/g).join("-");
}

/** Accepts any capitalisation / spacing / dashes; returns the 16 raw characters. */
export function normalizeRecoveryKey(input) {
  let s = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("EFV")) s = s.slice(3);
  return s;
}

export function isValidRecoveryKey(input) {
  const s = normalizeRecoveryKey(input);
  return s.length === 16 && [...s].every((c) => RK_ALPHABET.includes(c));
}

export async function deriveRecoveryKek(recoveryKey, salt) {
  const base = await subtle.importKey("raw", enc.encode(normalizeRecoveryKey(recoveryKey)), "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("efv-recovery-v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ------------------------------------------------- sharing (ECDH P-256)
const ECDH = { name: "ECDH", namedCurve: "P-256" };

export async function generateEcdhPair() {
  const pair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  return {
    publicKey: toB64(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))),
    privatePkcs8: new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey)),
  };
}

export const importEcdhPrivate = (pkcs8) => subtle.importKey("pkcs8", pkcs8, ECDH, false, ["deriveBits"]);

async function eciesKey(privateKey, peerPublicRaw) {
  const peer = await subtle.importKey("raw", peerPublicRaw, ECDH, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: peer }, privateKey, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("efv-ecies-v1") },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Seal `bytes` so that only the owner of `recipientPublicB64` can open it. */
export async function eciesSeal(recipientPublicB64, bytes) {
  const eph = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const ephPublic = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
  const key = await eciesKey(eph.privateKey, fromB64(recipientPublicB64));
  return "ecies1." + toB64(concat(ephPublic, await aesEncrypt(key, bytes)));
}

export async function eciesOpen(privateKey, sealed) {
  if (typeof sealed !== "string" || !sealed.startsWith("ecies1.")) throw new Error("Unknown sealed format");
  const raw = fromB64(sealed.slice(7));
  const key = await eciesKey(privateKey, raw.subarray(0, 65));
  return aesDecrypt(key, raw.subarray(65));
}
