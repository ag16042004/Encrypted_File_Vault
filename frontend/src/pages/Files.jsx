import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search as SearchIcon, LayoutGrid, List as ListIcon, FolderPlus, MoreVertical, Upload as UploadIcon, Download, Share2, Trash2,
  FolderInput, Eye, X, Loader2,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { Topbar } from "../components/Layout.jsx";
import { FileRows, WalletBanner, useFileActions } from "../components/Shared.jsx";
import { FileTile, GlassFolder } from "../components/ui.jsx";
import { ConfirmModal, MoveModal, NewFolderModal } from "../components/Modals.jsx";
import { fileKind, formatBytes, formatDate, friendlyError } from "../lib/format.js";

function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="row-menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreVertical /></button>
      {open && (
        <div className="pop" role="menu">
          {items.map((it, i) => it === "-" ? <hr key={i} /> : (
            <button key={it.label} className={it.danger ? "danger" : ""} role="menuitem" onClick={() => { setOpen(false); it.run(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Files() {
  const { visibleFiles, vaultState, createFolder, deleteFolder, moveToFolder, filesStatus, downloadFile, toast, wallet } = useApp();
  const { openPreview, openShare, trash, modals } = useFileActions();
  const nav = useNavigate();
  const [folderId, setFolderId] = useState(null);
  const [view, setView] = useState("list");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [showNew, setShowNew] = useState(false);
  const [moveIds, setMoveIds] = useState(null);
  const [delFolder, setDelFolder] = useState(null);

  const folders = vaultState?.folders || [];
  const assign = vaultState?.assign || {};
  const current = folderId ? folders.find((f) => f.id === folderId) : null;
  useEffect(() => { if (folderId && !current) setFolderId(null); }, [folderId, current]);
  useEffect(() => { setSelected(new Set()); }, [folderId, q]);

  const query = q.trim().toLowerCase();
  const shownFiles = useMemo(() => {
    if (query) return visibleFiles.filter((f) => f.name.toLowerCase().includes(query));
    return visibleFiles.filter((f) => (assign[f.id] || null) === (folderId || null));
  }, [visibleFiles, assign, folderId, query]);
  const shownFolders = query ? folders.filter((f) => f.name.toLowerCase().includes(query)) : folderId ? [] : folders;
  const countIn = (fid) => visibleFiles.filter((f) => assign[f.id] === fid).length;
  const totalSize = visibleFiles.filter((f) => f.isOwner).reduce((n, f) => n + f.size, 0);

  const guard = (fn) => async () => { try { await fn(); } catch (e) { toast(friendlyError(e), "bad"); } };
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = shownFiles.length > 0 && shownFiles.every((f) => selected.has(f.id));
  const selectedFiles = shownFiles.filter((f) => selected.has(f.id));

  const fileMenu = (f) => [
    { label: "Open", icon: <Eye />, run: () => openPreview(f) },
    { label: "Download", icon: <Download />, run: guard(() => downloadFile(f)) },
    ...(f.isOwner ? [{ label: "Share access", icon: <Share2 />, run: () => openShare(f) }] : []),
    { label: "Move to folder", icon: <FolderInput />, run: () => setMoveIds([f.id]) },
    "-",
    { label: "Move to trash", icon: <Trash2 />, danger: true, run: () => trash(f) },
  ];

  const toolbar = (
    <div className="toolbar">
      <label className="search">
        <SearchIcon />
        <input
          placeholder="Search files..." value={q} aria-label="Search files"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && q.trim() && nav(`/search?q=${encodeURIComponent(q.trim())}`)}
        />
      </label>
      <div className="seg" role="group" aria-label="View">
        <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === "grid"}><LayoutGrid /></button>
        <button className={view === "list" ? "on" : ""} onClick={() => setView("list")} aria-label="List view" aria-pressed={view === "list"}><ListIcon /></button>
      </div>
      {!folderId && (
        <div className="seg"><button onClick={() => setShowNew(true)} aria-label="New folder" title="New folder"><FolderPlus /></button></div>
      )}
    </div>
  );

  const empty = !filesStatus.loading && visibleFiles.length === 0 && folders.length === 0;

  return (
    <>
      <Topbar title={current ? current.name : "All Files"} sub={`${visibleFiles.length} items · ${formatBytes(totalSize)}`} toolbar={empty ? null : toolbar} />
      <WalletBanner />
      {filesStatus.error && <div className="banner warn"><div className="grow"><b>Could not load your files</b><span className="t">{filesStatus.error}</span></div></div>}

      {current && (
        <div className="crumbs">
          <button onClick={() => setFolderId(null)}>All Files</button> / <span>{current.name}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setDelFolder(current)} style={{ color: "#ff9db1" }}>Delete folder</button>
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className="sel-bar">
          <b>{selectedFiles.length} selected</b>
          <button className="btn btn-sm" onClick={() => setMoveIds(selectedFiles.map((f) => f.id))}><FolderInput /> Move</button>
          <button className="btn btn-sm" onClick={async () => { await trash(selectedFiles); setSelected(new Set()); }}><Trash2 /> Move to trash</button>
        </div>
      )}

      {filesStatus.loading && !filesStatus.loaded && (
        <div className="empty"><Loader2 className="spin" size={30} /><p>Loading your files from the blockchain…</p></div>
      )}

      {empty && !filesStatus.loading && (
        <div className="empty">
          <div className="big"><GlassFolder lock={false} width={190} /></div>
          <b>No files yet</b>
          <p>Upload your first file to keep it safe and encrypted.</p>
          <button className="btn btn-primary" onClick={() => nav("/upload")}><UploadIcon /> Upload Files</button>
        </div>
      )}

      {!empty && !(filesStatus.loading && !filesStatus.loaded) && view === "list" && (
        <div className="panel ftable">
          <table>
            <thead>
              <tr>
                <th style={{ width: 44 }}><input type="checkbox" className="check on-light" aria-label="Select all" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(shownFiles.map((f) => f.id)) : new Set())} /></th>
                <th>Name</th><th style={{ width: 110 }}>Size</th><th style={{ width: 160 }}>Modified</th><th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {shownFolders.map((fo) => (
                <tr className="frow" key={fo.id} onClick={() => { setQ(""); setFolderId(fo.id); }}>
                  <td />
                  <td className="name"><FileTile folder className="tiny" /><span className="t">{fo.name}</span></td>
                  <td className="sz">—</td>
                  <td className="date">{formatDate(fo.createdAt)}</td>
                  <td><RowMenu items={[{ label: "Open", icon: <Eye />, run: () => { setQ(""); setFolderId(fo.id); } }, "-", { label: "Delete folder", icon: <Trash2 />, danger: true, run: () => setDelFolder(fo) }]} /></td>
                </tr>
              ))}
              {shownFiles.map((f) => (
                <tr className="frow" key={f.id} onClick={() => openPreview(f)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="check on-light" aria-label={`Select ${f.name}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} /></td>
                  <td className="name">
                    <FileTile kind={fileKind(f.name, f.mime)} className="tiny" />
                    <span className="t" title={f.name}>{f.name}</span>
                    {!f.isOwner && <span className="badge-shared">Shared</span>}
                    {f.unreadable && <span className="badge-lock">No key</span>}
                  </td>
                  <td className="sz">{formatBytes(f.size)}</td>
                  <td className="date">{formatDate(f.uploadedAt)}</td>
                  <td><RowMenu items={fileMenu(f)} /></td>
                </tr>
              ))}
              {shownFiles.length === 0 && shownFolders.length === 0 && (
                <tr><td colSpan={5} className="empty-list">{query ? `No files match “${q}”.` : "This folder is empty."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!empty && !(filesStatus.loading && !filesStatus.loaded) && view === "grid" && (
        <div className="grid-files">
          {shownFolders.map((fo) => (
            <div className="panel gfile" key={fo.id} role="button" tabIndex={0} onClick={() => { setQ(""); setFolderId(fo.id); }} onKeyDown={(e) => e.key === "Enter" && setFolderId(fo.id)}>
              <FileTile folder /><b>{fo.name}</b><small>{countIn(fo.id)} items</small>
            </div>
          ))}
          {shownFiles.map((f) => (
            <div className="panel gfile" key={f.id} role="button" tabIndex={0} onClick={() => openPreview(f)} onKeyDown={(e) => e.key === "Enter" && openPreview(f)}>
              <FileTile kind={fileKind(f.name, f.mime)} /><b title={f.name}>{f.name}</b><small>{formatBytes(f.size)} · {formatDate(f.uploadedAt)}</small>
            </div>
          ))}
        </div>
      )}

      {showNew && <NewFolderModal onClose={() => setShowNew(false)} onCreate={async (name) => { await createFolder(name); setShowNew(false); toast("Folder created"); }} />}
      {moveIds && (
        <MoveModal count={moveIds.length} folders={folders} onClose={() => setMoveIds(null)}
          onMove={async (target) => { await moveToFolder(moveIds, target); setMoveIds(null); setSelected(new Set()); toast("Moved"); }} />
      )}
      {delFolder && (
        <ConfirmModal title="Delete folder?" danger confirmLabel="Delete folder"
          text={`“${delFolder.name}” will be removed. Its files are not deleted; they move back to All Files.`}
          onClose={() => setDelFolder(null)}
          onConfirm={async () => { await deleteFolder(delFolder.id); setDelFolder(null); toast("Folder deleted"); }} />
      )}
      {modals}
    </>
  );
}

// ---------------------------------------------------------------------- recent
export function Recent() {
  const { visibleFiles, filesStatus } = useApp();
  const { openPreview, modals } = useFileActions();
  const list = useMemo(() => [...visibleFiles].sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 25), [visibleFiles]);
  return (
    <>
      <Topbar title="Recent" sub="The files you added most recently." />
      <WalletBanner />
      <div className="panel narrow" style={{ padding: "6px 18px" }}>
        <FileRows files={list} onOpen={openPreview} empty={filesStatus.loading ? "Loading…" : "No files yet."} />
      </div>
      {modals}
    </>
  );
}

// ---------------------------------------------------------------------- search
export function SearchPage() {
  const { visibleFiles } = useApp();
  const { openPreview, modals } = useFileActions();
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") || "";
  const [q, setQ] = useState(urlQ);
  useEffect(() => { setQ(urlQ); }, [urlQ]);
  const results = useMemo(() => {
    const t = urlQ.trim().toLowerCase();
    return t ? visibleFiles.filter((f) => f.name.toLowerCase().includes(t)) : [];
  }, [visibleFiles, urlQ]);
  const submit = () => setParams(q.trim() ? { q: q.trim() } : {}, { replace: true });

  return (
    <>
      <Topbar title="Search Results" />
      <div className="search-box">
        <SearchIcon />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Search your files" aria-label="Search files" autoFocus />
        {q && <button onClick={() => { setQ(""); setParams({}, { replace: true }); }} aria-label="Clear search"><X size={16} /></button>}
      </div>
      {urlQ.trim() && <div className="result-count">{results.length} result{results.length === 1 ? "" : "s"} for “{urlQ}”</div>}
      {urlQ.trim() && (
        <div className="panel narrow" style={{ padding: "6px 18px" }}>
          <FileRows files={results} onOpen={openPreview} empty="No matching files." />
        </div>
      )}
      {modals}
    </>
  );
}
