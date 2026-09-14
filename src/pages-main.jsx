// Act From Here — GitHub Pages wrapper.
// The component (act-from-here.jsx) is byte-identical to the claude.ai artifact.
// This file provides what claude.ai provided for free:
//   1. window.storage  → localStorage adapter (same async contract)
//   2. Anthropic fetch → injects the user's own API key (BYO-key pattern)
//   3. Durability      → GitHub Gist sync (cross-device) + JSON export/import
import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ActFromHere from "./act-from-here.jsx";

const DATA_KEY = "afh-v1";
const META_KEY = "afh-meta";            // { savedAt }
const K_ANTHROPIC = "afh-anthropic-key";
const K_GH_TOKEN = "afh-gh-token";
const K_GIST_ID = "afh-gist-id";
const GIST_DESC = "act-from-here-data"; // constant → second device finds the same gist
const GIST_FILE = "actfromhere.json";
const CONFLICT_KEY = "afh-conflict-backup";
const PUSH_DEBOUNCE = 2500;

const now = () => Date.now();
const getMeta = () => {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY)) || {};
    return { savedAt: m.savedAt || 0, pushedAt: m.pushedAt || 0 };
  } catch { return { savedAt: 0, pushedAt: 0 }; }
};
const setMeta = (m) => localStorage.setItem(META_KEY, JSON.stringify(m));

// ---------- sync engine (gist) ----------
export const sync = {
  status: "off",            // off | ok | pending | error | pulling
  lastError: "",
  lastPushedAt: 0,
  listeners: new Set(),
  timer: null,
  inFlight: false,
  queued: false,
};
const emit = () => sync.listeners.forEach((fn) => fn());
const setStatus = (s, err) => { sync.status = s; sync.lastError = err || ""; emit(); };
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" });

export async function findOrCreateGist(token) {
  let id = localStorage.getItem(K_GIST_ID);
  if (id) return id;
  const list = await fetch("https://api.github.com/gists?per_page=100", { headers: ghHeaders(token) });
  if (list.ok) {
    const gists = await list.json();
    const mine = gists.find((g) => g.description === GIST_DESC && g.files && g.files[GIST_FILE]);
    if (mine) { localStorage.setItem(K_GIST_ID, mine.id); return mine.id; }
  } else if (list.status === 401) { throw new Error("token rejected (401)"); }
  const create = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify({ savedAt: 0, data: null }) } } }),
  });
  if (!create.ok) throw new Error(`gist create failed (${create.status})`);
  const g = await create.json();
  localStorage.setItem(K_GIST_ID, g.id);
  return g.id;
}

export async function pushToGist() {
  const token = localStorage.getItem(K_GH_TOKEN);
  if (!token) { setStatus("off"); return; }
  if (sync.inFlight) { sync.queued = true; return; }
  sync.inFlight = true;
  setStatus("pending");
  try {
    const id = await findOrCreateGist(token);
    const payload = { savedAt: getMeta().savedAt, data: localStorage.getItem(DATA_KEY) };
    const body = JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(payload) } } });
    const res = await fetch(`https://api.github.com/gists/${id}`, {
      method: "PATCH",
      headers: ghHeaders(token),
      body,
      // keepalive lets the request finish after the page is backgrounded, but
      // browsers cap keepalive bodies (~64KB) — fall back for oversized states
      keepalive: body.length < 60000,
    });
    if (!res.ok) throw new Error(`push failed (${res.status})`);
    sync.lastPushedAt = payload.savedAt;
    setMeta({ ...getMeta(), pushedAt: payload.savedAt });
    setStatus("ok");
  } catch (e) {
    console.error("gist push:", e);
    setStatus("error", String(e.message || e));
  } finally {
    sync.inFlight = false;
    if (sync.queued) { sync.queued = false; pushToGist(); }
  }
}

const schedulePush = () => {
  if (!localStorage.getItem(K_GH_TOKEN)) return;
  setStatus("pending");
  if (sync.timer) clearTimeout(sync.timer);
  sync.timer = setTimeout(pushToGist, PUSH_DEBOUNCE);
};

export async function pullFromGist({ timeoutMs = 4000 } = {}) {
  const token = localStorage.getItem(K_GH_TOKEN);
  if (!token) return null;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const id = await findOrCreateGist(token);
    const res = await fetch(`https://api.github.com/gists/${id}`, { headers: ghHeaders(token), signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) throw new Error(`pull failed (${res.status})`);
    const g = await res.json();
    const raw = g.files && g.files[GIST_FILE] && g.files[GIST_FILE].content;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.savedAt === "number" ? parsed : null;
  } finally { if (t) clearTimeout(t); }
}

// Adopt remote if strictly newer than local. Returns true if adopted.
export async function adoptRemoteIfNewer() {
  try {
    const remote = await pullFromGist();
    const m = getMeta();
    if (remote && remote.data && remote.savedAt > m.savedAt) {
      // Local holds edits that never reached the gist AND remote moved past them:
      // last-write-wins takes remote, but the loser is stashed — never silently lost.
      if (m.savedAt > m.pushedAt && localStorage.getItem(DATA_KEY)) {
        localStorage.setItem(CONFLICT_KEY, JSON.stringify({ savedAt: m.savedAt, stashedAt: now(), data: localStorage.getItem(DATA_KEY) }));
      }
      localStorage.setItem(DATA_KEY, remote.data);
      setMeta({ savedAt: remote.savedAt, pushedAt: remote.savedAt });
      sync.lastPushedAt = remote.savedAt;
      setStatus("ok");
      return true;
    }
    if (remote) setStatus("ok");
    return false;
  } catch (e) {
    console.error("gist pull:", e);
    setStatus("error", String(e.message || e));
    return false;
  }
}

// ---------- window.storage adapter (component contract) ----------
export function installStorageAdapter() {
  // A brand-new device auto-seeds default content on first boot. That seed must
  // NEVER outrank real data on another device in last-write-wins sync — so the
  // write that CREATES the data key gets watermark 1 (always loses) and is not
  // pushed. Checked per-write, not at boot: a gist adoption creates the key too,
  // so the first user edit after adopting is correctly treated as real data.
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      if (v === null) throw new Error(`key not found: ${key}`);
      return { key, value: v, shared: false };
    },
    async set(key, value) {
      const existedBefore = key !== DATA_KEY || localStorage.getItem(DATA_KEY) !== null;
      localStorage.setItem(key, value);
      if (key === DATA_KEY) {
        const seedWrite = !existedBefore;
        if (seedWrite) {
          setMeta({ savedAt: 1, pushedAt: 1 });
        } else {
          setMeta({ ...getMeta(), savedAt: now() });
          schedulePush();
        }
      }
      return { key, value, shared: false };
    },
    async delete(key) { localStorage.removeItem(key); return { key, deleted: true, shared: false }; },
    async list(prefix) {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!prefix || k.startsWith(prefix)) keys.push(k);
      }
      return { keys, prefix, shared: false };
    },
  };
}

// ---------- Anthropic fetch shim (BYO API key) ----------
export function installAnthropicShim() {
  const orig = window.fetch.bind(window);
  window.fetch = (url, opts = {}) => {
    if (typeof url === "string" && url.startsWith("https://api.anthropic.com/")) {
      const key = localStorage.getItem(K_ANTHROPIC);
      if (!key) return Promise.reject(new Error("No Anthropic API key set — open the ⇄ panel. Your dump stays put."));
      // The claude.ai artifact environment capped max_tokens at 1000; a big dump's
      // JSON gets truncated at that cap and fails to parse. Direct API on the
      // user's own key has no such constraint — raise the ceiling.
      let body = opts.body;
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.max_tokens === "number" && parsed.max_tokens <= 1024) {
          parsed.max_tokens = 4000;
          body = JSON.stringify(parsed);
        }
      } catch (e) {}
      opts = {
        ...opts,
        body,
        headers: {
          ...(opts.headers || {}),
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      };
    }
    return orig(url, opts);
  };
}

// ---------- export / import ----------
export function exportBackup() {
  const data = localStorage.getItem(DATA_KEY) || "null";
  const blob = new Blob([JSON.stringify({ savedAt: getMeta().savedAt, exportedAt: now(), data }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const d = new Date();
  a.download = `afh-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importBackup(text) {
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("not valid JSON"); }
  // accept either a full backup {data: "..."} or the raw state itself
  const raw = typeof payload.data === "string" ? payload.data : JSON.stringify(payload);
  const state = JSON.parse(raw);
  if (!state || typeof state !== "object" || (!state.items && !state.week)) throw new Error("doesn't look like Act From Here data");
  localStorage.setItem(DATA_KEY, raw);
  setMeta({ savedAt: now() });
  schedulePush();
  return true;
}

// ---------- settings panel ----------
const P = { bg: "#0A0A0B", card: "#151517", edge: "#26262B", text: "#F2F2F4", dim: "#9A9AA3", faint: "#5B5B64", blue: "#0A84FF", red: "#FF453A", green: "#30D158" };

function SyncPanel() {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [anthropicKey, setAnthropicKey] = useState(localStorage.getItem(K_ANTHROPIC) || "");
  const [ghToken, setGhToken] = useState(localStorage.getItem(K_GH_TOKEN) || "");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const fn = () => force((n) => n + 1);
    sync.listeners.add(fn);
    return () => sync.listeners.delete(fn);
  }, []);

  const saveKeys = async () => {
    const a = anthropicKey.trim();
    const g = ghToken.trim();
    if (a) localStorage.setItem(K_ANTHROPIC, a); else localStorage.removeItem(K_ANTHROPIC);
    const hadToken = !!localStorage.getItem(K_GH_TOKEN);
    if (g) localStorage.setItem(K_GH_TOKEN, g); else { localStorage.removeItem(K_GH_TOKEN); localStorage.removeItem(K_GIST_ID); setStatus("off"); }
    setMsg("saved on this device");
    if (g && !hadToken) {
      // first-time token on this device: adopt remote if it's ahead, else push what we have
      setMsg("connecting to gist…");
      const adopted = await adoptRemoteIfNewer();
      if (adopted) { location.reload(); return; }
      pushToGist();
      setMsg("gist connected");
    }
    setTimeout(() => setMsg(""), 2500);
  };

  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { importBackup(String(r.result)); location.reload(); }
      catch (err) { setMsg("import failed: " + err.message); setTimeout(() => setMsg(""), 4000); }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  const downloadConflict = () => {
    const raw = localStorage.getItem(CONFLICT_KEY);
    if (!raw) return;
    const blob = new Blob([raw], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "afh-conflict-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const statusDot = sync.status === "ok" ? P.green : sync.status === "pending" ? P.blue : sync.status === "error" ? P.red : P.faint;
  const statusLabel = { off: "sync off — this device only", ok: "synced to gist", pending: "syncing…", error: "sync error: " + sync.lastError, pulling: "checking remote…" }[sync.status] || sync.status;

  return (
    <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 50, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" }}>
      {open && (
        <div className="rounded-2xl p-3 mb-2" style={{ background: P.card, border: `1px solid ${P.edge}`, width: 300, maxWidth: "calc(100vw - 28px)", color: P.text, boxShadow: "0 8px 30px rgba(0,0,0,0.6)" }}>
          <div className="font-mono text-xs tracking-widest mb-2 flex items-center gap-2" style={{ color: P.dim }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: statusDot }} />
            {statusLabel}
          </div>
          <label className="font-mono text-xs" style={{ color: P.faint }}>Anthropic API key (Sort It)</label>
          <input type="password" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} placeholder="sk-ant-…" aria-label="anthropic api key"
            className="w-full text-xs font-mono outline-none rounded-md px-2 py-1.5 mt-1 mb-2" style={{ background: P.bg, color: P.text, border: `1px solid ${P.edge}` }} />
          <label className="font-mono text-xs" style={{ color: P.faint }}>GitHub token (gist scope — cross-device sync)</label>
          <input type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder="ghp_…" aria-label="github token"
            className="w-full text-xs font-mono outline-none rounded-md px-2 py-1.5 mt-1 mb-2" style={{ background: P.bg, color: P.text, border: `1px solid ${P.edge}` }} />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={saveKeys} className="font-mono text-xs px-3 py-1.5 rounded-full font-bold" style={{ background: P.blue, color: "#fff" }}>save keys</button>
            <button onClick={exportBackup} className="font-mono text-xs px-2 py-1.5 rounded-md" style={{ color: P.text, border: `1px solid ${P.edge}`, background: "transparent" }}>export</button>
            <label className="font-mono text-xs px-2 py-1.5 rounded-md" style={{ color: P.text, border: `1px solid ${P.edge}`, cursor: "pointer" }}>
              import<input type="file" accept="application/json" onChange={onImportFile} style={{ display: "none" }} aria-label="import backup" />
            </label>
            <button onClick={() => { setStatus("pulling"); adoptRemoteIfNewer().then((a) => { if (a) location.reload(); }); }}
              className="font-mono text-xs px-2 py-1.5 rounded-md" style={{ color: P.text, border: `1px solid ${P.edge}`, background: "transparent" }}>pull</button>
          </div>
          {msg && <div className="font-mono text-xs mt-2" style={{ color: P.dim }}>{msg}</div>}
          {localStorage.getItem(CONFLICT_KEY) && (
            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${P.edge}` }}>
              <div className="font-mono text-xs mb-1" style={{ color: P.red }}>a device's unsynced edits were superseded — backup saved</div>
              <div className="flex gap-2">
                <button onClick={downloadConflict} className="font-mono text-xs px-2 py-1 rounded-md" style={{ color: P.text, border: `1px solid ${P.edge}`, background: "transparent" }}>download backup</button>
                <button onClick={() => { localStorage.removeItem(CONFLICT_KEY); force((n) => n + 1); }} className="font-mono text-xs px-2 py-1 rounded-md" style={{ color: P.dim, border: `1px solid ${P.edge}`, background: "transparent" }}>dismiss</button>
              </div>
            </div>
          )}
          <div className="font-mono text-xs mt-2" style={{ color: P.faint }}>keys live only in this browser · gist is private on your GitHub</div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setOpen((o) => !o)} aria-label="sync and backup panel"
          className="font-mono text-xs px-3 py-1.5 rounded-full"
          style={{ background: P.card, color: P.dim, border: `1px solid ${P.edge}`, boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
          ⇄ <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 7, background: statusDot, marginLeft: 4, verticalAlign: "middle" }} />
        </button>
      </div>
    </div>
  );
}

function Root() {
  return (
    <>
      <ActFromHere />
      <SyncPanel />
    </>
  );
}

// ---------- boot ----------
export async function boot(mountNode) {
  installStorageAdapter();
  installAnthropicShim();
  // startup gate: if sync is configured, adopt a newer remote BEFORE the app reads storage
  if (localStorage.getItem(K_GH_TOKEN)) {
    setStatus("pulling");
    try { await adoptRemoteIfNewer(); } catch (e) { console.error(e); }
    // iOS suspends timers on background and often kills the process — a prior
    // session's debounced push may never have fired. Ship stranded edits now.
    const m0 = getMeta();
    if (m0.savedAt > m0.pushedAt) pushToGist();
  }
  // returning to the tab/app: pick up edits made on another device
  document.addEventListener("visibilitychange", async () => {
    if (!localStorage.getItem(K_GH_TOKEN)) return;
    const m = getMeta();
    if (document.visibilityState === "hidden") {
      // iOS freezes timers the moment the app is backgrounded — the debounced
      // push would never fire. Push NOW; keepalive lets it finish after suspend.
      if (m.savedAt > m.pushedAt) {
        if (sync.timer) { clearTimeout(sync.timer); sync.timer = null; }
        pushToGist();
      }
      return;
    }
    if (document.visibilityState !== "visible") return;
    if (m.savedAt > m.pushedAt) { pushToGist(); return; } // our edits win; ship them
    const adopted = await adoptRemoteIfNewer();
    if (adopted) location.reload();
  });
  // leaving: best-effort final push of anything pending
  window.addEventListener("pagehide", () => {
    const m = getMeta();
    if (localStorage.getItem(K_GH_TOKEN) && m.savedAt > m.pushedAt) pushToGist();
  });
  const root = createRoot(mountNode);
  root.render(<Root />);
  return root;
}

if (typeof document !== "undefined" && document.getElementById("root") && !window.__AFH_TEST__) {
  boot(document.getElementById("root"));
}
