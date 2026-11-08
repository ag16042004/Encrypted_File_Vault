import React, { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { User, Mail, KeyRound, Copy, Download, Printer, Check, Lock, CheckCircle2, Upload } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { BgArt, CheckRow, Logo, PasswordField, Stepper, TextField } from "../components/ui.jsx";
import { copyText, downloadRecoveryKey, printRecoveryKey } from "../components/recoveryTools.js";
import * as ks from "../lib/keystore.js";
import { isEmail, passwordChecks, passwordOk, friendlyError } from "../lib/format.js";
import { isValidRecoveryKey } from "../lib/crypto.js";

function AuthFrame({ children, centered }) {
  return (
    <div className="page-bg">
      <BgArt />
      <div className="page-content">
        <div className="auth-top"><Link to="/" aria-label="Home"><Logo /></Link></div>
        <div className="auth-wrap" style={centered ? { paddingTop: 60 } : undefined}>{children}</div>
      </div>
    </div>
  );
}

// ============================================================== 02 register
export function Register() {
  const { register } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const checks = passwordChecks(pw);
  const valid = name.trim().length > 1 && isEmail(email) && passwordOk(pw);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      await register({ name, email, password: pw });
      nav("/register/recovery", { replace: true });
    } catch (e) {
      setErr(e.code === "EXISTS" ? "A vault with this email already exists on this device. Try logging in." : friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <Stepper step={1} />
      <h1 className="auth-title">Create Your Vault</h1>
      <p className="auth-sub">Set up your encrypted space in under 3 minutes.</p>
      <div className="reg-grid">
        <div className="stack">
          <TextField icon={User} label="Full Name" value={name} onChange={setName} autoComplete="name" autoFocus onEnter={submit} />
          <TextField icon={Mail} label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" onEnter={submit} />
          <PasswordField label="Master Password" value={pw} onChange={setPw} autoComplete="new-password" onEnter={submit} />
        </div>
        <div className="checklist" aria-live="polite">
          {checks.map((c) => (
            <div key={c.label} className={c.ok ? "" : "off"}><Check />{c.label}</div>
          ))}
        </div>
      </div>
      <div className="auth-actions">
        <button className="btn btn-primary btn-pill" onClick={submit} disabled={!valid || busy}>{busy ? "Creating your vault…" : "Create Vault"}</button>
        {err && <div className="form-error" role="alert" style={{ marginTop: 0 }}>{err}</div>}
        <div className="form-note" style={{ color: "#e2e5f2" }}>Already have an account? <Link to="/login" className="link" style={{ color: "#fff" }}>Login</Link></div>
      </div>
    </AuthFrame>
  );
}

// ========================================================== 03 recovery key
export function RecoveryKeyPage() {
  const { pendingRecoveryKey, account, toast } = useApp();
  const nav = useNavigate();
  const [saved, setSaved] = useState(false);
  if (!pendingRecoveryKey || !account) return <Navigate to="/login" replace />;

  const copy = async () => toast((await copyText(pendingRecoveryKey)) ? "Recovery key copied" : "Could not copy", "ok");

  return (
    <AuthFrame>
      <Stepper step={2} />
      <h1 className="auth-title" style={{ fontSize: 28 }}>Save Your Recovery Key</h1>
      <p className="auth-sub">This key can help you regain access if you forget your password. We cannot reset your password.</p>
      <div className="key-box">
        <KeyRound />
        <code aria-label="Your recovery key">{pendingRecoveryKey}</code>
        <button onClick={copy} aria-label="Copy recovery key"><Copy /></button>
      </div>
      <div className="key-actions key-actions-row" style={{ display: "flex", margin: "22px 0 18px" }}>
        <button className="key-act" onClick={() => downloadRecoveryKey(account.email, pendingRecoveryKey)}>
          <span className="ic"><Download /></span>
          <span>Download<small>(.txt)</small></span>
        </button>
        <button className="key-act" onClick={() => printRecoveryKey(account.email, pendingRecoveryKey)}>
          <span className="ic"><Printer /></span><span>Print Key</span>
        </button>
        <button className="key-act" onClick={copy}>
          <span className="ic"><Copy /></span><span>Copy</span>
        </button>
      </div>
      <div className="auth-actions" style={{ marginTop: 0, width: 440 }}>
        <CheckRow checked={saved} onChange={setSaved}>I have saved my recovery key securely</CheckRow>
        <button className="btn btn-primary btn-pill" disabled={!saved} onClick={() => nav("/register/done")}>Continue</button>
      </div>
    </AuthFrame>
  );
}

export function DonePage() {
  const { account, pendingRecoveryKey, setPendingRecoveryKey } = useApp();
  const nav = useNavigate();
  if (!account) return <Navigate to="/login" replace />;
  return (
    <AuthFrame>
      <Stepper step={3} />
      <div className="done-ic"><CheckCircle2 strokeWidth={2} /></div>
      <h1 className="auth-title" style={{ fontSize: 28 }}>Your Vault is Ready</h1>
      <p className="auth-sub">Everything you upload is now encrypted on your device before it leaves it.</p>
      <div className="auth-actions">
        <button className="btn btn-primary btn-pill" onClick={() => { setPendingRecoveryKey(null); nav("/dashboard", { replace: true }); }}>Open Dashboard</button>
      </div>
    </AuthFrame>
  );
}

// ================================================================= 04 login
export function Login() {
  const { account, session, login, submit2fa, cancelPending, toast } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState(ks.lastEmail());
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [stage, setStage] = useState("password"); // password | 2fa
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  if (account && session) return <Navigate to="/dashboard" replace />;
  const dest = loc.state?.from || "/dashboard";

  const submit = async () => {
    if (busy || !email || !pw) return;
    setBusy(true); setErr("");
    try {
      const r = await login(email, pw, remember);
      if (r.needs2fa) { setStage("2fa"); setBusy(false); return; }
      nav(dest, { replace: true });
    } catch (e) {
      setErr(e.code === "INVALID" ? "Email or password is incorrect." : friendlyError(e));
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true); setErr("");
    try {
      if (await submit2fa(code)) { nav(dest, { replace: true }); return; }
      setErr("That code is not correct. Try the current code from your authenticator app.");
    } catch (e) { setErr(friendlyError(e)); }
    setBusy(false);
  };

  const importBackup = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const imported = ks.importKeystore(await f.text());
      setEmail(imported);
      toast("Vault backup imported. Log in with your master password.");
    } catch (er) { setErr(er.message); }
  };

  return (
    <AuthFrame centered>
      <h1 className="auth-title">Welcome Back</h1>
      <p className="auth-sub">Unlock your vault to access your files.</p>
      {stage === "password" ? (
        <div className="auth-card">
          <TextField icon={Mail} placeholder="Email" value={email} onChange={setEmail} type="email" autoComplete="username" onEnter={submit} />
          <PasswordField placeholder="Master password" value={pw} onChange={setPw} autoComplete="current-password" onEnter={submit} autoFocus={!!email} error={!!err} />
          <div className="row-between">
            <CheckRow checked={remember} onChange={setRemember}>Remember me</CheckRow>
            <Link to="/forgot" className="link">Forgot password?</Link>
          </div>
          <button className="btn btn-primary btn-pill" onClick={submit} disabled={busy || !email || !pw}><Lock /> {busy ? "Unlocking…" : "Unlock Vault"}</button>
          {err && <div className="form-error" role="alert" style={{ marginTop: 0 }}>{err}</div>}
          <div className="form-note">
            New here? <Link to="/register" className="link">Create a vault</Link>
            <br />
            <button className="link" style={{ marginTop: 6, fontSize: 12, color: "#b9bfd8" }} onClick={() => fileRef.current?.click()}>Have a vault backup from another device? Import it</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importBackup} />
          </div>
        </div>
      ) : (
        <div className="auth-card">
          <p className="form-note" style={{ color: "#e2e5f2" }}>Two-factor authentication is on. Enter the 6-digit code from your authenticator app.</p>
          <div className="field">
            <Lock />
            <div className="field-body">
              <input inputMode="numeric" maxLength={6} placeholder="000000" value={code} autoFocus aria-label="6-digit code" autoComplete="one-time-code"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && verify()} style={{ letterSpacing: 4, fontWeight: 600 }} />
            </div>
          </div>
          <button className="btn btn-primary btn-pill" disabled={busy || code.length !== 6} onClick={verify}><Lock /> {busy ? "Checking…" : "Verify & Unlock"}</button>
          {err && <div className="form-error" role="alert" style={{ marginTop: 0 }}>{err}</div>}
          <div className="form-note"><button className="link" onClick={() => { cancelPending(); setStage("password"); setCode(""); setErr(""); }}>Back</button></div>
        </div>
      )}
    </AuthFrame>
  );
}

// ================================================================== forgot
export function Forgot() {
  const { resetWithRecovery } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState(ks.lastEmail());
  const [rk, setRk] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const checks = passwordChecks(pw);
  const valid = isEmail(email) && isValidRecoveryKey(rk) && passwordOk(pw);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      if (!ks.accountExists(email)) throw Object.assign(new Error("x"), { code: "NOVAULT" });
      await resetWithRecovery(email, rk, pw);
      nav("/dashboard", { replace: true });
    } catch (e) {
      setErr(e.code === "NOVAULT" ? "No vault with this email was found on this device. Import your vault backup from the login page first." : e.code === "INVALID" ? e.message : friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <AuthFrame centered>
      <h1 className="auth-title">Reset With Recovery Key</h1>
      <p className="auth-sub">Enter the recovery key you saved when you created your vault, then choose a new master password.</p>
      <div className="auth-card">
        <TextField icon={Mail} placeholder="Email" value={email} onChange={setEmail} type="email" autoComplete="username" />
        <TextField icon={KeyRound} placeholder="EFV-XXXX-XXXX-XXXX-XXXX" value={rk} onChange={setRk} autoComplete="off" />
        <PasswordField placeholder="New master password" value={pw} onChange={setPw} autoComplete="new-password" onEnter={submit} />
        <div className="checklist" style={{ gap: 8 }}>
          {checks.map((c) => <div key={c.label} className={c.ok ? "" : "off"}><Check />{c.label}</div>)}
        </div>
        <button className="btn btn-primary btn-pill" disabled={!valid || busy} onClick={submit}><Lock /> {busy ? "Resetting…" : "Reset & Unlock"}</button>
        {err && <div className="form-error" role="alert" style={{ marginTop: 0 }}>{err}</div>}
        <div className="form-note"><Link to="/login" className="link">Back to login</Link></div>
      </div>
    </AuthFrame>
  );
}

