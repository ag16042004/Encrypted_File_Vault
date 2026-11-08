import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Lock, Eye, EyeOff, X, Folder, FileText, FileArchive, FileSpreadsheet, Image as ImageIcon, Film, Music, PenTool, File as FileIcon,
  Check, Circle,
} from "lucide-react";

// ------------------------------------------------------------------ brand
export function Logo({ to }) {
  const inner = (
    <span className="logo">
      <Lock strokeWidth={2.4} />
      <span>EFV</span>
    </span>
  );
  return inner;
}

// Soft purple waves behind the auth screens (matches the board's corner swooshes)
export function BgArt() {
  return (
    <svg className="bg-art" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="wv1" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a35fc8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5d3f93" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="wv2" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#8c4fb9" stopOpacity="0.6" />
          <stop offset="1" stopColor="#4a4a8f" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="wv3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6c7fb5" stopOpacity="0.28" />
          <stop offset="1" stopColor="#3a4a78" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d="M1440 0 V440 C1340 360 1270 410 1200 320 C1130 230 1190 90 1070 0 Z" fill="url(#wv1)" />
      <path d="M1440 120 C1330 160 1290 300 1180 340 C1090 372 1010 330 930 380" fill="none" stroke="#fff" strokeOpacity="0.10" strokeWidth="1.5" />
      <path d="M0 560 C110 590 170 720 320 770 C450 812 560 780 650 900 H0 Z" fill="url(#wv2)" />
      <path d="M0 640 C100 660 150 780 260 830 C340 866 430 850 500 900" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="1.5" />
      <path d="M1440 900 V620 C1360 650 1300 760 1200 800 C1130 828 1060 810 980 900 Z" fill="url(#wv3)" />
    </svg>
  );
}

// ---------------------------------------------------------- glass folder art
export function GlassFolder({ lock = true, width = 400 }) {
  return (
    <svg viewBox="0 0 400 400" width={width} role="img" aria-label="Encrypted folder">
      <defs>
        <linearGradient id="gfBack" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9d0e6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8d97bb" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id="gfFront" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d7a4ec" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#a65bc9" stopOpacity="0.92" />
          <stop offset="1" stopColor="#7e3fae" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="gfShine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id="gfGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" /></filter>
      </defs>
      <ellipse cx="205" cy="372" rx="130" ry="14" fill="#9a4fc4" opacity="0.35" filter="url(#gfGlow)" />
      {/* back folder (frosted blue-grey) */}
      <path d="M168 62 H250 Q263 62 272 73 L286 91 H342 Q360 91 360 109 V300 Q360 318 342 318 H168 Q150 318 150 300 V80 Q150 62 168 62Z" fill="url(#gfBack)" stroke="#fff" strokeOpacity="0.38" strokeWidth="1.5" />
      <path d="M170 64 H248 Q259 64 266 72 L280 89 H150 V80 Q150 64 170 64Z" fill="url(#gfShine)" opacity="0.5" />
      {/* front folder (purple glass) */}
      <path d="M62 138 H152 Q166 138 175 150 L190 170 H258 Q278 170 278 190 V340 Q278 360 258 360 H62 Q42 360 42 340 V158 Q42 138 62 138Z" fill="url(#gfFront)" stroke="#f3d4ff" strokeOpacity="0.7" strokeWidth="1.6" />
      <path d="M64 140 H150 Q163 140 171 151 L184 168 H44 V158 Q44 140 64 140Z" fill="url(#gfShine)" opacity="0.55" />
      <path d="M44 190 H278" stroke="#fff" strokeOpacity="0.22" />
      {lock && (
        <g transform="translate(160 262)">
          <path d="M-14 -14 v-12 a14 14 0 0 1 28 0 v12" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" />
          <rect x="-24" y="-14" width="48" height="40" rx="9" fill="#fff" />
          <circle cx="0" cy="3" r="5" fill="#8a3f9f" />
          <rect x="-2" y="5" width="4" height="12" rx="2" fill="#8a3f9f" />
        </g>
      )}
    </svg>
  );
}

// ------------------------------------------------------------------ fields
export function TextField({ icon: Icon, label, value, onChange, type = "text", placeholder, autoComplete, autoFocus, onEnter, error, name, inputMode }) {
  const id = React.useId();
  return (
    <div className={"field" + (label ? " tall" : "") + (error ? " error" : "")}>
      {Icon && <Icon />}
      <div className="field-body">
        {label && <label htmlFor={id}>{label}</label>}
        <input
          id={id} name={name} type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} autoFocus={autoFocus}
          inputMode={inputMode} aria-label={label || placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        />
      </div>
    </div>
  );
}

export function PasswordField({ label, value, onChange, placeholder, autoComplete, autoFocus, onEnter, error, name }) {
  const [show, setShow] = useState(false);
  const id = React.useId();
  return (
    <div className={"field" + (label ? " tall" : "") + (error ? " error" : "")}>
      <Lock />
      <div className="field-body">
        {label && <label htmlFor={id}>{label}</label>}
        <input
          id={id} name={name} type={show ? "text" : "password"} value={value} placeholder={placeholder} autoComplete={autoComplete}
          autoFocus={autoFocus} aria-label={label || placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        />
      </div>
      <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

export function CheckRow({ checked, onChange, children, light }) {
  return (
    <label className="check-row">
      <input type="checkbox" className={"check" + (light ? " on-light" : "")} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// ---------------------------------------------------------------- stepper
export function Stepper({ step }) {
  const nodes = ["Create Account", "Recovery Key", "Done"];
  return (
    <div className="stepper" aria-label={`Step ${step} of 3`}>
      {nodes.map((label, i) => (
        <React.Fragment key={label}>
          <div className={"node" + (step === i + 1 ? " active" : "")}>
            <span className="dot">{i + 1}</span>
            <span>{label}</span>
          </div>
          {i < nodes.length - 1 && (
            <div className="line" aria-hidden="true">
              <i /><b /><i />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- file icons
const KIND_ICON = {
  pdf: FileText, doc: FileText, text: FileText, zip: FileArchive, sheet: FileSpreadsheet,
  image: ImageIcon, video: Film, audio: Music, design: PenTool, other: FileIcon,
};

export function FileTile({ kind = "other", folder, className = "" }) {
  if (folder) {
    return (
      <span className={"ftile folder " + className}>
        <Folder />
      </span>
    );
  }
  const Icon = KIND_ICON[kind] || FileIcon;
  return (
    <span className={`ftile ${kind} ${className}`}>
      <Icon />
    </span>
  );
}

export const ProgressBar = ({ value }) => (
  <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
    <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

// ------------------------------------------------------------------- modal
export function Modal({ onClose, children, className = "", label }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={"modal " + className} role="dialog" aria-modal="true" aria-label={label}>
        {onClose && (
          <button className="x" onClick={onClose} aria-label="Close">
            <X />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return createPortal(
    <div className={"toast " + (toast.kind || "ok")} role="status">
      {toast.kind === "bad" ? <X /> : <Check />}
      <span>{toast.message}</span>
    </div>,
    document.body,
  );
}

export const Dot = Circle;
