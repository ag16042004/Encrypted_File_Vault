// Download / print / copy helpers for the recovery key screens.

export function downloadRecoveryKey(email, key) {
  const text = [
    "ENCRYPTED FILE VAULT - RECOVERY KEY",
    "",
    `Vault  : ${email}`,
    `Key    : ${key}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "Keep this file somewhere safe and offline.",
    "Anyone who has this key and your vault backup can unlock your files.",
    "We cannot reset your password or recover this key for you.",
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "EFV-recovery-key.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function printRecoveryKey(email, key) {
  const el = document.createElement("div");
  el.className = "print-only";
  el.innerHTML = `
    <h1 style="margin:0 0 6px">Encrypted File Vault</h1>
    <h2 style="margin:0 0 30px;font-weight:500">Recovery key for ${escapeHtml(email)}</h2>
    <p><code>${escapeHtml(key)}</code></p>
    <p style="margin-top:30px;max-width:520px;line-height:1.5">Keep this page somewhere safe and offline. Anyone with this key and your vault backup can unlock your files. We cannot reset your password or recover this key for you.</p>`;
  document.body.appendChild(el);
  window.print();
  setTimeout(() => el.remove(), 500);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
