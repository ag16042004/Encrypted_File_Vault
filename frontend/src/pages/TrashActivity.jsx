import React, { useEffect, useMemo, useState } from "react";
import {
  Upload as UploadIcon, Lock, ShieldCheck, Trash2, UserPlus, UserX, Share2, KeyRound, Download, PlusCircle, ShieldOff, RotateCcw,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { Topbar } from "../components/Layout.jsx";
import { WalletBanner } from "../components/Shared.jsx";
import { ConfirmModal } from "../components/Modals.jsx";
import { FileTile } from "../components/ui.jsx";
import * as chain from "../lib/chain.js";
import { fileKind, formatBytes, formatDate, shortAddr, friendlyError } from "../lib/format.js";

// ======================================================================= trash
export function Trash() {
  const { trashedFiles, vaultState, restoreFiles, deleteForever, toast, filesStatus } = useApp();
  const [confirm, setConfirm] = useState(null);
  const sorted = useMemo(
    () => [...trashedFiles].sort((a, b) => (vaultState.trashed[b.id] || 0) - (vaultState.trashed[a.id] || 0)),
    [trashedFiles, vaultState],
  );

  return (
    <>
      <Topbar title="Trash" sub="Deleted files stay here until you remove them permanently." />
      <WalletBanner />
      <div className="panel narrow" style={{ padding: "6px 18px" }}>
        {sorted.length === 0 && <div className="empty-list">{filesStatus.loading ? "Loading…" : "Trash is empty."}</div>}
        <div className="list">
          {sorted.map((f) => (
            <div className="row" key={f.id} style={{ cursor: "default" }}>
              <FileTile kind={fileKind(f.name, f.mime)} />
              <div className="info">
                <b title={f.name}>{f.name}</b>
                <small>{formatBytes(f.size)} • Deleted {formatDate(vaultState.trashed[f.id])}</small>
              </div>
              <button className="btn btn-sm btn-light" onClick={async () => { await restoreFiles([f.id]); toast("File restored"); }}><RotateCcw /> Restore</button>
              <button className="btn btn-sm btn-danger" onClick={() => setConfirm(f)}><Trash2 /> Delete forever</button>
            </div>
          ))}
        </div>
      </div>
      {confirm && (
        <ConfirmModal
          title="Delete permanently?" danger confirmLabel="Delete forever"
          text={confirm.isOwner
            ? `“${confirm.name}” will be removed from the blockchain record and access for everyone you shared it with ends. The encrypted data may stay on IPFS but can never be decrypted. This needs a wallet transaction and cannot be undone.`
            : `“${confirm.name}” will be removed from your list. The owner keeps their copy.`}
          onClose={() => setConfirm(null)}
          onConfirm={async () => { await deleteForever(confirm); setConfirm(null); toast("File deleted"); }}
        />
      )}
    </>
  );
}

// ===================================================================== activity
const LOCAL = {
  unlock: { title: "Vault unlocked", Icon: Lock, tone: "white", cat: "security" },
  created: { title: "Vault created", Icon: PlusCircle, tone: "green", cat: "security" },
  "2fa": { title: "2FA enabled", Icon: ShieldCheck, tone: "green", cat: "security" },
  "2fa_off": { title: "2FA disabled", Icon: ShieldOff, tone: "red", cat: "security" },
  password: { title: "Master password changed", Icon: KeyRound, tone: "white", cat: "security" },
  recovery: { title: "Recovery key regenerated", Icon: KeyRound, tone: "white", cat: "security" },
  download: { title: "File downloaded", Icon: Download, tone: "purple", cat: "files" },
};

const FILTERS = [
  ["all", "All Activity"], ["files", "Files"], ["sharing", "Sharing"], ["security", "Security"],
];

export function ActivityPage() {
  const { account, vaultState, files, getReadVault, wallet, toast } = useApp();
  const [filter, setFilter] = useState("all");
  const [chainEvents, setChainEvents] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { localStorage.setItem(`efv:seen:${account.email}`, String(Date.now())); }, [account.email]);

  useEffect(() => {
    let alive = true;
    const ctx = getReadVault();
    if (!ctx) { setChainEvents(null); return undefined; }
    setLoading(true);
    chain.fetchChainEvents(ctx.vault, ctx.provider, ctx.address, ctx.chainId)
      .then((ev) => alive && setChainEvents(ev))
      .catch((e) => { if (alive) toast(friendlyError(e), "bad"); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [wallet.status, wallet.address, wallet.chainId, files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id) => {
    const f = files.find((x) => x.id === id && !x.unreadable);
    if (f) return { name: f.name, size: f.size };
    return vaultState.names?.[id] || { name: `File #${id}`, size: null };
  };

  const items = useMemo(() => {
    const out = [];
    for (const a of vaultState.activity || []) {
      const def = LOCAL[a.type] || { title: a.type, Icon: ShieldCheck, tone: "white", cat: "security" };
      out.push({ key: a.id, at: a.at, ...def, detail: a.detail });
    }
    for (const e of chainEvents || []) {
      const n = e.id ? nameOf(e.id) : null;
      const label = n ? `${n.name}${n.size != null ? ` (${formatBytes(n.size)})` : ""}` : "";
      let it;
      if (e.name === "FileUploaded") it = { title: "File uploaded", Icon: UploadIcon, tone: "green", cat: "files", detail: label };
      else if (e.name === "FileDeleted") it = { title: "File deleted", Icon: Trash2, tone: "red", cat: "files", detail: n?.name || label };
      else if (e.name === "AccessGranted") it = e.asRecipient
        ? { title: "File shared with you", Icon: UserPlus, tone: "purple", cat: "sharing", detail: `${n?.name || label} from ${shortAddr(e.owner)}` }
        : { title: "File shared", Icon: UserPlus, tone: "purple", cat: "sharing", detail: `${n?.name || label} with ${shortAddr(e.user)}` };
      else if (e.name === "AccessRevoked") it = e.asRecipient
        ? { title: "Access removed", Icon: UserX, tone: "red", cat: "sharing", detail: `${n?.name || label} by ${shortAddr(e.owner)}` }
        : { title: "Access revoked", Icon: UserX, tone: "red", cat: "sharing", detail: `${n?.name || label} from ${shortAddr(e.user)}` };
      else if (e.name === "PublicKeyRegistered") it = { title: "Sharing enabled", Icon: Share2, tone: "purple", cat: "sharing", detail: "Public sharing key registered on-chain" };
      else continue;
      out.push({ key: `${e.txHash}:${e.name}:${e.id}:${e.user}`, at: e.at, ...it, tx: e.txHash });
    }
    return out.filter((i) => filter === "all" || i.cat === filter).sort((a, b) => b.at - a.at);
  }, [vaultState, chainEvents, files, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Topbar
        title="Activity Log" sub="A record of important actions in your vault."
        toolbar={(
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter activity">
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      />
      {!chainEvents && <WalletBanner />}
      <div className="panel narrow">
        {items.length === 0 && <div className="empty-list">{loading ? "Loading activity…" : "No activity yet."}</div>}
        {items.map((it) => {
          const url = it.tx ? chain.txUrl(it.tx) : null;
          return (
            <div className="act" key={it.key}>
              <span className={`aic ${it.tone}`}><it.Icon /></span>
              <div className="info">
                <b>{it.title}</b>
                {it.detail && <small>{it.detail}</small>}
                {it.tx && (
                  <small style={{ display: "block", marginTop: 1 }}>
                    On-chain · {url ? <a href={url} target="_blank" rel="noreferrer">tx {it.tx.slice(0, 10)}…</a> : <span title={it.tx}>tx {it.tx.slice(0, 10)}…</span>}
                  </small>
                )}
              </div>
              <time dateTime={new Date(it.at).toISOString()}>{formatDate(it.at)}</time>
            </div>
          );
        })}
      </div>
    </>
  );
}
