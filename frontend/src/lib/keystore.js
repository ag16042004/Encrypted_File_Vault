// ---------------------------------------------------------------------------
// The "vault account": a small encrypted keystore kept in this browser.
//
//   master password --PBKDF2--> KEK --unwraps--> Vault Key (VK)
//   recovery key    --HKDF-->   RK --unwraps--> Vault Key (VK)
//   VK seals: your sharing private key, your 2FA secret, folders and activity
//
// Nothing here is ever sent to a server. The blockchain identity (MetaMask
// wallet) is separate: the wallet signs transactions, the vault key decrypts files.
// ---------------------------------------------------------------------------
import {
  PBKDF2_ITERATIONS, randomBytes, importAesKey, deriveKek, deriveRecoveryKek, generateRecoveryKey,
  generateEcdhPair, importEcdhPrivate, sealBytes, openBytes, sealText, openText, sealJson, openJson,
  isValidRecoveryKey,
} from "./crypto.js";
import { toB64, fromB64 } from "./encoding.js";

const KS = "efv:keystore:";
const LAST_EMAIL = "efv:lastEmail";

export class VaultError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const normEmail = (e) => String(e || "").trim().toLowerCase();

const emptyState = () => ({ folders: [], assign: {}, trashed: {}, hidden: {}, names: {}, activity: [] });

function read(email) {
  const raw = localStorage.getItem(KS + normEmail(email));
  return raw ? JSON.parse(raw) : null;
}
function write(ks) {
  localStorage.setItem(KS + ks.email, JSON.stringify(ks));
}

export const accountExists = (email) => !!read(email);
export const rememberEmail = (email) => localStorage.setItem(LAST_EMAIL, normEmail(email));
export const forgetEmail = () => localStorage.removeItem(LAST_EMAIL);
export const lastEmail = () => localStorage.getItem(LAST_EMAIL) || "";

async function buildSession(ks, vkRaw) {
  const vk = await importAesKey(vkRaw);
  const ecdhPrivate = await importEcdhPrivate(await openBytes(vk, ks.ecdh.privateKey));
  return {
    email: ks.email,
    name: ks.name,
    vk,
    ecdhPrivate,
    publicKey: ks.ecdh.publicKey,
    twofaEnabled: !!ks.twofa.enabled,
    twofaSecret: ks.twofa.secret ? await openText(vk, ks.twofa.secret) : null,
    settings: { autoLockMinutes: 5, ...ks.settings },
    state: { ...emptyState(), ...(await openJson(vk, ks.state)) },
  };
}

async function unwrapWithPassword(ks, password) {
  const kek = await deriveKek(password, fromB64(ks.kdf.salt), ks.kdf.iterations);
  try {
    return await openBytes(kek, ks.vk);
  } catch {
    throw new VaultError("INVALID", "Email or password is incorrect.");
  }
}

// ------------------------------------------------------------ create / open
export async function createAccount({ name, email, password }) {
  const key = normEmail(email);
  if (read(key)) throw new VaultError("EXISTS", "A vault with this email already exists on this device.");

  const salt = randomBytes(16);
  const kek = await deriveKek(password, salt);
  const vkRaw = randomBytes(32);
  const vk = await importAesKey(vkRaw);

  const recoveryKey = generateRecoveryKey();
  const rSalt = randomBytes(16);
  const rKek = await deriveRecoveryKek(recoveryKey, rSalt);
  const pair = await generateEcdhPair();

  const ks = {
    v: 1,
    name: name.trim(),
    email: key,
    createdAt: Date.now(),
    kdf: { alg: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: toB64(salt) },
    vk: await sealBytes(kek, vkRaw),
    recovery: {
      salt: toB64(rSalt),
      vk: await sealBytes(rKek, vkRaw),
      sealedKey: await sealText(vk, recoveryKey),
    },
    ecdh: { publicKey: pair.publicKey, privateKey: await sealBytes(vk, pair.privatePkcs8) },
    twofa: { enabled: false, secret: null },
    settings: { autoLockMinutes: 5 },
    state: await sealJson(vk, emptyState()),
  };
  write(ks);
  return { recoveryKey, session: await buildSession(ks, vkRaw) };
}

export async function unlock(email, password) {
  const ks = read(email);
  if (!ks) {
    // Spend the same time as a real attempt so the response does not reveal which emails exist.
    await deriveKek(password, randomBytes(16));
    throw new VaultError("INVALID", "Email or password is incorrect.");
  }
  return buildSession(ks, await unwrapWithPassword(ks, password));
}

/** Re-checks the master password for sensitive actions. Returns the raw vault key. */
export async function confirmPassword(email, password) {
  const ks = read(email);
  if (!ks) throw new VaultError("INVALID", "Vault not found on this device.");
  return unwrapWithPassword(ks, password);
}

// ------------------------------------------------------- password / recovery
async function rewrapWithPassword(ks, vkRaw, newPassword) {
  const salt = randomBytes(16);
  const kek = await deriveKek(newPassword, salt);
  ks.kdf = { alg: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: toB64(salt) };
  ks.vk = await sealBytes(kek, vkRaw);
  write(ks);
}

export async function changePassword(email, oldPassword, newPassword) {
  const ks = read(email);
  const vkRaw = await unwrapWithPassword(ks, oldPassword);
  await rewrapWithPassword(ks, vkRaw, newPassword);
}

export async function resetPasswordWithRecoveryKey(email, recoveryKey, newPassword) {
  const ks = read(email);
  if (!ks || !isValidRecoveryKey(recoveryKey)) throw new VaultError("INVALID", "That recovery key doesn't match this vault.");
  let vkRaw;
  try {
    const rKek = await deriveRecoveryKek(recoveryKey, fromB64(ks.recovery.salt));
    vkRaw = await openBytes(rKek, ks.recovery.vk);
  } catch {
    throw new VaultError("INVALID", "That recovery key doesn't match this vault.");
  }
  await rewrapWithPassword(ks, vkRaw, newPassword);
  return buildSession(ks, vkRaw);
}

export async function revealRecoveryKey(session) {
  const ks = read(session.email);
  return openText(session.vk, ks.recovery.sealedKey);
}

/** Creates a brand-new recovery key. The previous one stops working. */
export async function regenerateRecoveryKey(session, password) {
  const ks = read(session.email);
  const vkRaw = await unwrapWithPassword(ks, password);
  const key = generateRecoveryKey();
  const salt = randomBytes(16);
  const rKek = await deriveRecoveryKek(key, salt);
  ks.recovery = { salt: toB64(salt), vk: await sealBytes(rKek, vkRaw), sealedKey: await sealText(session.vk, key) };
  write(ks);
  return key;
}

// ------------------------------------------------------------ settings, 2FA
export async function setTwoFa(session, secretOrNull) {
  const ks = read(session.email);
  ks.twofa = secretOrNull
    ? { enabled: true, secret: await sealText(session.vk, secretOrNull) }
    : { enabled: false, secret: null };
  write(ks);
  session.twofaEnabled = !!secretOrNull;
  session.twofaSecret = secretOrNull;
}

export function setSettings(session, patch) {
  const ks = read(session.email);
  ks.settings = { ...ks.settings, ...patch };
  write(ks);
  session.settings = { ...session.settings, ...patch };
}

export async function saveState(session, state) {
  const ks = read(session.email);
  ks.state = await sealJson(session.vk, state);
  write(ks);
  session.state = state;
}

// ------------------------------------------------------------- backup / delete
export function exportKeystore(email) {
  const ks = read(email);
  if (!ks) throw new VaultError("INVALID", "Vault not found.");
  return JSON.stringify(ks, null, 2);
}

export function importKeystore(json) {
  let ks;
  try {
    ks = JSON.parse(json);
  } catch {
    throw new VaultError("BAD_FILE", "That file is not a valid vault backup.");
  }
  if (!ks || ks.v !== 1 || !ks.email || !ks.kdf || !ks.vk || !ks.recovery || !ks.ecdh) {
    throw new VaultError("BAD_FILE", "That file is not a valid vault backup.");
  }
  ks.email = normEmail(ks.email);
  write(ks);
  return ks.email;
}

export function deleteAccount(email) {
  localStorage.removeItem(KS + normEmail(email));
}
