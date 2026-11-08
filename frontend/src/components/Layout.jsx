import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Home, Folder, Upload, History, Trash2, Activity, ShieldCheck, Settings, Bell, Lock, LogOut, Wallet, ExternalLink,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { BgArt, Logo, PasswordField } from "./ui.jsx";
import { UploadResultModal } from "./Modals.jsx";
import * as chain from "../lib/chain.js";
import { initials, shortAddr, friendlyError } from "../lib/format.js";

const NAV = [
  { to: "/dashboard", label: "Dashboard", Icon: Home },
  { to: "/files", label: "Files", Icon: Folder },
  { to: "/upload", label: "Upload", Icon: Upload },
  { to: "/recent", label: "Recent", Icon: History },
  { to: "/trash", label: "Trash", Icon: Trash2 },
  { to: "/activity", label: "Activity", Icon: Activity },
  { to: "/security", label: "Security", Icon: ShieldCheck },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="logo" style={{ paddingBottom: 22 }}>
        <Lock strokeWidth={2.4} size={21} />
        <span>EFV</span>
      </div>
      <nav style={{ display: "grid", gap: 6 }} aria-label="Main">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} title={label}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">Files are encrypted on this device before upload.</div>
    </aside>
  );
}

function WalletChip() {
  const { wallet, connectWallet, switchNetwork, toast } = useApp();
  const [busy, setBusy] = useState(false);

  if (!chain.hasWallet()) {
    return (
      <a className="wallet-chip" href="https://metamask.io/download/" target="_blank" rel="noreferrer" title="MetaMask was not detected in this browser">
        <Wallet /> Install MetaMask <ExternalLink />
      </a>
    );
  }
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(friendlyError(e), "bad"); } finally { setBusy(false); }
  };
  if (wallet.status !== "connected") {
    return (
      <button className="wallet-chip connect" disabled={busy} onClick={() => run(connectWallet)}>
        <Wallet /> {busy ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }
  if (wallet.chainId !== chain.TARGET_CHAIN_ID) {
    return (
      <button className="wallet-chip warn" disabled={busy} onClick={() => run(switchNetwork)} title={`Switch to ${chain.targetChain().name}`}>
        <span className="dot" /> Switch to {chain.targetChain().name}
      </button>
    );
  }
  return (
    <span className="wallet-chip" title={`${wallet.address} on ${chain.chainName(wallet.chainId)}`}>
      <span className="dot" /> {shortAddr(wallet.address)}
    </span>
  );
}

export function Topbar({ title, sub, toolbar }) {
  const { account, vaultState, lockVault, logout } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const seenKey = `efv:seen:${account?.email}`;
  const latest = vaultState?.activity?.[0]?.at || 0;
  const unseen = latest > Number(localStorage.getItem(seenKey) || 0);

  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div style={{ display: "grid", gap: 12, justifyItems: "end" }}>
        <div className="top-actions" ref={box}>
          <WalletChip />
          <button className="bell" onClick={() => nav("/activity")} aria-label="Activity">
            <Bell />
            {unseen && <i />}
          </button>
          <button className="avatar" onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}>
            {initials(account?.name)}
          </button>
          {open && (
            <div className="menu" role="menu">
              <div className="who">
                <b>{account?.name}</b>
                <span>{account?.email}</span>
              </div>
              <button onClick={() => { setOpen(false); lockVault(); }}><Lock /> Lock vault</button>
              <button onClick={() => { setOpen(false); nav("/settings"); }}><Settings /> Settings</button>
              <button onClick={() => { setOpen(false); logout(); nav("/login"); }}><LogOut /> Sign out</button>
            </div>
          )}
        </div>
        {toolbar}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- lock screen
export function LockScreen() {
  const { account, unlockVault, logout } = useApp();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw || busy) return;
    setBusy(true); setErr("");
    try { await unlockVault(pw); setPw(""); } catch (e) { setErr(e.code === "INVALID" ? "That password is incorrect." : friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="page-bg">
      <BgArt />
      <div className="page-content center-screen">
        <div className="lock-ic"><Lock strokeWidth={2.2} /></div>
        <h1 className="auth-title" style={{ fontSize: 26 }}>Your Vault is Locked</h1>
        <p className="auth-sub">Enter your master password to unlock and access your files.</p>
        <div className="auth-card" style={{ width: 430 }}>
          <PasswordField value={pw} onChange={setPw} placeholder="Master password" autoComplete="current-password" autoFocus onEnter={submit} error={!!err} />
          <button className="btn btn-primary btn-pill" onClick={submit} disabled={busy || !pw}>
            <Lock /> {busy ? "Unlocking…" : "Unlock Vault"}
          </button>
          {err && <div className="form-error" role="alert" style={{ marginTop: 0 }}>{err}</div>}
          <div className="form-note">
            Signed in as {account?.email} · <button className="link" onClick={() => { logout(); nav("/login"); }}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- auto lock
function useAutoLock(minutes, onLock) {
  useEffect(() => {
    if (!minutes) return undefined;
    let timer;
    let hiddenTimer;
    const reset = () => { clearTimeout(timer); timer = setTimeout(onLock, minutes * 60_000); };
    const onVis = () => {
      clearTimeout(hiddenTimer);
      if (document.hidden) hiddenTimer = setTimeout(onLock, Math.min(minutes, 2) * 60_000);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    reset();
    return () => {
      clearTimeout(timer); clearTimeout(hiddenTimer);
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [minutes, onLock]);
}

// ------------------------------------------------------------------- shell
export function AppShell() {
  const { account, session, locked, lockVault, walletReady, refreshFiles } = useApp();
  const onLock = useCallback(() => lockVault(), [lockVault]);
  useAutoLock(session ? session.settings.autoLockMinutes : 0, onLock);

  // keep the list fresh: when moving between pages and when the tab regains focus
  const { pathname } = useLocation();
  useEffect(() => {
    if (session && walletReady) refreshFiles();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session || !walletReady) return undefined;
    const onFocus = () => refreshFiles();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [session, walletReady, refreshFiles]);

  if (!account) return <Navigate to="/login" replace />;
  if (locked || !session) return <LockScreen />;
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <UploadResultModal />
    </div>
  );
}

