import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, Wallet, AlertTriangle, Share2, Server } from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import { FileTile } from "./ui.jsx";
import { PreviewModal, ShareModal, ConfirmModal } from "./Modals.jsx";
import * as chain from "../lib/chain.js";
import { storageInfo } from "../lib/ipfs.js";
import { fileKind, formatBytes, formatDate, friendlyError } from "../lib/format.js";

// -------------------------------------------------------------- setup banner
/** Tells the user what is missing before files can be uploaded or opened. */
export function WalletBanner({ showSharing = false }) {
  const { wallet, connectWallet, switchNetwork, sharing, enableSharing, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); } catch (e) { toast(friendlyError(e), "bad"); } finally { setBusy(false); }
  };
  const info = storageInfo();
  const target = chain.targetChain();
  const banners = [];

  if (info.misconfigured) {
    banners.push(
      <div className="banner warn" key="storage">
        <Server />
        <div className="grow"><b>Pinata key missing</b><span className="t">VITE_STORAGE_MODE is “pinata” but VITE_PINATA_JWT is empty, so the local simulation is used instead. See the run guide.</span></div>
      </div>,
    );
  }
  if (!chain.hasWallet()) {
    banners.push(
      <div className="banner warn" key="nowallet">
        <Wallet />
        <div className="grow"><b>MetaMask not detected</b><span className="t">Install the MetaMask browser extension to upload, open and share files.</span></div>
        <a className="btn btn-sm btn-primary" href="https://metamask.io/download/" target="_blank" rel="noreferrer">Get MetaMask</a>
      </div>,
    );
  } else if (wallet.status !== "connected") {
    banners.push(
      <div className="banner" key="connect">
        <Wallet />
        <div className="grow"><b>Connect your wallet</b><span className="t">Your wallet signs transactions and lets the app load your files from the blockchain.</span></div>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(connectWallet)}>{busy ? "Connecting…" : "Connect Wallet"}</button>
      </div>,
    );
  } else if (wallet.chainId !== chain.TARGET_CHAIN_ID) {
    banners.push(
      <div className="banner warn" key="chain">
        <AlertTriangle />
        <div className="grow"><b>Wrong network</b><span className="t">Your wallet is on {chain.chainName(wallet.chainId)}. This app uses {target.name}.</span></div>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(switchNetwork)}>Switch to {target.name}</button>
      </div>,
    );
  } else if (!chain.contractAddress(wallet.chainId)) {
    banners.push(
      <div className="banner warn" key="nocontract">
        <AlertTriangle />
        <div className="grow"><b>Smart contract not deployed on {target.name}</b><span className="t">Run <code>npm run deploy:{wallet.chainId === 11155111 ? "sepolia" : "local"}</code> in the project folder, then reload this page.</span></div>
      </div>,
    );
  } else if (showSharing && sharing === "missing") {
    banners.push(
      <div className="banner" key="sharing">
        <Share2 />
        <div className="grow"><b>Enable sharing</b><span className="t">Publish your public sharing key on-chain (one small transaction) so other wallets can share files with you.</span></div>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(enableSharing, "Sharing enabled")}>{busy ? "Waiting…" : "Enable sharing"}</button>
      </div>,
    );
  }
  return <>{banners}</>;
}

// ----------------------------------------------------------------- file rows
export function FileRows({ files, onOpen, empty = "Nothing here yet.", dot = " • ", meta }) {
  if (!files.length) return <div className="empty-list">{empty}</div>;
  return (
    <div className="list">
      {files.map((f) => (
        <div className="row" key={f.id} onClick={() => onOpen(f)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(f)}>
          <FileTile kind={fileKind(f.name, f.mime)} />
          <div className="info">
            <b title={f.name}>{f.name}</b>
            <small>{meta ? meta(f) : `${formatBytes(f.size)}${dot}${formatDate(f.uploadedAt)}`}</small>
          </div>
          <ChevronRight className="chev" />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------- preview / share / delete
/** Provides the file dialogs for any page. Render {modals} once. */
export function useFileActions() {
  const { files, filesStatus, moveToTrash, toast } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [preview, setPreview] = useState(null);
  const [share, setShare] = useState(null);

  // deep link: /files?open=<id>
  useEffect(() => {
    const id = Number(params.get("open"));
    if (!id || !filesStatus.loaded) return;
    const f = files.find((x) => x.id === id);
    if (f) setPreview(f);
    const next = new URLSearchParams(params);
    next.delete("open");
    setParams(next, { replace: true });
  }, [params, files, filesStatus.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const trash = async (list) => {
    const arr = Array.isArray(list) ? list : [list];
    await moveToTrash(arr.map((f) => f.id));
    toast(arr.length > 1 ? `${arr.length} items moved to trash` : "Moved to trash");
  };

  const modals = (
    <>
      {preview && (
        <PreviewModal
          file={preview}
          onClose={() => setPreview(null)}
          onShare={(f) => { setPreview(null); setShare(f); }}
          onTrash={async (f) => { setPreview(null); await trash(f); }}
        />
      )}
      {share && <ShareModal file={share} onClose={() => setShare(null)} />}
    </>
  );
  return { openPreview: setPreview, openShare: setShare, trash, modals, nav };
}

export { ConfirmModal };
