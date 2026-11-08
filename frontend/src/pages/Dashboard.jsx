import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Folder, Vault, Upload } from "lucide-react";
import { useApp, CAPACITY_BYTES } from "../context/AppContext.jsx";
import { Topbar } from "../components/Layout.jsx";
import { WalletBanner, FileRows } from "../components/Shared.jsx";
import { firstName, formatBytes, timeAgo } from "../lib/format.js";

export default function Dashboard() {
  const { account, visibleFiles, activeUploads } = useApp();
  const nav = useNavigate();

  const used = useMemo(() => visibleFiles.filter((f) => f.isOwner).reduce((n, f) => n + f.size, 0), [visibleFiles]);
  const pct = Math.min(100, Math.round((used / CAPACITY_BYTES) * 100));
  const recent = useMemo(() => [...visibleFiles].sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 3), [visibleFiles]);

  return (
    <>
      <Topbar title={<>Welcome back, {firstName(account.name)} <span aria-hidden="true">👋</span></>} sub="Your vault is unlocked and ready." />
      <WalletBanner showSharing />

      <section className="stats" aria-label="Vault summary">
        <div className="panel stat"><span className="ic"><Folder /></span><div><b>{visibleFiles.length}</b><span>Files</span></div></div>
        <div className="panel stat"><span className="ic"><Vault /></span><div><b>{formatBytes(used)}</b><span>Storage Used</span></div></div>
        <div className="panel stat"><span className="ic"><Upload /></span><div><b>{activeUploads}</b><span>Active Uploads</span></div></div>
      </section>

      <section className="two-col">
        <div className="panel usage">
          <h3>Storage Usage</h3>
          <div className="meta">
            <span>{formatBytes(used)} of {formatBytes(CAPACITY_BYTES)}</span>
            <b>{pct}%</b>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct === 0 && used > 0 ? 1 : pct}%` }} /></div>
        </div>
        <div className="panel recent">
          <h3>Recent Files</h3>
          <FileRows
            files={recent}
            onOpen={(f) => nav(`/files?open=${f.id}`)}
            empty="No files yet. Upload your first file to see it here."
            meta={(f) => `${formatBytes(f.size)} • ${timeAgo(f.uploadedAt)}`}
          />
        </div>
      </section>
    </>
  );
}
