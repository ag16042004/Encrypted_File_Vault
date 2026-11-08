// ---------------------------------------------------------------------------
// Where the ENCRYPTED file bytes live.
//   pinata : real IPFS through Pinata (VITE_STORAGE_MODE=pinata + VITE_PINATA_JWT)
//   local  : built-in simulator that stores the encrypted bytes in this browser's
//            IndexedDB and returns a genuine CIDv1 (sha2-256, raw) - ideal for demos.
// ---------------------------------------------------------------------------
import { sha256 } from "./crypto.js";

const env = import.meta.env || {};
const JWT = env.VITE_PINATA_JWT || "";
export const STORAGE_MODE = env.VITE_STORAGE_MODE === "pinata" && JWT ? "pinata" : "local";
const GATEWAYS = [env.VITE_IPFS_GATEWAY, "https://ipfs.io", "https://dweb.link"]
  .filter(Boolean)
  .map((g) => g.replace(/\/+$/, ""));

export function storageInfo() {
  return {
    mode: STORAGE_MODE,
    label: STORAGE_MODE === "pinata" ? "IPFS (Pinata)" : "Local IPFS simulation",
    gateway: GATEWAYS[0],
    misconfigured: env.VITE_STORAGE_MODE === "pinata" && !JWT,
  };
}

// ----------------------------------------------------------------- CID
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function base32Lower(bytes) {
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

/** CIDv1 (0x01) + raw codec (0x55) + sha2-256 multihash (0x12 0x20 <digest>), multibase base32 ("b"). */
export async function cidForBytes(bytes) {
  const digest = await sha256(bytes);
  const body = new Uint8Array(4 + digest.length);
  body.set([0x01, 0x55, 0x12, 0x20], 0);
  body.set(digest, 4);
  return "b" + base32Lower(body);
}

// ------------------------------------------------------ IndexedDB (local)
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("efv-ipfs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("blobs");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", mode);
    const req = fn(tx.objectStore("blobs"));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ----------------------------------------------------------------- Pinata
function pinataUpload(bytes, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.pinata.cloud/pinning/pinFileToIPFS");
    xhr.setRequestHeader("Authorization", `Bearer ${JWT}`);
    const form = new FormData();
    // The real file name never leaves the browser; IPFS only sees an opaque label.
    const label = `efv-${Date.now()}.bin`;
    form.append("file", new Blob([bytes], { type: "application/octet-stream" }), label);
    form.append("pinataMetadata", JSON.stringify({ name: label }));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText).IpfsHash);
        } catch {
          reject(new Error("IPFS returned an unexpected response."));
        }
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(new Error("Pinata rejected the API key. Check VITE_PINATA_JWT."));
      } else {
        reject(new Error(`IPFS upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading to IPFS."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

async function gatewayDownload(cid, signal) {
  let last;
  for (const g of GATEWAYS) {
    try {
      const res = await fetch(`${g}/ipfs/${cid}`, { signal });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      last = new Error(`Gateway ${g} answered HTTP ${res.status}`);
    } catch (e) {
      if (e.name === "AbortError") throw e;
      last = e;
    }
  }
  throw new Error(`Could not download the file from IPFS. ${last ? last.message : ""}`.trim());
}

// ------------------------------------------------------------ public API
/** Stores encrypted bytes, returns their CID. */
export async function putEncrypted(bytes, { onProgress, signal } = {}) {
  if (STORAGE_MODE === "pinata") return pinataUpload(bytes, { onProgress, signal });
  const cid = await cidForBytes(bytes);
  onProgress?.(0.5);
  await idb("readwrite", (s) => s.put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), cid));
  onProgress?.(1);
  return cid;
}

/** Fetches encrypted bytes by CID. */
export async function getEncrypted(cid, { signal } = {}) {
  if (STORAGE_MODE === "pinata") return gatewayDownload(cid, signal);
  const buf = await idb("readonly", (s) => s.get(cid));
  if (!buf) {
    throw new Error("This file is not in the local IPFS simulation of this browser. Use Pinata mode to share files across devices.");
  }
  return new Uint8Array(buf);
}
