import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, EyeOff, FileLock2, ShieldCheck, KeyRound, Cloud, Link2, Fingerprint } from "lucide-react";
import { BgArt, GlassFolder, Logo } from "../components/ui.jsx";
import { useApp } from "../context/AppContext.jsx";

export default function Landing() {
  const { account } = useApp();
  return (
    <div className="page-bg">
      <BgArt />
      <div className="page-content">
        <nav className="nav" aria-label="Top">
          <Logo />
          <div className="nav-right">
            <div className="nav-links" style={{ marginRight: 14 }}>
              <a href="#features">Features</a>
              <a href="#security">Security</a>
              <a href="#faq">FAQ</a>
            </div>
            {account ? (
              <Link to="/dashboard" className="btn btn-primary">Open Vault</Link>
            ) : (
              <>
                <Link to="/login" className="btn">Login</Link>
                <Link to="/register" className="btn btn-primary">Get Started</Link>
              </>
            )}
          </div>
        </nav>

        <header className="hero">
          <div>
            <h1>Encrypted File Vault</h1>
            <p className="tag">Your files. Your keys. Only you can unlock them.</p>
            <div className="hero-feats">
              <div className="hero-feat"><EyeOff /><span>Zero-Knowledge</span></div>
              <div className="hero-feat"><FileLock2 /><span>End-to-End Encryption</span></div>
              <div className="hero-feat"><ShieldCheck /><span>Private &amp; Secure</span></div>
            </div>
            <div className="hero-cta">
              <Link to={account ? "/dashboard" : "/register"} className="btn btn-primary">Get Started <ArrowRight /></Link>
              <a href="#features" className="btn">Learn More</a>
            </div>
          </div>
          <div className="hero-art"><GlassFolder /></div>
        </header>

        <section className="section" id="features">
          <h2>How your files stay private</h2>
          <p className="lead">Encryption happens on your device. The network only ever sees scrambled data, a fingerprint and a list of who may open it.</p>
          <div className="cards3">
            <div className="gcard"><div className="ico"><KeyRound /></div><h3>Encrypted in your browser</h3><p>Every file is locked with AES-256 before it leaves your computer. Your keys never leave your vault.</p></div>
            <div className="gcard"><div className="ico"><Cloud /></div><h3>Stored on IPFS</h3><p>Only the encrypted copy is stored on the decentralised IPFS network, with no single company holding your files.</p></div>
            <div className="gcard"><div className="ico"><Link2 /></div><h3>Verified on Ethereum</h3><p>A SHA-256 fingerprint and the access rules are recorded on the blockchain, so tampering is detected.</p></div>
          </div>
          <div className="steps">
            <div className="step"><b>Encrypt</b>Your browser creates a fresh key and encrypts the file with AES-256-GCM.</div>
            <div className="step"><b>Fingerprint</b>A SHA-256 hash of the original file is calculated for later checks.</div>
            <div className="step"><b>Store</b>The encrypted file goes to IPFS and returns a content ID (CID).</div>
            <div className="step"><b>Record</b>The hash, CID and permissions are written to the smart contract.</div>
          </div>
        </section>

        <section className="section" id="security">
          <h2>Built so we cannot read your files</h2>
          <p className="lead">There is no server holding your keys. That also means nobody can reset them, which is why the vault gives you a recovery key.</p>
          <div className="cards3">
            <div className="gcard"><div className="ico"><EyeOff /></div><h3>Zero-knowledge</h3><p>Names and contents are encrypted. Only you (and wallets you approve) hold the key to open them.</p></div>
            <div className="gcard"><div className="ico"><Fingerprint /></div><h3>Tamper-evident</h3><p>Open a file and the app re-checks its fingerprint against the blockchain before showing it.</p></div>
            <div className="gcard"><div className="ico"><ShieldCheck /></div><h3>You control sharing</h3><p>Grant and revoke access per file. Shared keys are sealed to the recipient’s public key.</p></div>
          </div>
        </section>

        <section className="section" id="faq">
          <h2>Questions</h2>
          <div className="faq">
            <details><summary>What if I forget my master password?</summary><p>Use your recovery key on the “Forgot password?” screen. If you have neither, your files cannot be recovered. That is the price of real zero-knowledge encryption.</p></details>
            <details><summary>What is public on the blockchain?</summary><p>The file’s SHA-256 fingerprint, its IPFS content ID and the wallet addresses with access. File contents and file names stay encrypted.</p></details>
            <details><summary>Does it cost anything?</summary><p>The app is free. Writing to Ethereum needs a small network fee, paid in test ETH on Sepolia or the local test network.</p></details>
            <details><summary>Can a file be deleted from IPFS?</summary><p>You can remove the record from the vault, but IPFS data cannot be erased. It stays unreadable because only your key can decrypt it.</p></details>
          </div>
        </section>
        <footer className="footer">Encrypted File Vault · AES-256 · IPFS · Ethereum</footer>
      </div>
    </div>
  );
}
