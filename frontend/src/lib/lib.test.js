import { describe, it, expect, beforeAll } from "vitest";
import {
  sha256, importAesKey, aesEncrypt, aesDecrypt, newFileKey, encryptFile, decryptFile, sealText, openText,
  generateEcdhPair, importEcdhPrivate, eciesSeal, eciesOpen, generateRecoveryKey, normalizeRecoveryKey,
  isValidRecoveryKey, randomBytes,
} from "./crypto.js";
import { toHex, fromB64, enc } from "./encoding.js";
import { base32Decode, base32Encode, totpAt, verifyTotp, generateTotpSecret } from "./totp.js";
import * as ks from "./keystore.js";
import { cidForBytes } from "./ipfs.js";
import { passwordChecks, formatBytes, formatDate, fileKind, timeAgo } from "./format.js";

// minimal localStorage for the keystore tests
beforeAll(() => {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
});

describe("crypto", () => {
  it("sha256 matches the standard test vector", async () => {
    expect(toHex(await sha256(enc.encode("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("AES-256-GCM round trip and tamper detection", async () => {
    const key = await importAesKey(newFileKey());
    const packed = await aesEncrypt(key, enc.encode("secret data"));
    expect(new TextDecoder().decode(await aesDecrypt(key, packed))).toBe("secret data");
    const bad = packed.slice();
    bad[bad.length - 1] ^= 1; // flip one bit in the tag
    await expect(aesDecrypt(key, bad)).rejects.toThrow();
    const bad2 = packed.slice();
    bad2[14] ^= 1; // flip a ciphertext bit
    await expect(aesDecrypt(key, bad2)).rejects.toThrow();
  });

  it("never reuses an IV and rejects a different key", async () => {
    const raw = newFileKey();
    const a = await encryptFile(raw, enc.encode("same"));
    const b = await encryptFile(raw, enc.encode("same"));
    expect(toHex(a.slice(0, 12))).not.toBe(toHex(b.slice(0, 12)));
    await expect(decryptFile(newFileKey(), a)).rejects.toThrow();
  });

  it("encrypts and decrypts a 3 MB file", async () => {
    const data = randomBytes(65536);
    const big = new Uint8Array(3 * 1024 * 1024);
    for (let i = 0; i < big.length; i += data.length) big.set(data.subarray(0, Math.min(data.length, big.length - i)), i);
    const raw = newFileKey();
    const out = await decryptFile(raw, await encryptFile(raw, big));
    expect(toHex(await sha256(out))).toBe(toHex(await sha256(big)));
  });

  it("seals text with a key", async () => {
    const key = await importAesKey(newFileKey());
    expect(await openText(key, await sealText(key, "hello"))).toBe("hello");
  });

  it("ECDH sealing: only the recipient can open it", async () => {
    const alice = await generateEcdhPair();
    const bob = await generateEcdhPair();
    const fileKey = newFileKey();
    const sealed = await eciesSeal(alice.publicKey, fileKey);
    const opened = await eciesOpen(await importEcdhPrivate(alice.privatePkcs8), sealed);
    expect(toHex(opened)).toBe(toHex(fileKey));
    await expect(eciesOpen(await importEcdhPrivate(bob.privatePkcs8), sealed)).rejects.toThrow();
  });

  it("recovery keys have the EFV-XXXX-XXXX-XXXX-XXXX format and normalise", () => {
    const k = generateRecoveryKey();
    expect(k).toMatch(/^EFV(-[A-HJ-NP-Z2-9]{4}){4}$/);
    expect(isValidRecoveryKey(k)).toBe(true);
    expect(isValidRecoveryKey(k.toLowerCase().replace(/-/g, " "))).toBe(true);
    expect(normalizeRecoveryKey("efv-7h9k-2d3m-8q2p-4t6n")).toBe("7H9K2D3M8Q2P4T6N");
    expect(isValidRecoveryKey("EFV-0000-0000-0000-0000")).toBe(false);
  });
});

describe("totp (RFC 6238 test vectors)", () => {
  const secret = base32Encode(enc.encode("12345678901234567890"));
  it("matches the published codes", async () => {
    expect(await totpAt(secret, 59_000)).toBe("287082");
    expect(await totpAt(secret, 1_111_111_109_000)).toBe("081804");
    expect(await totpAt(secret, 1_234_567_890_000)).toBe("005924");
  });
  it("base32 round-trips and verify allows one step of drift", async () => {
    expect(new TextDecoder().decode(base32Decode(secret))).toBe("12345678901234567890");
    expect(await verifyTotp(secret, "287082", 59_000 + 30_000)).toBe(true);
    expect(await verifyTotp(secret, "287082", 59_000 + 90_000)).toBe(false);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{16}$/);
  });
});

describe("keystore", () => {
  const PW = "Correct-Horse-9!battery";
  it("creates, locks out wrong passwords and unlocks", async () => {
    const { session, recoveryKey } = await ks.createAccount({ name: "Aadarsh Gupta", email: "Aadarsh@Example.com", password: PW });
    expect(session.email).toBe("aadarsh@example.com");
    expect(recoveryKey).toMatch(/^EFV-/);
    await expect(ks.createAccount({ name: "x", email: "aadarsh@example.com", password: PW })).rejects.toThrow(/already exists/);
    await expect(ks.unlock("aadarsh@example.com", "wrong password!")).rejects.toThrow(/incorrect/);
    await expect(ks.unlock("nobody@example.com", PW)).rejects.toThrow(/incorrect/);
    const s2 = await ks.unlock("aadarsh@example.com", PW);
    expect(s2.publicKey).toBe(session.publicKey);
    expect(await ks.revealRecoveryKey(s2)).toBe(recoveryKey);
  });

  it("keeps state, 2FA and settings sealed and restores them", async () => {
    const s = await ks.unlock("aadarsh@example.com", PW);
    await ks.saveState(s, { ...s.state, folders: [{ id: "f1", name: "Academic" }] });
    await ks.setTwoFa(s, "JBSWY3DPEHPK3PXP");
    ks.setSettings(s, { autoLockMinutes: 15 });
    const raw = localStorage.getItem("efv:keystore:aadarsh@example.com");
    expect(raw).not.toContain("Academic");
    expect(raw).not.toContain("JBSWY3DPEHPK3PXP");
    const s2 = await ks.unlock("aadarsh@example.com", PW);
    expect(s2.state.folders[0].name).toBe("Academic");
    expect(s2.twofaEnabled && s2.twofaSecret).toBe("JBSWY3DPEHPK3PXP");
    expect(s2.settings.autoLockMinutes).toBe(15);
  });

  it("changes the password and keeps the same vault key", async () => {
    const before = await ks.unlock("aadarsh@example.com", PW);
    await ks.changePassword("aadarsh@example.com", PW, "New-Passw0rd#2026!");
    await expect(ks.unlock("aadarsh@example.com", PW)).rejects.toThrow();
    const after = await ks.unlock("aadarsh@example.com", "New-Passw0rd#2026!");
    expect(after.publicKey).toBe(before.publicKey);
    // data sealed with the old session still opens with the new one
    const sealed = await sealText(before.vk, "same vault key");
    expect(await openText(after.vk, sealed)).toBe("same vault key");
  });

  it("resets the password with the recovery key and can regenerate it", async () => {
    const s = await ks.unlock("aadarsh@example.com", "New-Passw0rd#2026!");
    const rk = await ks.revealRecoveryKey(s);
    await expect(ks.resetPasswordWithRecoveryKey("aadarsh@example.com", "EFV-AAAA-BBBB-CCCC-DDDD", "Whatever-123!xyz")).rejects.toThrow(/recovery key/);
    const s2 = await ks.resetPasswordWithRecoveryKey("aadarsh@example.com", rk.toLowerCase(), "Reset-Pass#4567!");
    expect(s2.publicKey).toBe(s.publicKey);
    const fresh = await ks.regenerateRecoveryKey(s2, "Reset-Pass#4567!");
    expect(fresh).not.toBe(rk);
    await expect(ks.resetPasswordWithRecoveryKey("aadarsh@example.com", rk, "Another-One#789!")).rejects.toThrow(/recovery key/);
    await ks.resetPasswordWithRecoveryKey("aadarsh@example.com", fresh, "Final-Pass#9999!");
    await expect(ks.confirmPassword("aadarsh@example.com", "nope nope nope")).rejects.toThrow();
  });

  it("exports and imports a backup", async () => {
    const json = ks.exportKeystore("aadarsh@example.com");
    ks.deleteAccount("aadarsh@example.com");
    expect(ks.accountExists("aadarsh@example.com")).toBe(false);
    expect(ks.importKeystore(json)).toBe("aadarsh@example.com");
    expect(() => ks.importKeystore("{not json")).toThrow();
    expect((await ks.unlock("aadarsh@example.com", "Final-Pass#9999!")).name).toBe("Aadarsh Gupta");
  });
});

describe("storage CID", () => {
  it("produces a CIDv1 (raw, sha2-256) in base32", async () => {
    const cid = await cidForBytes(enc.encode("hello"));
    expect(cid).toMatch(/^bafkrei[a-z2-7]+$/);
    expect(cid).toBe(await cidForBytes(enc.encode("hello")));
    expect(cid).not.toBe(await cidForBytes(enc.encode("hello!")));
  });
});

describe("format helpers", () => {
  it("applies the three password rules from the sign-up form", () => {
    expect(passwordChecks("").map((c) => c.ok)).toEqual([false, false, false]);
    expect(passwordChecks("short1!").map((c) => c.ok)).toEqual([false, true, true]);
    expect(passwordChecks("longenoughpassword").map((c) => c.ok)).toEqual([true, false, true]);
    expect(passwordChecks("password").map((c) => c.ok)[2]).toBe(false);
    expect(passwordChecks("Vault-Key#2026x").every((c) => c.ok)).toBe(true);
  });
  it("formats sizes, dates and kinds", () => {
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatBytes(167.8 * 1024 * 1024)).toBe("168 MB");
    expect(formatBytes(900)).toBe("900 B");
    const now = new Date(2026, 10, 7, 12, 0);
    expect(formatDate(new Date(2026, 10, 7, 10, 24), now)).toBe("Today, 10:24");
    expect(formatDate(new Date(2026, 10, 6, 18, 40), now)).toBe("Yesterday, 18:40");
    expect(formatDate(new Date(2026, 9, 30, 14, 20), now)).toBe("Oct 30, 14:20");
    expect(timeAgo(Date.now() - 2 * 60000)).toBe("2m ago");
    expect(fileKind("Research_Paper.pdf")).toBe("pdf");
    expect(fileKind("a.FIG")).toBe("design");
    expect(fileKind("noext", "image/png")).toBe("image");
  });
});
