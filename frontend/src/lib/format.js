// Display helpers: sizes, dates, file kinds, password rules.

export function formatBytes(n) {
  if (n === 0) return "0 B";
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today, 10:24" / "Yesterday, 18:40" / "Oct 30, 14:20" */
export function formatDate(ts, now = new Date()) {
  const d = new Date(ts);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

/** "2m ago" / "1h ago" / "3d ago" */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return formatDate(ts);
}

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const shortCid = (c) => (c && c.length > 18 ? `${c.slice(0, 10)}…${c.slice(-6)}` : c || "");
export const initials = (name) =>
  (name || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("") || "?";
export const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "there";

// ------------------------------------------------------------ file kinds
const EXT = {
  pdf: "pdf",
  doc: "doc", docx: "doc", rtf: "doc", odt: "doc",
  txt: "text", md: "text", csv: "sheet", xls: "sheet", xlsx: "sheet",
  zip: "zip", rar: "zip", "7z": "zip", tar: "zip", gz: "zip",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image",
  fig: "design", psd: "design", ai: "design", sketch: "design",
  mp4: "video", mov: "video", mkv: "video", mp3: "audio", wav: "audio",
};

export function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function fileKind(name = "", mime = "") {
  const byExt = EXT[extOf(name)];
  if (byExt) return byExt;
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

export function typeLabel(name = "", mime = "") {
  const ext = extOf(name);
  if (ext) return ext.toUpperCase();
  return mime ? mime.split("/").pop().toUpperCase() : "FILE";
}

export const isPreviewable = (kind) => ["pdf", "image", "text"].includes(kind);

// -------------------------------------------------------- password rules
const COMMON = new Set([
  "password", "password1", "password123", "123456", "12345678", "123456789", "1234567890", "qwerty",
  "qwerty123", "qwertyuiop", "abc123", "iloveyou", "admin", "welcome", "letmein", "monkey", "dragon",
  "football", "baseball", "master", "login", "princess", "sunshine", "passw0rd", "p@ssw0rd", "111111",
  "000000", "123123", "zaq12wsx", "1q2w3e4r", "trustno1", "changeme", "secret", "whatever", "freedom",
]);

function isCommon(pw) {
  const p = pw.toLowerCase();
  if (COMMON.has(p)) return true;
  const letters = p.replace(/[^a-z]/g, "");
  if (letters.length >= 4 && COMMON.has(letters)) return true;
  if (/^(.)\1+$/.test(p)) return true; // aaaaaaaaaaaa
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop|asdfghjkl)/.test(p) && p.length < 16) return true;
  return false;
}

/** The three rules shown next to the Create Vault form. */
export function passwordChecks(pw) {
  return [
    { ok: pw.length >= 12, label: "At least 12 characters" },
    { ok: /\d/.test(pw) && /[^A-Za-z0-9\s]/.test(pw), label: "Include a number and symbol" },
    { ok: pw.length > 0 && !isCommon(pw), label: "Not a common password" },
  ];
}
export const passwordOk = (pw) => passwordChecks(pw).every((c) => c.ok);

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim());

// ------------------------------------------------------------ device text
export function describeDevice(ua = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  const os = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Unknown OS";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

export function friendlyError(e) {
  const code = e?.code ?? e?.info?.error?.code;
  const msg = String(e?.shortMessage || e?.reason || e?.message || e || "");
  if (code === 4001 || code === "ACTION_REJECTED" || /user rejected|user denied/i.test(msg)) {
    return "You rejected the request in your wallet.";
  }
  if (/insufficient funds/i.test(msg)) return "Your wallet has not enough ETH to pay the network fee.";
  if (/network|fetch|failed to fetch/i.test(msg) && !/chain/i.test(msg)) return "Network error. Please check your internet connection.";
  return msg.replace(/\s*\(action=.*$/s, "").slice(0, 220) || "Something went wrong.";
}
