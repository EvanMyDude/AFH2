// Act From Here 2 — GitHub Pages wrapper.
// Provides what the claude.ai artifact environment provided for free:
//   1. window.storage  → localStorage adapter (same async contract, plus a freeze flag)
//   2. Anthropic fetch → injects the user's own API key (BYO-key pattern)
//   3. Durability      → GitHub Gist sync (cross-device) + JSON export/import
// Plus the one-time legacy import from the original ActFromHere app.
import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ActFromHere from "./act-from-here.jsx";
import { STORE_KEY, migrate, serialize, seed, clampSavedAt, looksLikeState } from "./model.js";
import { applySeed } from "./seed-big-ticket.js";

// AFH2 owns its own keys. Both apps share this origin's localStorage, and the
// old app's migrate() strips unknown fields — sharing a key would destroy
// subsection data on its next save. Credentials are reused (they're already here).
const DATA_KEY = STORE_KEY;              // "afh2-v1"
const META_KEY = "afh2-meta";            // { savedAt, pushedAt }
const K_ANTHROPIC = "afh-anthropic-key"; // shared with the old app on purpose
const K_GH_TOKEN = "afh-gh-token";       // shared with the old app on purpose
const K_GIST_ID = "afh2-gist-id";
const GIST_DESC = "afh2-data";           // constant → second device finds the same gist
const GIST_FILE = "afh2.json";
const CONFLICT_KEY = "afh2-conflict-backup";
const LEGACY_DATA_KEY = "afh-v1";        // read once, never written
const LEGACY_META_KEY = "afh-meta";
const PUSH_DEBOUNCE = 2500;
const NET_TIMEOUT = 4000;
const MAX_PUSH_BYTES = 900000; // GitHub truncates gist file content above ~1 MB

const now = () => Date.now();
const getMeta = () => {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY)) || {};
    return { savedAt: m.savedAt || 0, pushedAt: m.pushedAt || 0 };
  } catch { return { savedAt: 0, pushedAt: 0 }; }
};
const setMeta = (m) => localStorage.setItem(META_KEY, JSON.stringify(m));
const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { console.error("stash failed", k, e); return false; } };
const flushApp = () => { try { window.dispatchEvent(new Event("afh:flush")); } catch (e) { console.error(e); } };

// ---------- sync engine (gist) ----------
export const sync = {
  status: "off",            // off | ok | pending | error | pulling
  lastError: "",
  listeners: new Set(),
  timer: null,
  op: null,                 // promise chain: pushes and adoptions never interleave
};
// Every network operation that reads or writes the gist runs through here, one
// at a time, so a push can never land between an adoption's pull and its
// meta comparison (which would defeat the conflict stash). Callers get the
// real result of their own operation.
const serial = (fn) => {
  const run = () => fn();
  const p = (sync.op || Promise.resolve()).then(run, run);
  sync.op = p.catch(() => {});
  return p;
};
const emit = () => sync.listeners.forEach((fn) => fn());
const setStatus = (s, err) => { sync.status = s; sync.lastError = err || ""; emit(); };
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" });
const isAbort = (e) => e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
const withTimeout = (ms) => {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  return { signal: ctrl ? ctrl.signal : undefined, done: () => { if (t) clearTimeout(t); } };
};

export async function findOrCreateGist(token, signal) {
  let id = localStorage.getItem(K_GIST_ID);
  if (id) return id;
  const listMine = async () => {
    const found = [];
    for (let page = 1; page <= 10; page++) {
      const list = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, { headers: ghHeaders(token), signal });
      if (list.status === 401) throw new Error("token rejected (401)");
      if (!list.ok) throw new Error(`gist list failed (${list.status})`); // never fall through and create a duplicate
      const gists = await list.json();
      found.push(...gists.filter((g) => g.description === GIST_DESC && g.files && g.files[GIST_FILE]));
      if (!Array.isArray(gists) || gists.length < 100) break;
    }
    return found.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  };
  const mine = await listMine();
  if (mine.length) { localStorage.setItem(K_GIST_ID, mine[0].id); return mine[0].id; }
  const create = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: ghHeaders(token),
    signal,
    body: JSON.stringify({ description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify({ savedAt: 0, data: null }) } } }),
  });
  if (!create.ok) throw new Error(`gist create failed (${create.status})`);
  const g = await create.json();
  // Two devices booting within seconds both list-then-create. Reconcile: keep the oldest.
  try {
    const again = await listMine();
    if (again.length && again[0].id !== g.id) {
      await fetch(`https://api.github.com/gists/${g.id}`, { method: "DELETE", headers: ghHeaders(token), signal }).catch(() => {});
      localStorage.setItem(K_GIST_ID, again[0].id);
      return again[0].id;
    }
  } catch (e) { console.error("gist reconcile:", e); }
  localStorage.setItem(K_GIST_ID, g.id);
  return g.id;
}

export const pushToGist = () => serial(pushNow);
async function pushNow() {
  const token = localStorage.getItem(K_GH_TOKEN);
  if (!token) { setStatus("off"); return; }
  const m = getMeta();
  if (m.savedAt <= m.pushedAt) { if (sync.status !== "error") setStatus("ok"); return; } // nothing stranded (also dedupes hidden+pagehide)
  setStatus("pending");
  try {
    const payload = { savedAt: m.savedAt, data: localStorage.getItem(DATA_KEY) };
    const body = JSON.stringify({ files: { [GIST_FILE]: { content: JSON.stringify(payload) } } });
    if (body.length > MAX_PUSH_BYTES) throw new Error("data too large to sync (>900 KB) — export a backup and clear done items");
    const patch = async () => fetch(`https://api.github.com/gists/${await findOrCreateGist(token)}`, {
      method: "PATCH",
      headers: ghHeaders(token),
      body,
      // keepalive lets the request finish after the page is backgrounded, but
      // browsers cap keepalive bodies (~64KB) — fall back for oversized states
      keepalive: body.length < 60000,
    });
    let res = await patch();
    if (res.status === 404) { localStorage.removeItem(K_GIST_ID); res = await patch(); } // cached id points at a deleted gist
    if (!res.ok) throw new Error(`push failed (${res.status})`);
    setMeta({ ...getMeta(), pushedAt: payload.savedAt });
    setStatus("ok");
  } catch (e) {
    console.error("gist push:", e);
    setStatus("error", String(e.message || e));
  }
}

const schedulePush = () => {
  if (!localStorage.getItem(K_GH_TOKEN)) return;
  setStatus("pending");
  if (sync.timer) clearTimeout(sync.timer);
  sync.timer = setTimeout(pushToGist, PUSH_DEBOUNCE);
};

// Returns { savedAt, data } or null (no data). Throws on network/auth failure.
export async function pullFromGist({ timeoutMs = NET_TIMEOUT } = {}) {
  const token = localStorage.getItem(K_GH_TOKEN);
  if (!token) return null;
  const t = withTimeout(timeoutMs);
  try {
    const get = async () => fetch(`https://api.github.com/gists/${await findOrCreateGist(token, t.signal)}`, { headers: ghHeaders(token), signal: t.signal });
    let res = await get();
    if (res.status === 404) { localStorage.removeItem(K_GIST_ID); res = await get(); } // cached id points at a deleted gist
    if (!res.ok) throw new Error(`pull failed (${res.status})`);
    const g = await res.json();
    const file = g.files && g.files[GIST_FILE];
    if (file && file.truncated) throw new Error("gist too large to sync — export a backup and clear done items");
    const raw = file && file.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const savedAt = clampSavedAt(parsed.savedAt);
    if (savedAt === null) throw new Error("remote timestamp invalid — not adopted");
    return { savedAt, data: typeof parsed.data === "string" ? parsed.data : null };
  } finally { t.done(); }
}

// Adopt remote if strictly newer than local. Returns true if adopted (caller
// decides whether to reload). Remote data is run through migrate+serialize
// first — a hostile or truncated gist is refused, never written.
export const adoptRemoteIfNewer = () => serial(adoptNow);
async function adoptNow() {
  try {
    const remote = await pullFromGist();
    // Land anything the user typed DURING the pull before comparing — otherwise
    // an edit made in that window is overwritten by the adoption and lost.
    flushApp();
    const m = getMeta();
    if (remote && remote.data && remote.savedAt > m.savedAt) {
      const parsed = JSON.parse(remote.data);
      if (!looksLikeState(parsed)) throw new Error("remote data unrecognized — not adopted");
      const clean = serialize(migrate(parsed));
      const local = localStorage.getItem(DATA_KEY);
      if (local === clean) {
        // same content, newer stamp — align meta, no reload needed
        setMeta({ savedAt: remote.savedAt, pushedAt: remote.savedAt });
        setStatus("ok");
        return false;
      }
      // Local holds edits that never reached the gist AND remote moved past them:
      // last-write-wins takes remote, but the loser is stashed — never silently lost.
      if (m.savedAt > m.pushedAt && local !== null) {
        safeSet(CONFLICT_KEY, JSON.stringify({ source: "afh2-local", savedAt: m.savedAt, stashedAt: now(), data: local }));
      }
      localStorage.setItem(DATA_KEY, clean);
      setMeta({ savedAt: remote.savedAt, pushedAt: remote.savedAt });
      setStatus("ok");
      return true;
    }
    if (remote) setStatus("ok");
    return false;
  } catch (e) {
    console.error("gist pull:", e);
    setStatus("error", isAbort(e) ? "timed out reaching GitHub" : String(e.message || e));
    return false;
  }
}

// Adopt + reload, with the freeze flag so nothing (debounce, hide-flush) can
// write the pre-adoption state back over the adopted blob during the reload.
const adoptAndReload = async () => {
  flushApp();
  const adopted = await adoptRemoteIfNewer();
  if (adopted) { window.storage.frozen = true; location.reload(); }
  return adopted;
};

// ---------- window.storage adapter (component contract) ----------
export function installStorageAdapter() {
  // A brand-new device auto-seeds default content on first boot. That seed must
  // NEVER outrank real data on another device in last-write-wins sync — so the
  // write that CREATES the data key gets watermark 1 (always loses) and is not
  // pushed. Checked per-write, not at boot.
  window.storage = {
    frozen: false, // set right before a reload that follows an adoption/import
    async get(key) {
      const v = localStorage.getItem(key);
      if (v === null) throw new Error(`key not found: ${key}`);
      return { key, value: v, shared: false };
    },
    // opts.touch === false → write the bytes only (canonical re-serialization on
    // load); the watermark and the push schedule are left alone, because the
    // user didn't edit anything and a fresh stamp could outrank real edits elsewhere.
    async set(key, value, opts) {
      if (window.storage.frozen) return { key, value, shared: false, frozen: true };
      const existedBefore = key !== DATA_KEY || localStorage.getItem(DATA_KEY) !== null;
      localStorage.setItem(key, value);
      if (key === DATA_KEY && !(opts && opts.touch === false && existedBefore)) {
        if (!existedBefore) {
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
    if (url === "https://api.anthropic.com/v1/messages") {
      const key = localStorage.getItem(K_ANTHROPIC);
      if (!key) return Promise.reject(new Error("No Anthropic API key set — open the ⇄ panel. Your dump stays put."));
      // The artifact environment capped max_tokens at 1000; a big dump's JSON
      // gets truncated at that cap. On the user's own key there's no such limit.
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
const download = (name, text) => {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); // Safari/Firefox can cancel the download if revoked synchronously
};

export function exportBackup() {
  const data = localStorage.getItem(DATA_KEY) || "null";
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  download(`afh2-backup-${stamp}.json`, JSON.stringify({ savedAt: getMeta().savedAt, exportedAt: now(), data }, null, 2));
}

// Accepts a full backup {data: "..."} (from either app) or the raw state itself.
// Runs migrate (lossless) + applySeed (no-op if already seeded). The caller reloads.
export function importBackup(text) {
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("not valid JSON"); }
  const raw = payload && typeof payload.data === "string" ? payload.data : JSON.stringify(payload);
  let state;
  try { state = JSON.parse(raw); } catch { throw new Error("not valid JSON"); }
  if (!looksLikeState(state)) throw new Error("doesn't look like Act From Here data");
  const clean = serialize(applySeed(migrate(state)));
  flushApp();
  try { localStorage.setItem(DATA_KEY, clean); }
  catch (e) { throw new Error("couldn't store the backup (" + ((e && e.name) || e) + ")"); }
  window.storage.frozen = true; // only once the write landed — the caller reloads next
  setMeta({ savedAt: now(), pushedAt: 0 }); // an explicit user action = real data; pushes on reload
  return true;
}

// ---------- first boot: adopt AFH2 gist, else import the old app's local data ----------
const askRetry = (mount, message) => new Promise((resolve) => {
  mount.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;color:#9A9AA3;font:12px/1.6 ui-monospace,Menlo,monospace;background:#0A0A0B";
  const box = document.createElement("div");
  box.style.maxWidth = "24rem";
  const p = document.createElement("div");
  p.textContent = "can't reach GitHub to check for existing AFH2 data (" + message + "). ";
  const p2 = document.createElement("div");
  p2.style.marginTop = "8px";
  p2.textContent = "retry, or continue with this device's copy of the old Act From Here data.";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;margin-top:14px";
  const mk = (label, val, primary) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = `font:inherit;padding:8px 14px;border-radius:999px;border:1px solid ${primary ? "#0A84FF" : "#26262B"};background:${primary ? "#0A84FF" : "transparent"};color:${primary ? "#fff" : "#F2F2F4"};cursor:pointer`;
    b.onclick = () => resolve(val);
    return b;
  };
  row.append(mk("retry", "retry", true), mk("continue with this device's copy", "continue", false));
  box.append(p, p2, row);
  wrap.append(box);
  mount.append(wrap);
});

export async function firstBoot(mount) {
  if (localStorage.getItem(DATA_KEY) !== null) return;
  const legacyRaw = localStorage.getItem(LEGACY_DATA_KEY);
  if (localStorage.getItem(K_GH_TOKEN)) {
    // AFH2 gist first: if this account already migrated elsewhere, that lineage wins.
    for (;;) {
      setStatus("pulling");
      const adopted = await adoptRemoteIfNewer();
      if (adopted) {
        if (legacyRaw !== null) safeSet(CONFLICT_KEY, JSON.stringify({ source: "legacy", savedAt: 0, stashedAt: now(), data: legacyRaw }));
        return;
      }
      if (sync.status !== "error") break; // checked: gist is empty → fall through to legacy import
      const choice = await askRetry(mount, sync.lastError);
      mount.innerHTML = "";
      if (choice === "continue") break;
    }
  }
  if (legacyRaw !== null) {
    try {
      const st = applySeed(migrate(JSON.parse(legacyRaw)));
      let lm = 0;
      try { lm = clampSavedAt((JSON.parse(localStorage.getItem(LEGACY_META_KEY)) || {}).savedAt) || 0; } catch { lm = 0; }
      localStorage.setItem(DATA_KEY, serialize(st));
      // Carried-forward timestamp, not now(): a stale snapshot must never outrank
      // newer edits elsewhere. pushedAt 0 → the boot stranded-check pushes it once.
      setMeta({ savedAt: Math.max(lm, 1), pushedAt: 0 });
      return;
    } catch (e) {
      console.error("legacy import failed — falling back to defaults; old data untouched", e);
      safeSet(CONFLICT_KEY, JSON.stringify({ source: "legacy-unreadable", savedAt: 0, stashedAt: now(), data: legacyRaw }));
    }
  }
  localStorage.setItem(DATA_KEY, serialize(applySeed(seed())));
  setMeta({ savedAt: 1, pushedAt: 1 }); // default seed: never outranks real data, not pushed
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

  const msgTimer = { current: null };
  const say = (m, ms) => { setMsg(m); if (msgTimer.current) clearTimeout(msgTimer.current); if (ms) msgTimer.current = setTimeout(() => setMsg(""), ms); };
  const saveKeys = async () => {
    const a = anthropicKey.trim();
    const g = ghToken.trim();
    if (a) localStorage.setItem(K_ANTHROPIC, a); else localStorage.removeItem(K_ANTHROPIC);
    const prev = localStorage.getItem(K_GH_TOKEN) || "";
    if (g) localStorage.setItem(K_GH_TOKEN, g); else { localStorage.removeItem(K_GH_TOKEN); localStorage.removeItem(K_GIST_ID); setStatus("off"); }
    if (g && g !== prev) localStorage.removeItem(K_GIST_ID); // a different token may be a different account
    say("saved on this device", 2500);
    if (g && g !== prev) {
      // new token on this device: adopt remote if it's ahead, else push what we have
      say("connecting to gist…");
      const adopted = await adoptAndReload();
      if (adopted) return;
      await pushToGist();
      say(sync.status === "error" ? "gist error — see status above" : "gist connected", 2500);
    }
  };

  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { importBackup(String(r.result)); location.reload(); }
      catch (err) { say("import failed: " + err.message, 4000); }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  const conflictRaw = localStorage.getItem(CONFLICT_KEY);
  let conflictSource = "";
  try { conflictSource = conflictRaw ? (JSON.parse(conflictRaw).source || "") : ""; } catch { conflictSource = ""; }
  const downloadConflict = () => { if (conflictRaw) download("afh2-conflict-backup.json", conflictRaw); };

  const statusDot = sync.status === "ok" ? P.green : sync.status === "pending" ? P.blue : sync.status === "error" ? P.red : P.faint;
  const statusLabel = { off: "sync off — this device only", ok: "synced to gist", pending: "syncing…", error: "sync error: " + sync.lastError, pulling: "checking remote…" }[sync.status] || sync.status;
  const conflictLabel = conflictSource === "legacy" ? "this device's old Act From Here copy was kept as a backup (the synced AFH2 data won)"
    : conflictSource === "legacy-unreadable" ? "the old Act From Here data couldn't be read — raw copy saved"
    : "a device's unsynced edits were superseded — backup saved";
  const noLegacyHint = !localStorage.getItem(LEGACY_DATA_KEY) && getMeta().savedAt === 1;

  return (
    <div style={{ position: "fixed", right: 14, bottom: "max(14px, env(safe-area-inset-bottom))", zIndex: 50, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" }}>
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
            <button onClick={() => { setStatus("pulling"); adoptAndReload(); }}
              className="font-mono text-xs px-2 py-1.5 rounded-md" style={{ color: P.text, border: `1px solid ${P.edge}`, background: "transparent" }}>pull</button>
          </div>
          {msg && <div className="font-mono text-xs mt-2" style={{ color: P.dim }}>{msg}</div>}
          {noLegacyHint && (
            <div className="font-mono text-xs mt-2" style={{ color: P.dim }}>had Act From Here data? enter your GitHub token (after opening AFH2 on the device that has it) or import a backup to bring it over.</div>
          )}
          {conflictRaw && (
            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${P.edge}` }}>
              <div className="font-mono text-xs mb-1" style={{ color: conflictSource === "legacy" ? P.dim : P.red }}>{conflictLabel}</div>
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
  if ("serviceWorker" in navigator) {
    // registered from here (not an inline script) so the CSP can stay script-src 'self'
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
  // first boot: AFH2 gist first, then the old app's local data, then defaults
  try { await firstBoot(mountNode); } catch (e) { console.error("first boot:", e); }
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
    if (document.visibilityState === "hidden") {
      // Land the app's pending write FIRST (synchronous), then decide. iOS
      // freezes timers the moment the app is backgrounded — the debounced
      // push would never fire. Push NOW; keepalive lets it finish after suspend.
      flushApp();
      if (!localStorage.getItem(K_GH_TOKEN)) return;
      const m = getMeta();
      if (m.savedAt > m.pushedAt) {
        if (sync.timer) { clearTimeout(sync.timer); sync.timer = null; }
        pushToGist();
      }
      return;
    }
    if (document.visibilityState !== "visible") return;
    if (!localStorage.getItem(K_GH_TOKEN)) return;
    flushApp(); // commit any half-typed form so it can't be lost to a reload
    const m = getMeta();
    if (m.savedAt > m.pushedAt) { pushToGist(); return; } // our edits win; ship them
    adoptAndReload();
  });
  // leaving: best-effort final push of anything pending
  window.addEventListener("pagehide", () => {
    flushApp();
    if (sync.timer) { clearTimeout(sync.timer); sync.timer = null; }
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
