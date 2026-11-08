import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ShieldCheck, KeyRound, Timer, ChevronRight, DatabaseBackup, LogOut, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { Topbar } from "../components/Layout.jsx";
import { ChangePasswordModal, ConfirmPasswordModal, RecoveryKeyModal, TwoFactorModal } from "../components/Modals.jsx";
import * as ks from "../lib/keystore.js";
import * as chain from "../lib/chain.js";
import { storageInfo } from "../lib/ipfs.js";
import { shortAddr, formatBytes } from "../lib/format.js";
import { CAPACITY_BYTES, MAX_FILE_BYTES } from "../context/AppContext.jsx";

// ==================================================================== security
export function Security() {
  const { session, account, setAutoLock, touchSession, logActivity, toast } = useApp();
  const [modal, setModal] = useState(null); // password | 2fa | disable2fa | recovery

  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([ks.exportKeystore(account.email)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `efv-vault-backup-${account.email}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast("Encrypted vault backup downloaded");
  };

  return (
    <>
      <Topbar title="Security" sub="Manage your vault’s security and access." />
      <div className="panel narrow">
        <button className="srow" onClick={() => setModal("password")}>
          <span className="sic"><Lock /></span>
          <span className="info"><b>Change Master Password</b><small>Update your vault password</small></span>
          <ChevronRight className="chev" />
        </button>
        <button className="srow" onClick={() => setModal(session.twofaEnabled ? "disable2fa" : "2fa")}>
          <span className="sic"><ShieldCheck /></span>
          <span className="info"><b>Two-Factor Authentication (2FA)</b><small>Add an extra layer of security</small></span>
          <span className={session.twofaEnabled ? "pill-ok" : "pill-off"}>{session.twofaEnabled ? "Enabled" : "Off"}</span>
          <ChevronRight className="chev" />
        </button>
        <button className="srow" onClick={() => setModal("recovery")}>
          <span className="sic"><KeyRound /></span>
          <span className="info"><b>Recovery Key</b><small>View, download or regenerate your recovery key</small></span>
          <ChevronRight className="chev" />
        </button>
        <div className="srow" style={{ cursor: "default" }}>
          <span className="sic"><Timer /></span>
          <span className="info"><b>Auto-Lock</b><small>Lock the vault after inactivity</small></span>
          <select className="select light" aria-label="Auto-lock after" value={session.settings.autoLockMinutes} onChange={(e) => setAutoLock(Number(e.target.value))}>
            {[1, 5, 15, 30].map((m) => <option key={m} value={m}>{m} {m === 1 ? "minute" : "minutes"}</option>)}
          </select>
        </div>
        <button className="srow" onClick={exportBackup}>
          <span className="sic"><DatabaseBackup /></span>
          <span className="info"><b>Vault Backup</b><small>Download your encrypted keystore to use this vault on another device</small></span>
          <ChevronRight className="chev" />
        </button>
      </div>
      <p className="form-note" style={{ textAlign: "left", marginTop: 14, maxWidth: 780 }}>
        Two-factor authentication here protects unlocking on this device. Your files themselves are protected by AES-256 encryption and your vault key.
      </p>

      {modal === "password" && <ChangePasswordModal onClose={() => setModal(null)} />}
      {modal === "2fa" && <TwoFactorModal onClose={() => setModal(null)} />}
      {modal === "recovery" && <RecoveryKeyModal onClose={() => setModal(null)} />}
      {modal === "disable2fa" && (
        <ConfirmPasswordModal
          title="Turn off two-factor authentication?" confirmLabel="Turn off" danger
          message="Enter your master password to confirm."
          onClose={() => setModal(null)}
          onConfirm={async (pw) => {
            await ks.confirmPassword(account.email, pw);
            await ks.setTwoFa(session, null);
            touchSession();
            await logActivity("2fa_off", "Authenticator app removed");
            toast("Two-factor authentication turned off");
            setModal(null);
          }}
        />
      )}
    </>
  );
}

// ==================================================================== settings
export function SettingsPage() {
  const { session, account, wallet, logout, toast } = useApp();
  const nav = useNavigate();
  const [del, setDel] = useState(false);
  const store = storageInfo();
  const target = chain.targetChain();
  const addr = chain.contractAddress(wallet.chainId || chain.TARGET_CHAIN_ID);

  return (
    <>
      <Topbar title="Settings" sub="Your profile, network and storage." />
      <div className="panel sec-card narrow" style={{ marginTop: 0 }}>
        <h3>Profile</h3>
        <dl className="kv"><dt>Name</dt><dd>{account.name}</dd><dt>Email</dt><dd>{account.email}</dd></dl>
      </div>
      <div className="panel sec-card narrow">
        <h3>Wallet &amp; blockchain</h3>
        <dl className="kv">
          <dt>Wallet</dt><dd>{wallet.status === "connected" ? wallet.address : "Not connected"}</dd>
          <dt>Network used</dt><dd>{target.name} (chain {chain.TARGET_CHAIN_ID})</dd>
          <dt>Wallet network</dt><dd>{wallet.status === "connected" ? chain.chainName(wallet.chainId) : "—"}</dd>
          <dt>Smart contract</dt><dd>{addr || "Not deployed on this network"}</dd>
        </dl>
      </div>
      <div className="panel sec-card narrow">
        <h3>Storage</h3>
        <dl className="kv">
          <dt>Encrypted files go to</dt><dd>{store.label}</dd>
          <dt>Largest file</dt><dd>{formatBytes(MAX_FILE_BYTES)}</dd>
          <dt>Capacity shown</dt><dd>{formatBytes(CAPACITY_BYTES)}</dd>
          <dt>Sharing key</dt><dd style={{ fontWeight: 500 }}>{shortAddr(session.publicKey)}</dd>
        </dl>
        {store.mode === "local" && (
          <p className="muted-ink" style={{ fontSize: 12.5, marginTop: 12 }}>
            Demo mode: encrypted files are kept in this browser instead of on the public IPFS network. Set <code>VITE_STORAGE_MODE=pinata</code> to use real IPFS.
          </p>
        )}
      </div>
      <div className="panel sec-card narrow">
        <h3>Session</h3>
        <div className="btn-row">
          <button className="btn btn-light" onClick={() => { logout(); nav("/login"); }}><LogOut /> Sign out</button>
          <button className="btn btn-danger" onClick={() => setDel(true)}><Trash2 /> Delete vault from this device</button>
        </div>
        <p className="muted-ink" style={{ fontSize: 12.5, marginTop: 12 }}>
          Deleting removes your keystore from this browser. Without a backup or your recovery key, your files can no longer be decrypted.
        </p>
      </div>
      {del && (
        <ConfirmPasswordModal
          title="Delete this vault from the device?" confirmLabel="Delete vault" danger
          message="Your encrypted files stay on IPFS and the blockchain, but they will be unreadable without your keystore backup. Enter your master password to confirm."
          onClose={() => setDel(false)}
          onConfirm={async (pw) => {
            await ks.confirmPassword(account.email, pw);
            ks.deleteAccount(account.email);
            ks.forgetEmail();
            logout();
            toast("Vault removed from this device");
            nav("/");
          }}
        />
      )}
    </>
  );
}
