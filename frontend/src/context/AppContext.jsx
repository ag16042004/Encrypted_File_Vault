import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as ks from "../lib/keystore.js";
import * as chain from "../lib/chain.js";
import * as storage from "../lib/ipfs.js";
import {
  sha256, newFileKey, encryptFile, decryptFile, importAesKey, sealBytes, openBytes, eciesSeal, eciesOpen,
} from "../lib/crypto.js";
import { dec, enc, toHex } from "../lib/encoding.js";
import { verifyTotp } from "../lib/totp.js";
import { describeDevice, formatBytes, friendlyError } from "../lib/format.js";
import { Toast } from "../components/ui.jsx";
import { isAddress, getAddress } from "ethers";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const MAX_FILE_BYTES = Number(import.meta.env?.VITE_MAX_FILE_MB || 200) * 1024 * 1024;
export const CAPACITY_BYTES = Number(import.meta.env?.VITE_STORAGE_CAPACITY_GB || 50) * 1024 ** 3;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const ACTIVE = ["queued", "hashing", "encrypting", "uploading", "confirming", "recording"];

async function decryptRecord(r, session, addr) {
  const isOwner = r.owner.toLowerCase() === addr;
  const base = { id: r.id, owner: r.owner, isOwner, hash: r.hash, cid: r.cid, uploadedAt: r.uploadedAt };
  try {
    const fk = isOwner ? await openBytes(session.vk, r.key) : await eciesOpen(session.ecdhPrivate, r.key);
    const meta = JSON.parse(dec.decode(await openBytes(await importAesKey(fk), r.encMeta)));
    return { ...base, fk, name: meta.name, mime: meta.type || "", size: meta.size || 0, originalDate: meta.lastModified || null };
  } catch {
    return { ...base, fk: null, unreadable: true, name: `Unreadable file #${r.id}`, mime: "", size: 0, originalDate: null };
  }
}

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [locked, setLocked] = useState(false);
  const [vaultState, setVaultState] = useState(null);
  const [wallet, setWallet] = useState({ status: "disconnected" });
  const [files, setFiles] = useState([]);
  const [filesStatus, setFilesStatus] = useState({ loading: false, error: null, loaded: false });
  const [uploads, setUploads] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [sharing, setSharing] = useState("unknown");
  const [toastState, setToast] = useState(null);
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState(null);

  const sessionRef = useRef(null);
  const walletRef = useRef(wallet);
  const pendingLogin = useRef(null);
  const stateQueue = useRef(Promise.resolve());
  const aborts = useRef({});
  const fileObjs = useRef({});
  const queueBusy = useRef(false);
  const queue = useRef([]);
  const [, bump] = useState(0);
  const toastTimer = useRef(null);
  walletRef.current = wallet;

  const toast = useCallback((message, kind = "ok") => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // ------------------------------------------------------------- vault state
  const updateVaultState = useCallback((fn) => {
    stateQueue.current = stateQueue.current.then(async () => {
      const s = sessionRef.current;
      if (!s) return;
      const next = fn(s.state);
      await ks.saveState(s, next);
      setVaultState(next);
    });
    return stateQueue.current;
  }, []);

  const logActivity = useCallback(
    (type, detail = "", extra = {}) =>
      updateVaultState((st) => ({
        ...st,
        activity: [{ id: uid(), type, at: Date.now(), detail, ...extra }, ...(st.activity || [])].slice(0, 200),
      })),
    [updateVaultState],
  );

  // ------------------------------------------------------------------ session
  const commitSession = useCallback((s, { log = true } = {}) => {
    sessionRef.current = s;
    setSession(s);
    setAccount({ email: s.email, name: s.name });
    setVaultState(s.state);
    setLocked(false);
    if (log) logActivity("unlock", `From ${describeDevice()}`);
  }, [logActivity]);

  const login = useCallback(async (email, password, remember) => {
    const s = await ks.unlock(email, password);
    if (remember) ks.rememberEmail(email); else ks.forgetEmail();
    if (s.twofaEnabled) {
      pendingLogin.current = s;
      return { needs2fa: true };
    }
    commitSession(s);
    return { needs2fa: false };
  }, [commitSession]);

  const submit2fa = useCallback(async (code) => {
    const s = pendingLogin.current;
    if (!s) return false;
    if (!(await verifyTotp(s.twofaSecret, code))) return false;
    pendingLogin.current = null;
    commitSession(s);
    return true;
  }, [commitSession]);

  const cancelPending = useCallback(() => { pendingLogin.current = null; }, []);

  const register = useCallback(async ({ name, email, password }) => {
    const { session: s, recoveryKey } = await ks.createAccount({ name, email, password });
    ks.rememberEmail(email);
    setPendingRecoveryKey(recoveryKey);
    commitSession(s, { log: false });
    await logActivity("created", "Vault created on this device");
    return recoveryKey;
  }, [commitSession, logActivity]);

  const resetWithRecovery = useCallback(async (email, recoveryKey, newPassword) => {
    const s = await ks.resetPasswordWithRecoveryKey(email, recoveryKey, newPassword);
    commitSession(s, { log: false });
    await logActivity("password", "Master password reset with recovery key");
  }, [commitSession, logActivity]);

  const lockVault = useCallback(() => {
    if (!sessionRef.current) return;
    for (const [id, c] of Object.entries(aborts.current)) { c.abort(); delete aborts.current[id]; }
    queue.current = [];
    sessionRef.current = null;
    setSession(null);
    setFiles([]);
    setFilesStatus({ loading: false, error: null, loaded: false });
    setUploads((u) => u.map((x) => (ACTIVE.includes(x.status) ? { ...x, status: "error", error: "Stopped because the vault was locked.", label: "Stopped" } : x)));
    setLocked(true);
  }, []);

  const unlockVault = useCallback(async (password) => {
    const s = await ks.unlock(account.email, password);
    commitSession(s);
  }, [account, commitSession]);

  const logout = useCallback(() => {
    for (const c of Object.values(aborts.current)) c.abort();
    aborts.current = {};
    sessionRef.current = null;
    pendingLogin.current = null;
    setSession(null); setAccount(null); setLocked(false); setVaultState(null);
    setFiles([]); setUploads([]); setUploadResult(null); setPendingRecoveryKey(null);
    setFilesStatus({ loading: false, error: null, loaded: false });
    setSharing("unknown");
  }, []);

  // ------------------------------------------------------------------- wallet
  const applyWallet = useCallback((snap) => {
    setWallet(snap
      ? { status: "connected", address: snap.address, chainId: snap.chainId, provider: snap.provider, signer: snap.signer }
      : { status: "disconnected" });
  }, []);

  const connectWallet = useCallback(async () => {
    const snap = await chain.connectWallet();
    applyWallet(snap);
    return snap;
  }, [applyWallet]);

  const switchNetwork = useCallback(async () => {
    await chain.switchToTarget();
    applyWallet(await chain.reconnectWallet());
  }, [applyWallet]);

  useEffect(() => {
    if (!chain.hasWallet()) return;
    const eth = window.ethereum;
    const sync = async () => {
      try { applyWallet(await chain.reconnectWallet()); } catch { applyWallet(null); }
    };
    eth.on?.("accountsChanged", sync);
    eth.on?.("chainChanged", sync);
    return () => {
      eth.removeListener?.("accountsChanged", sync);
      eth.removeListener?.("chainChanged", sync);
    };
  }, [applyWallet]);

  // silently re-attach an already approved wallet once the vault is open
  useEffect(() => {
    if (session && walletRef.current.status !== "connected") {
      chain.reconnectWallet().then((snap) => snap && applyWallet(snap)).catch(() => {});
    }
  }, [session, applyWallet]);

  const walletReady = wallet.status === "connected" && wallet.chainId === chain.TARGET_CHAIN_ID && !!chain.contractAddress(wallet.chainId);

  const ensureReady = useCallback(async () => {
    let w = walletRef.current;
    if (w.status !== "connected") {
      const snap = await connectWallet();
      w = { ...snap, status: "connected" };
    }
    if (w.chainId !== chain.TARGET_CHAIN_ID) {
      await chain.switchToTarget();
      const snap = await chain.reconnectWallet();
      applyWallet(snap);
      w = { ...snap, status: "connected" };
    }
    if (w.chainId !== chain.TARGET_CHAIN_ID) throw new Error(`Please switch your wallet to ${chain.targetChain().name}.`);
    return { vault: chain.vaultContract(w.signer, w.chainId), address: w.address, provider: w.provider, chainId: w.chainId };
  }, [applyWallet, connectWallet]);

  /** Read-only access without any wallet prompt; null when not connected. */
  const getReadVault = useCallback(() => {
    const w = walletRef.current;
    if (w.status !== "connected" || w.chainId !== chain.TARGET_CHAIN_ID || !chain.contractAddress(w.chainId)) return null;
    return { vault: chain.vaultContract(w.signer, w.chainId), address: w.address, provider: w.provider, chainId: w.chainId };
  }, []);

  // -------------------------------------------------------------------- files
  const refreshFiles = useCallback(async () => {
    const s = sessionRef.current;
    const ctx = getReadVault();
    if (!s || !ctx) {
      setFiles([]);
      setFilesStatus({ loading: false, error: null, loaded: false });
      return;
    }
    setFilesStatus((p) => ({ ...p, loading: true, error: null }));
    try {
      const sealed = await chain.fetchSealedFiles(ctx.vault);
      const addr = ctx.address.toLowerCase();
      const out = await Promise.all(sealed.map((r) => decryptRecord(r, s, addr)));
      if (sessionRef.current !== s) return; // locked meanwhile
      setFiles(out);
      setFilesStatus({ loading: false, error: null, loaded: true });
      const pk = await ctx.vault.getPublicKey(ctx.address);
      setSharing(pk === s.publicKey ? "ready" : "missing");
      // remember readable names so the activity log can still show deleted files
      const known = s.state.names || {};
      const additions = {};
      for (const f of out) if (!f.unreadable && !known[f.id]) additions[f.id] = { name: f.name, size: f.size };
      if (Object.keys(additions).length) updateVaultState((st) => ({ ...st, names: { ...(st.names || {}), ...additions } }));
    } catch (e) {
      setFilesStatus({ loading: false, error: friendlyError(e), loaded: false });
    }
  }, [getReadVault, updateVaultState]);

  useEffect(() => {
    if (session && walletReady) refreshFiles();
    else if (!session) setFiles([]);
  }, [session, walletReady, wallet.address, wallet.chainId, refreshFiles]);

  // visible = not trashed, not hidden
  const trashed = vaultState?.trashed || {};
  const hidden = vaultState?.hidden || {};
  const visibleFiles = useMemo(() => files.filter((f) => !trashed[f.id] && !hidden[f.id]), [files, trashed, hidden]);
  const trashedFiles = useMemo(() => files.filter((f) => trashed[f.id] && !hidden[f.id]), [files, trashed, hidden]);

  // ------------------------------------------------------------------ uploads
  const patchUpload = useCallback((id, patch) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u))), []);

  const runUpload = useCallback(async (item) => {
    const file = fileObjs.current[item.id];
    const ctl = new AbortController();
    aborts.current[item.id] = ctl;
    const s = sessionRef.current;
    try {
      if (!s) throw new Error("The vault is locked.");
      if (file.size > MAX_FILE_BYTES) throw new Error(`Files larger than ${formatBytes(MAX_FILE_BYTES)} are not supported.`);
      patchUpload(item.id, { status: "hashing", label: "Preparing…", progress: 3, error: null });
      const { vault } = await ensureReady();
      if (ctl.signal.aborted) throw new DOMException("cancelled", "AbortError");

      const data = new Uint8Array(await file.arrayBuffer());
      patchUpload(item.id, { label: "Hashing…", progress: 8 });
      const hashHex = "0x" + toHex(await sha256(data));
      if (ctl.signal.aborted) throw new DOMException("cancelled", "AbortError");

      patchUpload(item.id, { status: "encrypting", label: "Encrypting…", progress: 15 });
      const fkRaw = newFileKey();
      const packed = await encryptFile(fkRaw, data);
      if (ctl.signal.aborted) throw new DOMException("cancelled", "AbortError");

      patchUpload(item.id, { status: "uploading", label: "Uploading to IPFS…", progress: 30 });
      const cid = await storage.putEncrypted(packed, {
        signal: ctl.signal,
        onProgress: (p) => patchUpload(item.id, { progress: 30 + p * 55 }),
      });

      const meta = { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified };
      const encMeta = await sealBytes(await importAesKey(fkRaw), enc.encode(JSON.stringify(meta)));
      const ownerKey = await sealBytes(s.vk, fkRaw);

      patchUpload(item.id, { status: "confirming", label: "Confirm in your wallet…", progress: 88 });
      const { id: fileId, txHash } = await chain.sendUpload(vault, { hashHex, cid, encMeta, ownerKey }, () =>
        patchUpload(item.id, { status: "recording", label: "Recording on blockchain…", progress: 94 }));

      patchUpload(item.id, { status: "done", label: "Done", progress: 100, fileId, txHash });
      delete fileObjs.current[item.id];
      await refreshFiles();
      setUploadResult({ type: "success", name: file.name, fileId });
    } catch (e) {
      if (e?.name === "AbortError") {
        patchUpload(item.id, { status: "cancelled", label: "Cancelled" });
      } else {
        const msg = friendlyError(e);
        patchUpload(item.id, { status: "error", label: "Failed", error: msg });
        setUploadResult({ type: "error", name: file?.name, itemId: item.id, detail: msg });
      }
    } finally {
      delete aborts.current[item.id];
    }
  }, [ensureReady, patchUpload, refreshFiles]);

  const pump = useCallback(async () => {
    if (queueBusy.current) return;
    queueBusy.current = true;
    try {
      while (queue.current.length) {
        const id = queue.current.shift();
        if (!fileObjs.current[id]) continue; // cancelled while waiting
        await runUpload({ id });
      }
    } finally {
      queueBusy.current = false;
    }
  }, [runUpload]);

  const uploadFiles = useCallback((fileList) => {
    const items = Array.from(fileList).map((f) => {
      const id = uid();
      fileObjs.current[id] = f;
      return { id, name: f.name, size: f.size, mime: f.type, status: "queued", label: "Queued", progress: 0, error: null };
    });
    if (!items.length) return;
    setUploads((u) => [...items, ...u]);
    queue.current.push(...items.map((i) => i.id));
    setTimeout(pump, 0);
  }, [pump]);

  const cancelUpload = useCallback((id) => {
    if (aborts.current[id]) aborts.current[id].abort();
    else { patchUpload(id, { status: "cancelled", label: "Cancelled" }); delete fileObjs.current[id]; }
  }, [patchUpload]);

  const retryUpload = useCallback((id) => {
    if (!fileObjs.current[id]) return;
    setUploadResult(null);
    patchUpload(id, { status: "queued", label: "Queued", progress: 0, error: null });
    queue.current.push(id);
    setTimeout(pump, 0);
  }, [patchUpload, pump]);

  const dismissUpload = useCallback((id) => {
    delete fileObjs.current[id];
    setUploads((u) => u.filter((x) => x.id !== id));
  }, []);

  const activeUploads = uploads.filter((u) => ACTIVE.includes(u.status)).length;

  // ----------------------------------------------------- open / verify / save
  const openFile = useCallback(async (file) => {
    if (!file.fk) throw new Error("This file was uploaded with a different vault key and cannot be decrypted here.");
    const packed = await storage.getEncrypted(file.cid);
    let bytes;
    try {
      bytes = await decryptFile(file.fk, packed); // AES-GCM authentication fails if even one bit was changed
    } catch {
      throw new Error("Integrity check failed: the stored data was changed or damaged, so it was not opened.");
    }
    const hash = "0x" + toHex(await sha256(bytes));
    return { bytes, hash, hashOk: hash === file.hash.toLowerCase() };
  }, []);

  const verifyFile = useCallback(async (file) => {
    const { vault } = await ensureReady();
    const { hash, hashOk } = await openFile(file);
    const onchain = await chain.verifyOnChain(vault, file.id, hash);
    return { ok: hashOk && onchain, hash };
  }, [ensureReady, openFile]);

  const downloadFile = useCallback(async (file) => {
    const { bytes, hashOk } = await openFile(file);
    if (!hashOk) throw new Error("Integrity check failed: the decrypted file does not match the hash stored on the blockchain.");
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    logActivity("download", `${file.name} (${formatBytes(file.size)})`);
  }, [openFile, logActivity]);

  // -------------------------------------------------------- trash / folders
  const moveToTrash = useCallback((ids) =>
    updateVaultState((st) => {
      const t = { ...st.trashed };
      ids.forEach((id) => { t[id] = Date.now(); });
      return { ...st, trashed: t };
    }), [updateVaultState]);

  const restoreFiles = useCallback((ids) =>
    updateVaultState((st) => {
      const t = { ...st.trashed };
      ids.forEach((id) => { delete t[id]; });
      return { ...st, trashed: t };
    }), [updateVaultState]);

  const deleteForever = useCallback(async (file) => {
    if (file.isOwner) {
      const { vault } = await ensureReady();
      await chain.sendTx(vault.deleteFile(file.id));
      await updateVaultState((st) => {
        const t = { ...st.trashed }; delete t[file.id];
        const a = { ...st.assign }; delete a[file.id];
        return { ...st, trashed: t, assign: a };
      });
      await refreshFiles();
    } else {
      await updateVaultState((st) => ({ ...st, hidden: { ...st.hidden, [file.id]: true } }));
    }
  }, [ensureReady, refreshFiles, updateVaultState]);

  const createFolder = useCallback((name) =>
    updateVaultState((st) => ({ ...st, folders: [...st.folders, { id: uid(), name: name.trim(), createdAt: Date.now() }] })), [updateVaultState]);

  const deleteFolder = useCallback((folderId) =>
    updateVaultState((st) => {
      const a = { ...st.assign };
      for (const k of Object.keys(a)) if (a[k] === folderId) delete a[k];
      return { ...st, folders: st.folders.filter((f) => f.id !== folderId), assign: a };
    }), [updateVaultState]);

  const moveToFolder = useCallback((ids, folderId) =>
    updateVaultState((st) => {
      const a = { ...st.assign };
      ids.forEach((id) => { if (folderId) a[id] = folderId; else delete a[id]; });
      return { ...st, assign: a };
    }), [updateVaultState]);

  // ------------------------------------------------------------------ sharing
  const loadAccessList = useCallback(async (file) => {
    const { vault } = await ensureReady();
    return chain.fetchAccessList(vault, file.id);
  }, [ensureReady]);

  const grantAccess = useCallback(async (file, address) => {
    if (!isAddress(address)) throw new Error("That is not a valid wallet address.");
    const checksummed = getAddress(address);
    const { vault, address: me } = await ensureReady();
    if (checksummed.toLowerCase() === me.toLowerCase()) throw new Error("You already own this file.");
    const pub = await chain.fetchPublicKey(vault, checksummed);
    if (!pub) throw new Error("That wallet has not enabled sharing yet. Ask them to open EFV and tap “Enable sharing”.");
    const sealedKey = await eciesSeal(pub, file.fk);
    await chain.sendTx(vault.grantAccess(file.id, checksummed, sealedKey));
    return checksummed;
  }, [ensureReady]);

  const revokeAccess = useCallback(async (file, address) => {
    const { vault } = await ensureReady();
    await chain.sendTx(vault.revokeAccess(file.id, address));
  }, [ensureReady]);

  const enableSharing = useCallback(async () => {
    const { vault } = await ensureReady();
    await chain.sendTx(vault.registerPublicKey(sessionRef.current.publicKey));
    setSharing("ready");
  }, [ensureReady]);

  // ----------------------------------------------------------------- settings
  const touchSession = useCallback(() => bump((n) => n + 1), []);

  const setAutoLock = useCallback((minutes) => {
    ks.setSettings(sessionRef.current, { autoLockMinutes: minutes });
    bump((n) => n + 1);
  }, []);

  const value = {
    account, session, locked, vaultState, wallet, walletReady, files, visibleFiles, trashedFiles, filesStatus,
    uploads, activeUploads, uploadResult, sharing, pendingRecoveryKey,
    toast, login, submit2fa, cancelPending, register, resetWithRecovery, lockVault, unlockVault, logout,
    connectWallet, switchNetwork, ensureReady, getReadVault, refreshFiles,
    uploadFiles, cancelUpload, retryUpload, dismissUpload, setUploadResult,
    openFile, verifyFile, downloadFile, moveToTrash, restoreFiles, deleteForever,
    createFolder, deleteFolder, moveToFolder, loadAccessList, grantAccess, revokeAccess, enableSharing,
    updateVaultState, logActivity, setAutoLock, setPendingRecoveryKey, touchSession,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <Toast toast={toastState} />
    </Ctx.Provider>
  );
}
