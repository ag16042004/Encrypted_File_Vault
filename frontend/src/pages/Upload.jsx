import React, { useRef, useState } from "react";
import { UploadCloud, X, FileText, Check, RefreshCw } from "lucide-react";
import { useApp, MAX_FILE_BYTES } from "../context/AppContext.jsx";
import { Topbar } from "../components/Layout.jsx";
import { WalletBanner } from "../components/Shared.jsx";
import { ProgressBar } from "../components/ui.jsx";
import { formatBytes } from "../lib/format.js";

const ACTIVE = ["queued", "hashing", "encrypting", "uploading", "confirming", "recording"];

function UploadItem({ u }) {
  const { cancelUpload, dismissUpload, retryUpload } = useApp();
  const active = ACTIVE.includes(u.status);
  const sub = u.status === "error" ? (u.error || "Failed") : `${formatBytes(u.size)} · ${u.label}`;
  return (
    <div className={"panel upitem" + (u.status === "error" ? " err" : "") + (u.status === "done" ? " done" : "")}>
      <span className="ftile">{u.status === "done" ? <Check /> : <FileText />}</span>
      <div style={{ minWidth: 0 }}>
        <div className="nm" title={u.name}>{u.name}</div>
        <div className="sub" title={sub}>{sub}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        {u.status === "error" && u.error && (
          <button className="btn btn-sm btn-light" style={{ marginRight: 8 }} onClick={() => retryUpload(u.id)}><RefreshCw /> Retry</button>
        )}
        {active && <span className="pct">{Math.round(u.progress)}%</span>}
        <button className="x" onClick={() => (active ? cancelUpload(u.id) : dismissUpload(u.id))} aria-label={active ? `Cancel upload of ${u.name}` : `Dismiss ${u.name}`}><X /></button>
      </div>
      {(active || u.status === "error" || u.status === "done") && (
        <div className="bar"><ProgressBar value={u.status === "error" ? Math.max(u.progress, 8) : u.progress} /></div>
      )}
    </div>
  );
}

export default function Upload() {
  const { uploadFiles, uploads } = useApp();
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  return (
    <>
      <Topbar title="Upload Files" sub="Your files will be encrypted on your device before upload." />
      <WalletBanner />
      <div
        className={"dropzone" + (over ? " over" : "")}
        role="button" tabIndex={0} aria-label="Drag and drop files here or click to browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <UploadCloud />
        <b>Drag &amp; drop files here</b>
        <span>or click to browse</span>
        <input ref={inputRef} type="file" multiple hidden data-testid="file-input"
          onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = ""; }} />
      </div>
      <p className="form-note" style={{ textAlign: "left", marginTop: 10 }}>Up to {formatBytes(MAX_FILE_BYTES)} per file. The file name, type and size are encrypted too.</p>
      {uploads.map((u) => <UploadItem key={u.id} u={u} />)}
    </>
  );
}
