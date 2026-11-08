import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import {
  Download, Printer, ClipboardCheck, Copy, CheckCircle2, AlertTriangle, RefreshCw, Share2, Trash2, Loader2, UserPlus, KeyRound,
  Check, X,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { Modal, FileTile, PasswordField } from "./ui.jsx";
import * as ks from "../lib/keystore.js";
import { generateTotpSecret, formatSecret, otpauthUri, verifyTotp } from "../lib/totp.js";
import { fileKind, typeLabel, isPreviewable, formatBytes, formatDate, shortCid, shortAddr, friendlyError, passwordChecks, passwordOk } from "../lib/format.js";
import { downloadRecoveryKey, printRecoveryKey, copyText } from "./recoveryTools.js";

// ================================================================ upload result
export function UploadResultModal() {
  const { uploadResult, setUploadResult, retryUpload, cancelUpload } = useApp();
  const nav = useNavigate();
  if (!uploadResult) return null;
  const close = () => setUploadResult(null);

  if (uploadResult.type === "success") {
    return (
      <Modal onClose={close} className="center" label="Upload complete">
        <div className="m-ic good"><CheckCircle2 /></div>
        <h2>File Uploaded Successfully</h2>
        <p>“{uploadResult.name}” has been encrypted and saved to your vault.</p>
        <div className="m-actions">
          <button className="btn btn-primary" onClick={() => { close(); nav(`/files?open=${uploadResult.fileId}`); }}>View File</button>
          <button className="btn btn-grey" onClick={() => { close(); nav("/upload"); }}>Upload Another</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal onClose={close} className="center" label="Upload failed">
      <div className="m-ic bad"><AlertTriangle /></div>
      <h2>Upload Failed</h2>
      <p>The file could not be uploaded. Please check your internet connection and try again.</p>
      {uploadResult.detail && <p className="detail">{uploadResult.detail}</p>}
      <div className="m-actions">
        <button className="btn btn-primary" onClick={() => retryUpload(uploadResult.itemId)}><RefreshCw /> Retry</button>
        <button className="btn btn-grey" onClick={() => { cancelUpload(uploadResult.itemId); close(); }}>Cancel</button>
      </div>
    </Modal>
  );
}

// ==================================================================== preview
function mimeFor(file, kind) {
  if (file.mime) return file.mime;
  if (kind === "pdf") return "application/pdf";
  if (kind === "image") return "image/png";
  return "application/octet-stream";
}

export function PreviewModal({ file, onClose, onShare, onTrash }) {
  const { openFile, verifyFile, downloadFile, toast } = useApp();
  const kind = fileKind(file.name, file.mime);
  const [view, setView] = useState({ status: "loading" });
  const [integrity, setIntegrity] = useState("checking"); // checking | ok | chain | bad
  const [busy, setBusy] = useState(false);
  const urlRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { bytes, hashOk } = await openFile(file);
        if (!alive) return;
        if (!hashOk) {
          setIntegrity("bad");
          setView({ status: "error", message: "Integrity check failed: the decrypted file does not match the hash stored on the blockchain." });
          return;
        }
        setIntegrity("ok");
        if (kind === "text") {
          setView({ status: "ready", text: new TextDecoder().decode(bytes.subarray(0, 200_000)), truncated: bytes.length > 200_000 });
        } else if (isPreviewable(kind)) {
          urlRef.current = URL.createObjectURL(new Blob([bytes], { type: mimeFor(file, kind) }));
          setView({ status: "ready", url: urlRef.current });
        } else {
          setView({ status: "ready" });
        }
      } catch (e) {
        if (!alive) return;
        setIntegrity("bad");
        setView({ status: "error", message: friendlyError(e) });
      }
    })();
    return () => {
      alive = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(friendlyError(e), "bad"); } finally { setBusy(false); }
  };

  const doVerify = () => act(async () => {
    const { ok } = await verifyFile(file);
    setIntegrity(ok ? "chain" : "bad");
    toast(ok ? "Verified: the file matches the hash on the blockchain." : "Verification failed: the file does not match the blockchain.", ok ? "ok" : "bad");
  });

  const doPrint = () => {
    if (view.status !== "ready") return;
    if (kind === "pdf" && frameRef.current) {
      try { frameRef.current.contentWindow.focus(); frameRef.current.contentWindow.print(); return; } catch { /* fall through */ }
    }
    if (view.url) { window.open(view.url, "_blank", "noopener"); return; }
    if (view.text !== undefined) {
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(`<pre style="font:13px ui-monospace,monospace;white-space:pre-wrap"></pre>`);
        w.document.querySelector("pre").textContent = view.text;
        w.document.close();
        w.print();
      }
    }
  };

  const integrityText = { checking: "Checking…", ok: "Matches on-chain hash", chain: "Verified on blockchain", bad: "Not verified" }[integrity];

  return (
    <Modal onClose={onClose} className="preview" label={`Preview of ${file.name}`}>
      <div className="p-head">
        <h2 title={file.name}>{file.name}</h2>
        <div className="p-tools" style={{ marginRight: 40 }}>
          <button onClick={() => act(() => downloadFile(file))} disabled={busy || view.status !== "ready"} aria-label="Download" title="Download (decrypted)"><Download /></button>
          <button onClick={doPrint} disabled={view.status !== "ready" || kind === "other"} aria-label="Print" title="Print"><Printer /></button>
          <button onClick={doVerify} disabled={busy} aria-label="Verify integrity" title="Verify integrity on the blockchain"><ClipboardCheck /></button>
        </div>
      </div>
      <div className="p-body">
        <div className="p-doc">
          <div className="paper">
            {view.status === "loading" && <div className="p-load"><Loader2 className="spin" /><span>Downloading and decrypting…</span></div>}
            {view.status === "error" && (
              <div className="nopv"><div style={{ color: "#c13c62", marginBottom: 8 }}><AlertTriangle size={34} /></div><b>Cannot open this file</b><p style={{ marginTop: 8 }}>{view.message}</p></div>
            )}
            {view.status === "ready" && kind === "pdf" && <iframe ref={frameRef} src={view.url} title={file.name} />}
            {view.status === "ready" && kind === "image" && <img src={view.url} alt={file.name} />}
            {view.status === "ready" && kind === "text" && <pre>{view.text}{view.truncated ? "\n\n… (preview truncated)" : ""}</pre>}
            {view.status === "ready" && !isPreviewable(kind) && (
              <div className="nopv"><FileTile kind={kind} /><b>No preview available</b><p style={{ marginTop: 6 }}>This file type opens after you download it.</p></div>
            )}
          </div>
        </div>
        <aside className="p-side">
          <dl>
            <dt>Type</dt><dd>{typeLabel(file.name, file.mime)}</dd>
            <dt>Size</dt><dd>{formatBytes(file.size)}</dd>
            <dt>Modified</dt><dd>{formatDate(file.uploadedAt)}</dd>
            <dt>Encryption</dt><dd>AES-256 (Client-side)</dd>
            <dt>Integrity</dt><dd className={integrity === "bad" ? "bad" : integrity === "checking" ? "" : "ok"}>{integrityText}</dd>
            <dt>IPFS CID</dt>
            <dd style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span title={file.cid}>{shortCid(file.cid)}</span>
              <button className="icon-btn" style={{ background: "none", border: 0, color: "#fff", padding: 2 }} aria-label="Copy CID" onClick={async () => toast((await copyText(file.cid)) ? "CID copied" : "Copy failed", "ok")}><Copy size={14} /></button>
            </dd>
            {!file.isOwner && (<><dt>Owner</dt><dd title={file.owner}>{shortAddr(file.owner)}</dd></>)}
          </dl>
          {file.isOwner && <button className="btn" onClick={() => onShare(file)}><Share2 /> Share access</button>}
          <button className="btn" onClick={() => onTrash(file)}><Trash2 /> Move to trash</button>
        </aside>
      </div>
    </Modal>
  );
}

// ===================================================================== share
export function ShareModal({ file, onClose }) {
  const { loadAccessList, grantAccess, revokeAccess, logActivity, toast } = useApp();
  const [list, setList] = useState(null);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try { setList(await loadAccessList(file)); } catch (e) { setErr(friendlyError(e)); setList([]); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grant = async () => {
    setBusy(true); setErr("");
    try {
      const a = await grantAccess(file, addr.trim());
      setAddr("");
      toast(`Access granted to ${shortAddr(a)}`);
      await load();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const revoke = async (a) => {
    setBusy(true); setErr("");
    try { await revokeAccess(file, a); toast("Access revoked"); await load(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} label="Share file">
      <h2>Share “{file.name}”</h2>
      <p className="m-sub">Give another wallet access. The file key is sealed with their public key, so only they can open it.</p>
      <label className="lbl" htmlFor="share-addr">Wallet address</label>
      <input id="share-addr" className="plain-input" placeholder="0x…" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addr && grant()} spellCheck={false} />
      {err && <div className="form-error" role="alert" style={{ textAlign: "left" }}>{err}</div>}
      <div className="access-list">
        <span className="lbl" style={{ marginTop: 6 }}>People with access</span>
        {list === null && <div className="form-note" style={{ textAlign: "left" }}>Loading…</div>}
        {list && list.length === 0 && <div className="form-note" style={{ textAlign: "left" }}>Only you can open this file.</div>}
        {list && list.map((a) => (
          <div className="a" key={a}>
            <code title={a}>{shortAddr(a)}</code>
            <button className="btn btn-sm btn-grey" disabled={busy} onClick={() => revoke(a)}>Revoke</button>
          </div>
        ))}
      </div>
      <div className="m-actions">
        <button className="btn btn-grey" onClick={onClose}>Close</button>
        <button className="btn btn-primary" disabled={busy || !addr.trim()} onClick={grant}><UserPlus /> {busy ? "Working…" : "Grant Access"}</button>
      </div>
    </Modal>
  );
}

// ====================================================================== 2FA
export function TwoFactorModal({ onClose }) {
  const { session, touchSession, logActivity, toast } = useApp();
  const [secret] = useState(generateTotpSecret);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(otpauthUri(session.email, secret), { margin: 1, width: 280, errorCorrectionLevel: "M" }).then(setQr);
  }, [secret, session.email]);

  const enable = async () => {
    setBusy(true); setErr("");
    try {
      if (!(await verifyTotp(secret, code))) { setErr("That code is not correct. Check your authenticator app and try again."); return; }
      await ks.setTwoFa(session, secret);
      touchSession();
      await logActivity("2fa", "Authenticator app (TOTP)");
      toast("Two-factor authentication enabled");
      onClose();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} label="Set up two-factor authentication" className="" >
      <h2 style={{ paddingRight: 36 }}>Set Up Two-Factor Authentication</h2>
      <p className="m-sub">Scan the QR code with an authenticator app<br />(Google Authenticator, Authy, etc.)</p>
      <div className="twofa">
        <div className="qr">{qr && <img src={qr} alt="QR code for your authenticator app" />}</div>
        <div>
          <span className="lbl" style={{ marginTop: 0 }}>Or enter this code manually:</span>
          <div className="copyfield">
            <span>{formatSecret(secret)}</span>
            <button aria-label="Copy code" onClick={async () => toast((await copyText(secret)) ? "Code copied" : "Copy failed")}><Copy /></button>
          </div>
          <label className="lbl" htmlFor="totp-code" style={{ marginTop: 18 }}>Enter 6-digit code</label>
          <input id="totp-code" className="plain-input code" inputMode="numeric" maxLength={6} placeholder="000000" value={code} autoComplete="one-time-code"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && enable()} />
        </div>
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
      <div className="m-actions" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-grey" style={{ flex: "0 0 130px" }} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: "0 0 150px" }} disabled={busy || code.length !== 6} onClick={enable}>{busy ? "Checking…" : "Enable 2FA"}</button>
      </div>
    </Modal>
  );
}

// ================================================================ passwords
export function ConfirmPasswordModal({ title, message, confirmLabel = "Confirm", danger, onConfirm, onClose }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr("");
    try { await onConfirm(pw); } catch (e) { setErr(e.code === "INVALID" ? "That password is incorrect." : friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={title}>
      <h2 style={{ paddingRight: 36 }}>{title}</h2>
      {message && <p className="m-sub">{message}</p>}
      <div style={{ marginTop: 18 }}><PasswordField value={pw} onChange={setPw} placeholder="Master password" autoComplete="current-password" autoFocus onEnter={() => pw && go()} error={!!err} /></div>
      {err && <div className="form-error" role="alert">{err}</div>}
      <div className="m-actions">
        <button className="btn btn-grey" onClick={onClose}>Cancel</button>
        <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} disabled={busy || !pw} onClick={go}>{busy ? "Checking…" : confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function ChangePasswordModal({ onClose }) {
  const { account, logActivity, toast } = useApp();
  const [oldPw, setOld] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const checks = passwordChecks(pw);
  const valid = oldPw && passwordOk(pw) && pw === pw2;

  const go = async () => {
    setBusy(true); setErr("");
    try {
      await ks.changePassword(account.email, oldPw, pw);
      await logActivity("password", "Master password changed");
      toast("Master password changed");
      onClose();
    } catch (e) { setErr(e.code === "INVALID" ? "Your current password is incorrect." : friendlyError(e)); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} label="Change master password">
      <h2 style={{ paddingRight: 36 }}>Change Master Password</h2>
      <p className="m-sub">Your files are not re-encrypted. Only the password protecting your vault key changes.</p>
      <div className="stack-sm" style={{ marginTop: 16 }}>
        <PasswordField value={oldPw} onChange={setOld} placeholder="Current password" autoComplete="current-password" autoFocus />
        <div style={{ height: 8 }} />
        <PasswordField value={pw} onChange={setPw} placeholder="New master password" autoComplete="new-password" />
        <div style={{ height: 8 }} />
        <PasswordField value={pw2} onChange={setPw2} placeholder="Repeat new password" autoComplete="new-password" onEnter={() => valid && go()} error={!!pw2 && pw !== pw2} />
      </div>
      <div className="checklist" style={{ marginTop: 14, gap: 8 }}>
        {checks.map((c) => (
          <div key={c.label} className={c.ok ? "" : "off"}><Check />{c.label}</div>
        ))}
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
      <div className="m-actions">
        <button className="btn btn-grey" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid || busy} onClick={go}>{busy ? "Updating…" : "Change Password"}</button>
      </div>
    </Modal>
  );
}

// ============================================================== recovery key
export function RecoveryKeyModal({ onClose }) {
  const { session, account, logActivity, toast } = useApp();
  const [pw, setPw] = useState("");
  const [key, setKey] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const unlockView = async () => {
    setBusy(true); setErr("");
    try {
      await ks.confirmPassword(account.email, pw);
      setKey(await ks.revealRecoveryKey(session));
    } catch (e) { setErr(e.code === "INVALID" ? "That password is incorrect." : friendlyError(e)); } finally { setBusy(false); }
  };
  const regenerate = async () => {
    setBusy(true); setErr("");
    try {
      const k = await ks.regenerateRecoveryKey(session, pw);
      setKey(k);
      await logActivity("recovery", "Recovery key regenerated");
      toast("New recovery key created. The old one no longer works.");
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  if (!key) {
    return (
      <Modal onClose={onClose} label="Recovery key">
        <h2 style={{ paddingRight: 36 }}>Recovery Key</h2>
        <p className="m-sub">Enter your master password to view, download or regenerate your recovery key.</p>
        <div style={{ marginTop: 18 }}><PasswordField value={pw} onChange={setPw} placeholder="Master password" autoComplete="current-password" autoFocus onEnter={() => pw && unlockView()} error={!!err} /></div>
        {err && <div className="form-error" role="alert">{err}</div>}
        <div className="m-actions">
          <button className="btn btn-grey" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !pw} onClick={unlockView}>{busy ? "Checking…" : "Continue"}</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal onClose={onClose} label="Recovery key">
      <h2 style={{ paddingRight: 36 }}>Your Recovery Key</h2>
      <p className="m-sub">Keep it somewhere safe and offline. It is the only way back in if you forget your password.</p>
      <div className="rk-show">{key}</div>
      <div className="btn-row" style={{ justifyContent: "center" }}>
        <button className="btn btn-sm" onClick={() => downloadRecoveryKey(account.email, key)}><Download /> Download</button>
        <button className="btn btn-sm" onClick={() => printRecoveryKey(account.email, key)}><Printer /> Print</button>
        <button className="btn btn-sm" onClick={async () => toast((await copyText(key)) ? "Recovery key copied" : "Copy failed")}><Copy /> Copy</button>
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
      <div className="m-actions">
        <button className="btn btn-grey" disabled={busy} onClick={regenerate}><KeyRound /> Generate new key</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

// ================================================================== folders
export function NewFolderModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const go = () => name.trim() && onCreate(name.trim());
  return (
    <Modal onClose={onClose} label="New folder">
      <h2>New Folder</h2>
      <p className="m-sub">Folders are kept inside your encrypted vault on this device.</p>
      <input className="plain-input" style={{ marginTop: 16 }} placeholder="Folder name" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} aria-label="Folder name" />
      <div className="m-actions">
        <button className="btn btn-grey" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={go}>Create</button>
      </div>
    </Modal>
  );
}

export function MoveModal({ onClose, folders, onMove, count }) {
  const [target, setTarget] = useState("");
  return (
    <Modal onClose={onClose} label="Move to folder">
      <h2>Move {count > 1 ? `${count} items` : "to folder"}</h2>
      <label className="lbl" htmlFor="move-target">Destination</label>
      <select id="move-target" className="select" style={{ width: "100%", marginTop: 6, height: 42 }} value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">All files (no folder)</option>
        {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <div className="m-actions">
        <button className="btn btn-grey" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onMove(target || null)}>Move</button>
      </div>
    </Modal>
  );
}

export function ConfirmModal({ title, text, confirmLabel = "Confirm", danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try { await onConfirm(); } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={title}>
      <h2 style={{ paddingRight: 36 }}>{title}</h2>
      <p className="m-sub" style={{ lineHeight: 1.55 }}>{text}</p>
      {err && <div className="form-error" role="alert" style={{ textAlign: "left" }}>{err}</div>}
      <div className="m-actions">
        <button className="btn btn-grey" onClick={onClose}>Cancel</button>
        <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} disabled={busy} onClick={go}>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </Modal>
  );
}

