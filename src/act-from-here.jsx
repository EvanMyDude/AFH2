import { useState, useEffect, useRef, useCallback } from "react";
import {
  SECTION_META, SORT_HINTS, MAX_SECTIONS, STORE_KEY, CORRUPT_KEY,
  uid, firstGrapheme, migrate, serialize, seed, catchAllKey, safeHref, has,
} from "./model.js";
import { applySeed } from "./seed-big-ticket.js";
import { placeItem, groupOf } from "./arrange.js";

// ---------- palette (Apple Notes dark, his native habitat) ----------
const C = {
  bg: "#0A0A0B",
  card: "#151517",
  cardEdge: "#26262B",
  text: "#F2F2F4",
  dim: "#9A9AA3",
  faint: "#5B5B64",
  blue: "#0A84FF",
  blueSoft: "rgba(10,132,255,0.14)",
  red: "#FF453A",
  green: "#30D158",
};

const CLICK_DELAY = 220; // ms window separating single click (expand) from double click (edit)
// Local-only copy of the PASTE DUMP box, so text pasted from Notes survives the
// app being killed in the background or a sync reload. Never synced, never
// exported, never read by the sync layer; written only when the box changes.
const DRAFT_KEY = "afh2-dump-draft";
const readDraft = () => { try { return localStorage.getItem(DRAFT_KEY) || ""; } catch (e) { return ""; } };
// Arrange-mode drag handles: React's touch listeners are passive, so iOS
// scrolling and the long-press callout are blocked with native listeners.
const preventTouch = (e) => { if (e.cancelable) e.preventDefault(); };
const AUTOSCROLL_ZONE = 72; // px from the top/bottom edge where a drag scrolls the page
const metaLabel = (key) => (has(SECTION_META, key) ? SECTION_META[key].label : "UNTITLED");
const metaHint = (key) => (has(SECTION_META, key) ? SECTION_META[key].hint : "nothing here yet");

// Hover-reveal on pointer devices, always visible (dimmed) on touch. Tailwind's
// hoverOnlyWhenSupported wraps group-hover in (hover:hover) and (pointer:fine),
// so the "hidden until hover" rule uses the exact same condition.
const REVEAL = "opacity-70 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 transition-opacity";
const REVEAL_SEC = REVEAL + " group-hover:opacity-100 group-focus-within:opacity-100";
const REVEAL_SUB = REVEAL + " group-hover/sub:opacity-100 group-focus-within/sub:opacity-100";

// Touch-only sizing (pointer:coarse) so small controls get ~40 px targets on the
// phone while mouse layouts stay pixel-identical. Equal padding/negative margin
// grows the hit area without moving neighbours where the row has room for it.
const TOUCH_TALL = "[@media(pointer:coarse)]:min-h-[40px]";
const TOUCH_ICON = "[@media(pointer:coarse)]:min-w-[40px] [@media(pointer:coarse)]:py-3 [@media(pointer:coarse)]:-my-2";
// Bordered chips can't grow visibly; an invisible ::after extends the tap area instead.
// (8 px below stops just short of the section card, 10 px above is free space.)
const TOUCH_CHIP = "relative after:absolute after:inset-x-0 after:-top-2.5 after:-bottom-2 after:content-['']";

// Smooth open/close with unknown content height and no unmount: grid rows 0fr↔1fr.
// overflow-clip (not hidden) so a focused child can't scroll the box on iOS;
// contain:layout avoids a Safari end-of-transition flicker; inert removes the
// collapsed content from tab order and taps. min-w-0 keeps the content's
// min-content width (e.g. a long subsection name, which truncates) from
// stretching the card past the column on a phone.
function Collapsible({ open, children }) {
  return (
    <div className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
      <div className="min-h-0 min-w-0 overflow-clip [contain:layout]" inert={!open}>{children}</div>
    </div>
  );
}

export default function ActFromHere() {
  const [data, setData] = useState(null); // v4 state — see model.js
  const [loadError, setLoadError] = useState("");
  const [dump, setDump] = useState(readDraft);
  const [sorting, setSorting] = useState(false);
  const [toast, setToast] = useState("");
  const [toastUndo, setToastUndo] = useState(false); // the toast carries an "undo" button
  const [arranging, setArranging] = useState(false);  // Arrange mode (local UI state, never persisted)
  const [dragId, setDragId] = useState(null);         // item being dragged (dims its row)
  const [saveState, setSaveState] = useState("");
  const [openItem, setOpenItem] = useState(null);
  const [editing, setEditing] = useState(null);         // { sec, id, text, url, next }
  const [editingCat, setEditingCat] = useState(null);   // { key, value }
  const [managerOpen, setManagerOpen] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState(null); // { key, value }
  const [pendingDelete, setPendingDelete] = useState(null); // section key
  const [adding, setAdding] = useState(false);
  const [newSec, setNewSec] = useState({ glyph: "", name: "" });
  const [addingItem, setAddingItem] = useState(null); // { sec, sub } with an open quick-add form
  const [newItem, setNewItem] = useState({ text: "", url: "" });
  const [addingSub, setAddingSub] = useState(null);   // section key with an open new-subsection form
  const [newSubName, setNewSubName] = useState("");
  const [editingSub, setEditingSub] = useState(null); // { sec, key, value }
  const [pendingDeleteSub, setPendingDeleteSub] = useState(null); // { sec, key }
  // Refs mirror the transient form state and are cleared SYNCHRONOUSLY in every
  // close path. Chrome fires blur on an input that is removed while focused,
  // and React dispatches that stale onBlur with the previous render's closure —
  // without these guards, Esc could still commit and Enter could double-add.
  const editingRef = useRef(null);
  const editingCatRef = useRef(null);
  const editingGlyphRef = useRef(null);
  const editingSubRef = useRef(null);
  const addingRef = useRef(null);
  const addingSubRef = useRef(null);
  const onFlushRef = useRef(null);
  const addItemInputRef = useRef(null);
  const toastTimer = useRef(null);
  const undoRef = useRef(null);    // { before, after, dump, ids } — see offerUndo
  const drag = useRef(null);       // live drag: pointer, target, rAF; no React renders per move
  const dragFns = useRef({});      // current-render drag handlers (reassigned every render)
  const dragListeners = useRef(null); // stable wrappers, so add/removeEventListener match
  const ghostRef = useRef(null);
  const safeProbeRef = useRef(null);
  const latest = useRef(null);     // newest state, source of truth for writes AND mutations
  const saveTimer = useRef(null);  // debounce handle
  const busy = useRef(false);      // a write is in flight
  const dirty = useRef(false);     // state changed while writing
  const clickTimer = useRef(null); // single-vs-double click disambiguation
  const dumpRef = useRef(dump);    // live PASTE DUMP text (a sort in flight compares against it)
  const lastPointer = useRef("");  // pointerType of the latest pointerdown on an item's text
  const menuOpened = useRef({ id: null, t: 0 }); // when a touch tap last opened a menu

  const cur = () => latest.current;
  const labelFor = (key) => {
    const st = latest.current || data;
    return (st && has(st.labels, key) && st.labels[key]) || metaLabel(key);
  };

  // ---------- load ----------
  // Only the adapter's explicit "key not found" seeds. A parse failure stashes
  // the raw string and renders an error — it never overwrites (and so never
  // pushes a fresh seed over the gist).
  useEffect(() => {
    (async () => {
      let res;
      try {
        res = await window.storage.get(STORE_KEY);
      } catch (e) {
        const s = applySeed(seed());
        latest.current = s;
        setData(s);
        scheduleSave();
        return;
      }
      try {
        const migrated = migrate(JSON.parse(res.value));
        latest.current = migrated;
        setData(migrated);
        const canonical = serialize(migrated);
        // Persist the canonical shape WITHOUT touching the watermark — nothing was
        // edited, and a fresh timestamp could outrank real edits on another device.
        if (canonical !== res.value) window.storage.set(STORE_KEY, canonical, { touch: false }).catch((e) => console.error("canonical rewrite", e));
      } catch (e) {
        console.error("load failed", e);
        try { localStorage.setItem(CORRUPT_KEY, String(res.value)); } catch (e2) { /* quota — nothing else to do */ }
        setLoadError(String((e && e.message) || e));
      }
    })();
  }, []);

  // ---------- save ----------
  // Writes are debounced + serialized: rapid taps coalesce into ONE storage.set.
  // Failed writes retry with backoff; nothing is dropped. serialize() is the
  // only producer of the persisted string.
  const flush = async () => {
    if (busy.current) { dirty.current = true; return; }
    busy.current = true;
    dirty.current = false;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await window.storage.set(STORE_KEY, serialize(latest.current));
        ok = true;
      } catch (e) {
        console.error("save attempt", attempt + 1, "failed", e);
        setSaveState("error"); // surface immediately; retries continue
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    busy.current = false;
    if (dirty.current) { flush(); return; } // state changed mid-write → write newest
    if (ok) {
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 1200);
    }
  };

  const scheduleSave = () => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 400);
  };

  const persist = (next) => {
    // Any new edit retires the pending undo: undo only ever rolls back the very last action.
    if (undoRef.current) { undoRef.current = null; setToastUndo(false); }
    setData(next);
    latest.current = next;
    scheduleSave();
  };

  // Cosmetic state updates (e.g. clearing flash highlights) — keeps latest.current
  // and rendered data in LOCKSTEP without scheduling a write.
  const setLocal = (updater) => {
    const st = latest.current;
    if (!st) return;
    const next = updater(st);
    if (!next || next === st) return;
    latest.current = next;
    setData(next);
  };

  const flash = (msg, undoable) => {
    if (!undoable) undoRef.current = null; // a toast replaced by another can't be undone any more
    setToast(msg);
    setToastUndo(!!undoable);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => { setToast(""); setToastUndo(false); undoRef.current = null; }, undoable ? 6000 : 2600);
  };

  const unflashAll = (delay) => {
    setTimeout(() => {
      setLocal((st) => ({ ...st, items: Object.fromEntries(Object.entries(st.items).map(([k, a]) => [k, a.map((x) => (x.fresh ? { ...x, fresh: false } : x))])) }));
    }, delay);
  };

  // ---------- undo (delete, clear done, move, Sort It) ----------
  // Call right after the action's persist with the state from just before it.
  // The snapshot is only restored while the persisted form is still exactly
  // what the action produced, so undo can never roll back a later edit.
  // `dump` = text a sort consumed; undo puts it back in the PASTE DUMP box.
  // `ids` = items to highlight on undo even if they stay in the same list (reorders).
  const offerUndo = (before, msg, dump, ids) => {
    const after = cur();
    if (!before || after === before) return;
    undoRef.current = { before, after: serialize(after), dump, ids };
    flash(msg, true);
  };

  const undo = () => {
    const u = undoRef.current;
    if (!u) return;
    if (serialize(cur()) !== u.after) { flash("can't undo — something changed since"); return; }
    // Flash whatever comes back or returns to its old place; clear stale flashes.
    const now = new Map();
    for (const [k, arr] of Object.entries(cur().items)) for (const it of arr) now.set(it.id, k + "/" + (it.sub || ""));
    const items = Object.fromEntries(Object.entries(u.before.items).map(([k, arr]) => [k, arr.map((it) => {
      const back = now.get(it.id) !== k + "/" + (it.sub || "") || (u.ids && u.ids.includes(it.id));
      return back ? { ...it, fresh: true } : it.fresh ? { ...it, fresh: false } : it;
    })]));
    persist({ ...u.before, items }); // a normal edit: stamped and synced like any other
    if (u.dump) { const left = dumpRef.current; changeDump(left.trim() ? u.dump.replace(/\s+$/, "") + "\n" + left : u.dump); }
    flash("undone");
    unflashAll(1500);
  };
  const shortText = (t) => (t.length > 40 ? t.slice(0, 39) + "…" : t);

  // ---------- item ops (all read cur(), never stale closures) ----------
  const toggle = (secKey, id) => {
    const st = cur();
    persist({ ...st, items: { ...st.items, [secKey]: st.items[secKey].map((it) => (it.id === id ? { ...it, done: !it.done } : it)) } });
  };

  const remove = (secKey, id) => {
    const st = cur();
    const it = (st.items[secKey] || []).find((x) => x.id === id);
    setOpenItem(null);
    persist({ ...st, items: { ...st.items, [secKey]: st.items[secKey].filter((it) => it.id !== id) } });
    if (it) offerUndo(st, `Deleted “${shortText(it.text)}”`);
  };

  const unflash = (secKey, delay) => {
    setTimeout(() => {
      setLocal((st) => (st.items[secKey] ? { ...st, items: { ...st.items, [secKey]: st.items[secKey].map((it) => (it.fresh ? { ...it, fresh: false } : it)) } } : null));
    }, delay);
  };

  // target = "secKey/subKey" ("secKey/" = ungrouped). Same section + same sub → no-op.
  const move = (fromSec, id, target) => {
    const slash = target.indexOf("/");
    const toSec = slash < 0 ? target : target.slice(0, slash);
    const toSub = slash < 0 ? "" : target.slice(slash + 1);
    const st = cur();
    const item = (st.items[fromSec] || []).find((it) => it.id === id);
    if (!item || !st.items[toSec]) return;
    if (fromSec === toSec && (item.sub || "") === toSub) return;
    setOpenItem(null);
    const { sub: _s, ...rest } = item;
    const moved = { ...rest, fresh: true };
    if (toSub) moved.sub = toSub;
    const without = st.items[fromSec].filter((it) => it.id !== id);
    const items = { ...st.items, [fromSec]: without };
    items[toSec] = [moved, ...(fromSec === toSec ? without : st.items[toSec])];
    persist({ ...st, items });
    unflash(toSec, 1500);
    const subName = toSub && ((st.sections.find((s) => s.key === toSec) || { subs: [] }).subs.find((x) => x.key === toSub) || {}).name;
    offerUndo(st, `Moved to ${labelFor(toSec)}${subName ? " › " + subName : ""}`);
  };

  // ---------- quick add (per section or subsection) ----------
  // Enter commits and keeps the form open for rapid consecutive entry;
  // tapping away commits and closes; Esc discards; empty text creates nothing.
  const openNewItem = (sec, sub) => { addingRef.current = { sec, sub }; setAddingItem({ sec, sub }); setNewItem({ text: "", url: "" }); };
  const closeNewItem = () => { addingRef.current = null; setAddingItem(null); setNewItem({ text: "", url: "" }); };

  const commitNewItem = (keepOpen) => {
    const form = addingRef.current;
    if (!form) return; // already closed (Esc / committed) — a stale blur must not add again
    const { sec: secKey, sub } = form;
    const text = newItem.text.trim();
    const url = newItem.url.trim();
    if (!text) { if (!keepOpen) closeNewItem(); return; }
    const st = cur();
    if (!st.items[secKey]) { closeNewItem(); return; } // section deleted mid-entry
    const secEntry = st.sections.find((s) => s.key === secKey);
    const item = { id: uid(), text, done: false, fresh: true };
    if (url) item.url = url;
    if (sub && secEntry && secEntry.subs.some((x) => x.key === sub)) item.sub = sub;
    persist({ ...st, items: { ...st.items, [secKey]: [item, ...st.items[secKey]] } });
    setNewItem({ text: "", url: "" });
    if (!keepOpen) closeNewItem();
    else setTimeout(() => { if (addItemInputRef.current) addItemInputRef.current.focus(); }, 0);
    unflash(secKey, 1800);
  };

  const doneCount = data ? Object.values(data.items).flat().filter((it) => it.done).length : 0;

  const clearDone = () => {
    const st = cur();
    const n = Object.values(st.items).flat().filter((it) => it.done).length;
    if (!n) return;
    persist({ ...st, items: Object.fromEntries(Object.entries(st.items).map(([k, arr]) => [k, arr.filter((it) => !it.done)])) });
    offerUndo(st, `Cleared ${n} — brick by brick 🧱`);
  };

  // ---------- collapse ----------
  // Bodies never unmount (smooth animation), so transient state inside a
  // collapsing section must be cleared by hand.
  // Collapsing is "tapping away": open forms inside the collapsing scope are
  // COMMITTED (never discarded). Scope = the section, or just one subsection.
  const clearTransient = (secKey, subKey) => {
    const st = cur();
    const inScope = (sec, sub) => sec === secKey && (subKey == null || (sub || null) === subKey);
    const e = editingRef.current;
    if (e && e.sec === secKey) {
      const it = (st.items[secKey] || []).find((i) => i.id === e.id);
      if (inScope(secKey, it && it.sub)) commitItemEdit();
    }
    const a = addingRef.current;
    if (a && inScope(a.sec, a.sub)) commitNewItem(false);
    const r = editingSubRef.current;
    if (r && r.sec === secKey && (subKey == null || r.key === subKey)) commitSubRename();
    if (openItem) {
      const it = (st.items[secKey] || []).find((i) => i.id === openItem);
      if (it && inScope(secKey, it.sub)) setOpenItem(null);
    }
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
  };

  const toggleCollapse = (key) => {
    const collapsing = !cur().collapsed[key];
    if (collapsing) clearTransient(key, null);
    const st = cur(); // AFTER the commits above
    const collapsed = { ...st.collapsed };
    if (collapsing) collapsed[key] = true; else delete collapsed[key];
    persist({ ...st, collapsed });
  };

  const toggleSub = (secKey, subKey) => {
    const sec0 = cur().sections.find((s) => s.key === secKey);
    const sub0 = sec0 && sec0.subs.find((x) => x.key === subKey);
    if (!sub0) return;
    if (!sub0.collapsed) clearTransient(secKey, subKey);
    const st = cur(); // AFTER the commits above
    persist({
      ...st,
      sections: st.sections.map((s) => (s.key !== secKey ? s : {
        ...s,
        subs: s.subs.map((x) => (x.key !== subKey ? x : (x.collapsed ? { key: x.key, name: x.name } : { ...x, collapsed: true }))),
      })),
    });
  };

  // ---------- subsections ----------
  const openNewSub = (secKey) => { addingSubRef.current = secKey; setAddingSub(secKey); setNewSubName(""); };
  const closeNewSub = () => { addingSubRef.current = null; setAddingSub(null); setNewSubName(""); };

  const commitNewSub = () => {
    const secKey = addingSubRef.current;
    if (!secKey) return; // closed already (Esc) — a stale blur must not create it
    const name = newSubName.trim().slice(0, 80);
    closeNewSub();
    if (!name) return;
    const st = cur();
    if (!st.sections.some((s) => s.key === secKey)) return;
    persist({ ...st, sections: st.sections.map((s) => (s.key !== secKey ? s : { ...s, subs: [...s.subs, { key: "u" + uid(), name }] })) });
  };

  const startSubRename = (sec, key, value) => { editingSubRef.current = { sec, key }; setEditingSub({ sec, key, value }); };
  const cancelSubRename = () => { editingSubRef.current = null; setEditingSub(null); };
  const commitSubRename = () => {
    if (!editingSubRef.current || !editingSub) return;
    const { sec: secKey, key, value } = editingSub;
    editingSubRef.current = null;
    setEditingSub(null);
    const name = value.trim().slice(0, 80);
    if (!name) return; // empty reverts
    const st = cur();
    const sec = st.sections.find((s) => s.key === secKey);
    const sub = sec && sec.subs.find((x) => x.key === key);
    if (!sub || sub.name === name) return;
    persist({ ...st, sections: st.sections.map((s) => (s.key !== secKey ? s : { ...s, subs: s.subs.map((x) => (x.key === key ? { ...x, name } : x)) })) });
  };

  // Items fall back to ungrouped — nothing is lost.
  const deleteSub = (secKey, subKey) => {
    const st = cur();
    setPendingDeleteSub(null);
    if (addingItem && addingItem.sec === secKey && addingItem.sub === subKey) closeNewItem();
    if (editingSubRef.current && editingSubRef.current.sec === secKey && editingSubRef.current.key === subKey) cancelSubRename();
    persist({
      ...st,
      sections: st.sections.map((s) => (s.key !== secKey ? s : { ...s, subs: s.subs.filter((x) => x.key !== subKey) })),
      items: { ...st.items, [secKey]: (st.items[secKey] || []).map((it) => (it.sub === subKey ? (({ sub, ...rest }) => rest)(it) : it)) },
    });
  };

  const requestDeleteSub = (secKey, subKey) => {
    const st = cur();
    const n = (st.items[secKey] || []).filter((it) => it.sub === subKey).length;
    if (n === 0) deleteSub(secKey, subKey);
    else setPendingDeleteSub({ sec: secKey, key: subKey });
  };

  // ---------- category rename ----------
  const startCatEdit = (key, value) => { editingCatRef.current = key; setEditingCat({ key, value }); };
  const cancelCatEdit = () => { editingCatRef.current = null; setEditingCat(null); };
  const commitCatEdit = () => {
    if (!editingCatRef.current || !editingCat) return;
    const { key, value } = editingCat;
    cancelCatEdit();
    const name = value.trim().slice(0, 80);
    if (!name) return; // empty reverts to previous value
    const st = cur();
    if (name === labelFor(key)) return;
    persist({ ...st, labels: { ...st.labels, [key]: name } });
  };

  // ---------- section management ----------
  const warnIfDuplicateGlyph = (glyph, st, exceptKey) => {
    const clash = st.sections.find((s) => s.key !== exceptKey && s.glyph === glyph);
    if (clash) flash(`heads up — ${glyph} is already used by ${labelFor(clash.key)}`);
  };

  const startGlyphEdit = (key, value) => { editingGlyphRef.current = key; setEditingGlyph({ key, value }); };
  const cancelGlyphEdit = () => { editingGlyphRef.current = null; setEditingGlyph(null); };
  const commitGlyphEdit = () => {
    if (!editingGlyphRef.current || !editingGlyph) return;
    const { key, value } = editingGlyph;
    cancelGlyphEdit();
    const g = firstGrapheme(value.trim());
    if (!g) return; // empty reverts
    const st = cur();
    const entry = st.sections.find((s) => s.key === key);
    if (!entry || entry.glyph === g) return; // nothing changed → no write
    warnIfDuplicateGlyph(g, st, key);
    persist({ ...st, sections: st.sections.map((s) => (s.key === key ? { ...s, glyph: g } : s)) });
  };

  const doDelete = (key) => {
    const st = cur();
    if ((st.items[key] || []).length > 0) return; // guarded: done-but-uncleared counts as items
    const { [key]: _i, ...items } = st.items;
    const { [key]: _l, ...labels } = st.labels;
    const { [key]: _c, ...collapsed } = st.collapsed;
    setPendingDelete(null);
    setOpenItem(null);
    if (editingRef.current && editingRef.current.sec === key) cancelItemEdit();
    if (editingCatRef.current === key) cancelCatEdit();
    if (addingRef.current && addingRef.current.sec === key) closeNewItem();
    if (addingSubRef.current === key) closeNewSub();
    persist({ ...st, sections: st.sections.filter((s) => s.key !== key), items, labels, collapsed });
  };

  const addSection = () => {
    const g = firstGrapheme(newSec.glyph.trim());
    const n = newSec.name.trim().slice(0, 80);
    if (!g || !n) return;
    const st = cur();
    if (st.sections.length >= MAX_SECTIONS) return;
    warnIfDuplicateGlyph(g, st, null);
    const key = "s" + uid();
    persist({
      ...st,
      sections: [...st.sections, { key, glyph: g, subs: [] }],
      items: { ...st.items, [key]: [] },
      labels: { ...st.labels, [key]: n },
      // collapsed left unset → defaults open
    });
    setNewSec({ glyph: "", name: "" });
    setAdding(false);
  };

  // Reorder = permute the sections array. Everything else is keyed by key.
  const moveSection = (key, dir) => {
    const st = cur();
    const i = st.sections.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= st.sections.length) return;
    const arr = [...st.sections];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    persist({ ...st, sections: arr });
  };

  // ---------- item edit ----------
  const startEdit = (secKey, it) => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    setOpenItem((prev) => (prev === it.id ? prev : null)); // don't leave another item's menu hanging open
    editingRef.current = { sec: secKey, id: it.id };
    setEditing({ sec: secKey, id: it.id, text: it.text, url: it.url || "", next: it.next || "" });
  };

  const commitItemEdit = () => {
    if (!editingRef.current || !editing) return; // closed already — a stale blur is a no-op
    const { sec, id } = editing;
    const st = cur();
    const item = st.items[sec] && st.items[sec].find((i) => i.id === id);
    editingRef.current = null;
    setEditing(null);
    if (!item) return;
    const name = editing.text.trim() || item.text; // empty name reverts
    const url = editing.url.trim();                 // empty link clears the URL
    const next = editing.next.trim();               // empty next-step clears it
    if (name === item.text && url === (item.url || "") && next === (item.next || "")) return; // nothing changed → no write
    const updated = { ...item, text: name };
    if (url) updated.url = url; else delete updated.url;
    if (next) updated.next = next; else delete updated.next;
    persist({ ...st, items: { ...st.items, [sec]: st.items[sec].map((i) => (i.id === id ? updated : i)) } });
  };

  const cancelItemEdit = () => { editingRef.current = null; setEditing(null); };

  // ---------- click vs double-click on item text ----------
  // Only a mouse waits CLICK_DELAY for a possible double click. Touch, pen and
  // keyboard open the menu at once (its "edit" button covers editing); a second
  // tap inside the window is a double-tap, so it must not close the menu it just
  // opened, and the dblclick that follows still edits.
  const handleItemClick = (id) => {
    if (editing && editing.id === id) return;
    const mouse = lastPointer.current === "mouse";
    lastPointer.current = "";
    if (!mouse) {
      if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
      if (menuOpened.current.id === id && Date.now() - menuOpened.current.t < CLICK_DELAY) return;
      if (openItem === id) { setOpenItem(null); return; }
      menuOpened.current = { id, t: Date.now() };
      setOpenItem(id);
      return;
    }
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setOpenItem((prev) => (prev === id ? null : id));
    }, CLICK_DELAY);
  };

  const handleItemDblClick = (secKey, it) => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; } // suppress expand toggle
    startEdit(secKey, it);
  };

  // ---------- afh:flush — the sync layer asks us to land everything NOW ----------
  // Fired synchronously before the page hides and before any gist adoption.
  // Commit open forms, cancel the debounce, and write if anything differs.
  // localStorage.setItem inside storage.set runs before its first await, so
  // by the time the dispatch returns the write has landed.
  onFlushRef.current = () => {
    if (editingRef.current) commitItemEdit();
    if (editingCatRef.current) commitCatEdit();
    if (editingGlyphRef.current) commitGlyphEdit();
    if (editingSubRef.current) commitSubRename();
    if (addingRef.current) commitNewItem(false);
    if (addingSubRef.current) commitNewSub();
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const st = latest.current;
    if (!st) return;
    const out = serialize(st);
    let stored = null;
    try { stored = localStorage.getItem(STORE_KEY); } catch (e) { /* fall through to write */ }
    if (stored !== null && out === stored) { setSaveState((s) => (s === "saving" ? "" : s)); return; }
    // Write directly (the adapter's setItem is synchronous before its first await)
    // instead of going through flush()'s busy gate, which could defer the write.
    window.storage.set(STORE_KEY, out).then(() => {
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 1200);
    }).catch((e) => { console.error("flush write failed", e); setSaveState("error"); });
  };
  useEffect(() => {
    const onFlush = () => onFlushRef.current && onFlushRef.current();
    window.addEventListener("afh:flush", onFlush);
    return () => window.removeEventListener("afh:flush", onFlush);
  }, []);

  // ---------- Arrange mode: drag ≡ to reorder or file items ----------
  // Entering lands every open form (same guarded commits as afh:flush) and
  // closes menus; nothing about the mode itself is persisted.
  const startArrange = () => {
    if (editingRef.current) commitItemEdit();
    if (editingCatRef.current) commitCatEdit();
    if (editingGlyphRef.current) commitGlyphEdit();
    if (editingSubRef.current) commitSubRename();
    if (addingRef.current) commitNewItem(false);
    if (addingSubRef.current) commitNewSub();
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    setOpenItem(null);
    setPendingDelete(null);
    setPendingDeleteSub(null);
    setArranging(true);
    flash("drag ≡ to move · drop on a header to file it there");
  };
  const stopArrange = () => { dragFns.current.cancel(); setArranging(false); };

  // Drag engine. The handle has touch-action:none plus native non-passive
  // touch listeners (attachHandle), takes pointer capture, and from then on
  // only the DOM is touched per move: ghost transform, target outline, scroll.
  // React state changes only at drag start (dim the row) and end.
  const attachHandle = useCallback((el) => {
    if (!el) return undefined;
    el.addEventListener("touchstart", preventTouch, { passive: false });
    el.addEventListener("touchmove", preventTouch, { passive: false });
    return () => {
      el.removeEventListener("touchstart", preventTouch);
      el.removeEventListener("touchmove", preventTouch);
    };
  }, []);

  if (!dragListeners.current) {
    const call = (name) => (e) => dragFns.current[name] && dragFns.current[name](e);
    dragListeners.current = {
      move: call("move"), up: call("up"), cancel: call("cancel"), lost: call("lost"),
      scroll: call("scroll"), vis: call("vis"), block: (e) => e.preventDefault(),
    };
  }

  const markTarget = (d, el, how) => {
    if (d.markEl && (d.markEl !== el || d.markHow !== how)) { d.markEl.style.boxShadow = ""; d.markEl.style.outline = ""; d.markEl.style.outlineOffset = ""; }
    d.markEl = el; d.markHow = how;
    if (!el) return;
    if (how === "before" || how === "after") el.style.boxShadow = `inset 0 ${how === "after" ? -2 : 2}px 0 ${C.blue}`;
    else { el.style.outline = `2px solid ${C.blue}`; el.style.outlineOffset = "-2px"; }
  };

  // What is under the finger? Probe the column's centre line so overlays (ghost,
  // toast, ⇄, the done pill) and the side the finger is on don't matter; inert
  // collapsed content is never hit. Over a gap, the last target is kept.
  const hitTest = (d) => {
    const col = document.querySelector("[data-arrange-col]");
    if (!col) return;
    const r = col.getBoundingClientRect();
    let node = null;
    for (const el of document.elementsFromPoint(r.left + r.width / 2, d.y)) {
      const n = el.closest && el.closest("[data-drop]");
      if (n) { node = n; break; }
    }
    if (!node) return;
    const kind = node.getAttribute("data-drop");
    const toSec = node.getAttribute("data-sec");
    const toSub = node.getAttribute("data-sub") || "";
    if (kind === "item") {
      const id = node.getAttribute("data-id");
      if (id === d.id) { d.target = null; markTarget(d, null); return; } // over itself: dropping does nothing
      const b = node.getBoundingClientRect();
      const side = d.y > b.top + b.height / 2 ? "after" : "before";
      d.target = { toSec, toSub, anchor: { id, side } };
      markTarget(d, node, side);
    } else {
      d.target = { toSec, toSub: kind === "sec" ? "" : toSub, anchor: kind === "end" ? "end" : "top" };
      markTarget(d, node, "box");
    }
  };

  const frame = (t) => {
    const d = drag.current;
    if (!d) return;
    const dt = d.lastT ? Math.min(50, t - d.lastT) : 16;
    d.lastT = t;
    const g = ghostRef.current;
    if (g) g.style.transform = d.touch ? `translate(${d.x - g.offsetWidth / 2}px, ${d.y - 64}px)` : `translate(${d.x + 14}px, ${d.y + 12}px)`;
    // Autoscroll near the edges, inside the safe areas; speed scales with depth.
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const top = d.safeTop + AUTOSCROLL_ZONE, bottom = vh - d.safeBottom - AUTOSCROLL_ZONE;
    const depth = d.y < top ? -(top - d.y) / AUTOSCROLL_ZONE : d.y > bottom ? (d.y - bottom) / AUTOSCROLL_ZONE : 0;
    if (depth) {
      const k = Math.max(-1, Math.min(1, depth));
      const before = window.scrollY;
      window.scrollBy(0, Math.sign(k) * (0.15 + 1.1 * k * k) * dt);
      if (window.scrollY !== before) hitTest(d);
    }
    d.raf = requestAnimationFrame(frame);
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d) return null;
    drag.current = null;
    const L = dragListeners.current;
    d.el.removeEventListener("pointermove", L.move);
    d.el.removeEventListener("pointerup", L.up);
    d.el.removeEventListener("pointercancel", L.cancel);
    d.el.removeEventListener("lostpointercapture", L.lost);
    window.removeEventListener("scroll", L.scroll);
    window.removeEventListener("blur", L.cancel);
    document.removeEventListener("visibilitychange", L.vis);
    document.removeEventListener("selectstart", L.block);
    document.removeEventListener("dragstart", L.block);
    try { if (d.el.hasPointerCapture && d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId); } catch (e) { /* already released */ }
    if (d.raf) cancelAnimationFrame(d.raf);
    markTarget(d, null);
    if (ghostRef.current) ghostRef.current.style.display = "none";
    if (d.moved) setDragId(null);
    return d;
  };

  const beginDrag = (e, secKey, it) => {
    if (!arranging || drag.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault(); // no text selection / focus change from the mouse
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture is best effort; listeners still follow the pointer on touch */ }
    let safeTop = 0, safeBottom = 0;
    if (safeProbeRef.current) {
      const cs = getComputedStyle(safeProbeRef.current);
      safeTop = parseFloat(cs.paddingTop) || 0;
      safeBottom = parseFloat(cs.paddingBottom) || 0;
    }
    drag.current = { id: it.id, sec: secKey, text: it.text, el, pointerId: e.pointerId, touch: e.pointerType !== "mouse",
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, target: null, markEl: null, markHow: "", raf: 0, lastT: 0, safeTop, safeBottom };
    const L = dragListeners.current;
    el.addEventListener("pointermove", L.move);
    el.addEventListener("pointerup", L.up);
    el.addEventListener("pointercancel", L.cancel);
    el.addEventListener("lostpointercapture", L.lost);
    window.addEventListener("scroll", L.scroll, { passive: true });
    window.addEventListener("blur", L.cancel);
    document.addEventListener("visibilitychange", L.vis);
    document.addEventListener("selectstart", L.block);
    document.addEventListener("dragstart", L.block);
  };

  // Reassigned every render so they always see current state and helpers.
  dragFns.current = {
    move: (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.moved) {
        if (Math.hypot(d.x - d.x0, d.y - d.y0) < 6) return; // a tap on the handle does nothing
        d.moved = true;
        const sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
        const g = ghostRef.current;
        if (g) { g.textContent = d.text; g.style.display = "block"; }
        setDragId(d.id);
        d.raf = requestAnimationFrame(frame);
      }
      hitTest(d);
    },
    up: (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const target = d.moved ? d.target : null;
      endDrag();
      if (target) dropItem(d, target);
    },
    cancel: () => { endDrag(); },
    lost: () => { endDrag(); }, // capture lost before pointerup: abort, never guess a drop
    scroll: () => { const d = drag.current; if (d && d.moved) hitTest(d); },
    vis: () => { if (document.visibilityState === "hidden") endDrag(); },
  };

  const dropItem = (d, target) => {
    const st = cur();
    const next = placeItem(st, { id: d.id, fromSec: d.sec, toSec: target.toSec, toSub: target.toSub, anchor: target.anchor });
    if (next === st) return; // same visible order (or stale target): nothing to save or sync
    const items = { ...next.items, [target.toSec]: next.items[target.toSec].map((it) => (it.id === d.id ? { ...it, fresh: true } : it)) };
    persist({ ...next, items });
    unflash(target.toSec, 1500);
    const fromSec = st.sections.find((s) => s.key === d.sec);
    const orig = (st.items[d.sec] || []).find((it) => it.id === d.id);
    const sameList = d.sec === target.toSec && orig && groupOf(orig, new Set(fromSec.subs.map((x) => x.key))) === target.toSub;
    const toEntry = next.sections.find((s) => s.key === target.toSec);
    const subName = target.toSub && ((toEntry.subs.find((x) => x.key === target.toSub)) || {}).name;
    offerUndo(st, sameList ? "Reordered" : `Moved to ${labelFor(target.toSec)}${subName ? " › " + subName : ""}`, undefined, [d.id]);
  };

  // Esc: abort an active drag, else leave Arrange mode (not while typing in a field).
  useEffect(() => {
    if (!arranging) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (drag.current) endDrag(); else setArranging(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arranging]);

  // ---------- PASTE DUMP box (mirrored to the local-only draft key) ----------
  const changeDump = (v) => {
    dumpRef.current = v;
    setDump(v);
    try { if (v) localStorage.setItem(DRAFT_KEY, v); else localStorage.removeItem(DRAFT_KEY); }
    catch (e) { /* quota / storage disabled — the box still works, it just won't survive a relaunch */ }
  };
  // A sort consumed `sent`. Clear only that: text typed into the box while
  // "Sorting…" ran stays put instead of being wiped with the sorted lines.
  const consumeDump = (sent) => {
    const now = dumpRef.current;
    changeDump(now === sent ? "" : now.startsWith(sent) ? now.slice(sent.length).replace(/^\s+/, "") : now);
  };

  // ---------- AI dump sorter — consumes the LIVE section set ----------
  const sortDump = async () => {
    const sent = dumpRef.current;
    const raw = sent.trim();
    if (!raw || sorting) return;
    const stNow = cur();
    if (!stNow.sections.length) {
      flash("no sections to sort into — add one in ⚙ sections first");
      return;
    }
    setSorting(true);
    try {
      const liveSecs = stNow.sections;
      const bucketLines = liveSecs
        .map((s) => `- "${s.key}": ${JSON.stringify(labelFor(s.key))} — ${has(SORT_HINTS, s.key) ? SORT_HINTS[s.key] : "route here anything that fits this section's name"}`)
        .join("\n");
      const keyEnum = liveSecs.map((s) => s.key).join("|");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content:
                `You sort one person's raw Apple Notes brain-dump into buckets. Keep his wording, slang and emoji — light trim only. Split into discrete items (a line or a tight cluster = one item). Drop pure separators (===, ^^ alone).\n\nBuckets (use the quoted id, not the name):\n${bucketLines}\n\nReturn ONLY a JSON array, no prose, no markdown fences:\n[{"text":"...","section":"${keyEnum}"}]\nKeep each text under 140 chars.\n\nDUMP:\n${raw}`,
            },
          ],
        }),
      });
      const resp = await response.json();
      if (!response.ok || (resp && resp.type === "error")) {
        const msg = resp && resp.error && resp.error.message ? resp.error.message : `HTTP ${response.status}`;
        throw new Error(msg);
      }
      const textOut = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const clean = textOut.replace(/```json|```/g, "").trim();
      const arr = JSON.parse(clean);
      if (!Array.isArray(arr) || !arr.length) throw new Error("empty");
      const st = cur();
      const valid = new Set(st.sections.map((s) => s.key));
      const catchAll = catchAllKey(st.sections);
      const nextItems = { ...st.items };
      let n = 0;
      for (const it of arr.slice(0, 500)) {
        if (!it || !it.text) continue;
        const sec = valid.has(it.section) ? it.section : catchAll;
        nextItems[sec] = [{ id: uid(), text: String(it.text).slice(0, 2000), done: false, fresh: true }, ...nextItems[sec]];
        n++;
      }
      persist({ ...st, items: nextItems });
      consumeDump(sent);
      offerUndo(st, `Sorted ${n} item${n === 1 ? "" : "s"} ⚡`, sent);
      unflashAll(1800);
    } catch (e) {
      console.error(e);
      const reason = String(e && e.message ? e.message : e).slice(0, 90);
      // fallback: raw lines land in the catch-all so nothing is lost
      const st = cur();
      const catchAll = catchAllKey(st.sections);
      if (!catchAll) { setSorting(false); return; }
      const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l && !/^[=^\-\s]+$/.test(l));
      persist({ ...st, items: { ...st.items, [catchAll]: [...lines.map((l) => ({ id: uid(), text: l, done: false, fresh: true })), ...st.items[catchAll]] } });
      consumeDump(sent);
      offerUndo(st, `Sort failed (${reason}) — dumped into ${labelFor(catchAll)} as-is, nothing lost`, sent);
    } finally {
      setSorting(false);
    }
  };

  // ---------- render ----------
  if (loadError) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center px-6" style={{ background: C.bg, color: C.dim }}>
        <div className="font-mono text-xs leading-relaxed max-w-md">
          <div style={{ color: C.red }}>couldn't read saved data — nothing was overwritten.</div>
          <div className="mt-2">the raw copy is stashed as <span style={{ color: C.text }}>{CORRUPT_KEY}</span> in this browser. use the ⇄ panel to import a backup, or pull from the gist.</div>
          <div className="mt-2" style={{ color: C.faint }}>{loadError}</div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center" style={{ background: C.bg, color: C.dim }}>
        <div className="font-mono text-sm tracking-widest">loading the surface…</div>
      </div>
    );
  }

  const atCap = data.sections.length >= MAX_SECTIONS;
  const newSecValid = !!firstGrapheme(newSec.glyph.trim()) && !!newSec.name.trim();
  const inputStyle = { background: C.bg, color: C.text, border: `1px solid ${C.cardEdge}` };

  const renderQuickAdd = (secKey, subKey, displayLabel) => {
    // Arrange mode: same footprint as the "＋ add item" row, but it is the
    // "end of this list" drop target (so toggling the mode moves nothing).
    if (arranging) {
      return (
        <div
          data-drop="end"
          data-sec={secKey}
          data-sub={subKey || ""}
          className="w-full text-center font-mono text-xs py-2"
          style={{ color: C.faint, borderTop: `1px solid ${C.cardEdge}` }}
        >
          ↓ drop here
        </div>
      );
    }
    const isOpen = addingItem && addingItem.sec === secKey && (addingItem.sub || null) === (subKey || null);
    return isOpen ? (
      <div
        className="px-3 py-2.5"
        style={{ borderTop: `1px solid ${C.cardEdge}` }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commitNewItem(false); }}
      >
        <input
          ref={addItemInputRef}
          autoFocus
          value={newItem.text}
          onChange={(e) => setNewItem({ ...newItem, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitNewItem(true);
            else if (e.key === "Escape") closeNewItem();
          }}
          placeholder="new item — enter to add another"
          aria-label={`new item in ${displayLabel}`}
          className="w-full text-sm leading-snug outline-none rounded-md px-2 py-1"
          style={{ ...inputStyle, border: `1px solid ${C.blue}` }}
        />
        <input
          value={newItem.url}
          onChange={(e) => setNewItem({ ...newItem, url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitNewItem(true);
            else if (e.key === "Escape") closeNewItem();
          }}
          placeholder="link — optional"
          aria-label={`new item link in ${displayLabel}`}
          className="w-full mt-1.5 text-xs font-mono outline-none rounded-md px-2 py-1"
          style={{ ...inputStyle, color: C.blue }}
        />
      </div>
    ) : (
      <button
        onClick={() => openNewItem(secKey, subKey || null)}
        aria-label={`add item to ${displayLabel}`}
        className="w-full text-center font-mono text-xs py-2 focus:outline-none focus-visible:ring-2 [touch-action:manipulation]"
        style={{ color: C.blue, background: "transparent", borderTop: `1px solid ${C.cardEdge}` }}
      >
        ＋ add item
      </button>
    );
  };

  const renderItem = (sec, it, idx) => {
    const isEditing = editing && editing.id === it.id && editing.sec === sec.key;
    const href = safeHref(it.url);
    const subKeys = new Set(sec.subs.map((x) => x.key));
    const group = groupOf(it, subKeys);
    const position = `${sec.key}/${group}`;
    return (
      <div
        key={it.id}
        data-drop="item"
        data-sec={sec.key}
        data-sub={group}
        data-id={it.id}
        className="transition-colors duration-700"
        style={{
          borderTop: idx === 0 ? "none" : `1px solid ${C.cardEdge}`,
          background: it.fresh ? C.blueSoft : "transparent",
          opacity: dragId === it.id ? 0.35 : 1,
        }}
      >
        <div className="flex items-start gap-3 px-3 py-2.5">
          {arranging ? (
            // the drag handle takes the checkbox's slot and hit area, so nothing reflows
            <span
              ref={attachHandle}
              data-handle={it.id}
              aria-label={`drag ${it.text}`}
              onPointerDown={(e) => beginDrag(e, sec.key, it)}
              className="-m-2.5 p-2.5 flex-shrink-0 cursor-grab select-none [touch-action:none] [-webkit-touch-callout:none]"
              style={{ color: C.blue }}
            >
              <span className="mt-0.5 w-5 h-5 flex items-center justify-center text-base leading-none">≡</span>
            </span>
          ) : sec.key !== "note" ? (
            // 40×40 hit area around the 20×20 circle; the equal negative margin keeps the layout unchanged
            <button
              onClick={() => toggle(sec.key, it.id)}
              aria-label={it.done ? "mark not done" : "mark done"}
              className="group/cb -m-2.5 p-2.5 flex-shrink-0 focus:outline-none [touch-action:manipulation]"
            >
              <span
                className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs group-focus-visible/cb:ring-2"
                style={{
                  border: `1.5px solid ${it.done ? C.blue : C.faint}`,
                  background: it.done ? C.blue : "transparent",
                  color: "#fff",
                }}
              >
                {it.done ? "✓" : ""}
              </span>
            </button>
          ) : (
            <span className="mt-0.5 w-5 flex-shrink-0 text-center" style={{ color: C.faint }}>·</span>
          )}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commitItemEdit(); }}>
                <input
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitItemEdit();
                    else if (e.key === "Escape") cancelItemEdit();
                  }}
                  className="w-full text-sm leading-snug outline-none rounded-md px-2 py-1"
                  style={{ ...inputStyle, border: `1px solid ${C.blue}` }}
                />
                <input
                  value={editing.next}
                  onChange={(e) => setEditing({ ...editing, next: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitItemEdit();
                    else if (e.key === "Escape") cancelItemEdit();
                  }}
                  placeholder="→ next step — optional"
                  aria-label="next step"
                  className="w-full mt-1.5 text-xs outline-none rounded-md px-2 py-1"
                  style={inputStyle}
                />
                <input
                  value={editing.url}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitItemEdit();
                    else if (e.key === "Escape") cancelItemEdit();
                  }}
                  placeholder="link — leave empty for none"
                  className="w-full mt-1.5 text-xs font-mono outline-none rounded-md px-2 py-1"
                  style={{ ...inputStyle, color: C.blue }}
                />
              </div>
            ) : (
              <>
                {arranging ? (
                  <span
                    className="inline-block text-left w-full text-sm leading-snug"
                    style={{ color: it.done ? C.faint : C.text, textDecoration: it.done ? "line-through" : "none" }}
                  >
                    {it.text}
                  </span>
                ) : (
                  <button
                    onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
                    onClick={() => handleItemClick(it.id)}
                    onDoubleClick={() => handleItemDblClick(sec.key, it)}
                    className="text-left w-full text-sm leading-snug focus:outline-none"
                    style={{
                      color: it.done ? C.faint : C.text,
                      textDecoration: it.done ? "line-through" : "none",
                    }}
                  >
                    {it.text}
                  </button>
                )}
                {it.next && (
                  <div className="text-xs mt-0.5" style={{ color: C.dim }}>→ {it.next}</div>
                )}
                {it.url && (href ? (
                  <a href={href} target="_blank" rel="noreferrer" draggable={false} className={`inline-block mt-0.5 text-xs font-mono ${arranging ? "pointer-events-none" : ""}`} style={{ color: C.blue }}>
                    link ↗
                  </a>
                ) : (
                  <span className="inline-block mt-0.5 text-xs font-mono" style={{ color: C.faint }} title={it.url}>link blocked (unsafe scheme)</span>
                ))}
                {openItem === it.id && (
                  <div className="flex items-center gap-2 mt-2 mb-1 flex-wrap">
                    <select
                      value={position}
                      onChange={(e) => move(sec.key, it.id, e.target.value)}
                      aria-label="move to"
                      className={`text-xs font-mono rounded-md px-2 py-1 focus:outline-none max-w-full ${TOUCH_TALL}`}
                      style={inputStyle}
                    >
                      {data.sections.map((s) => (
                        <optgroup key={s.key} label={`${s.glyph} ${labelFor(s.key).toLowerCase()}`}>
                          <option value={`${s.key}/`}>{s.glyph} {labelFor(s.key).toLowerCase()}</option>
                          {s.subs.map((x) => (
                            <option key={x.key} value={`${s.key}/${x.key}`}>{"  › "}{x.name.toLowerCase()}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      onClick={() => startEdit(sec.key, it)}
                      className={`text-xs font-mono px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2 ${TOUCH_TALL}`}
                      style={{ color: C.blue, border: `1px solid ${C.cardEdge}` }}
                    >
                      edit
                    </button>
                    <button
                      onClick={() => remove(sec.key, it.id)}
                      className={`text-xs font-mono px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2 ${TOUCH_TALL}`}
                      style={{ color: C.red, border: `1px solid ${C.cardEdge}` }}
                    >
                      delete
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen min-h-[100dvh] pb-24" style={{ background: C.bg, color: C.text, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" }}>
      <div className="max-w-xl mx-auto px-4 pt-6" data-arrange-col="">

        {/* header */}
        <div className="flex items-end justify-between mb-1">
          <h1 className="text-2xl font-extrabold tracking-tight">
            ACT FROM HERE<span style={{ color: C.blue }}>.</span>
          </h1>
          <button
            onClick={() => { if (saveState === "error") { setSaveState("saving"); flush(); } }}
            className="font-mono text-xs focus:outline-none"
            style={{
              color: saveState === "error" ? C.red : C.faint,
              cursor: saveState === "error" ? "pointer" : "default",
              background: "transparent",
            }}
          >
            {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved ✓" : saveState === "error" ? "save failed — tap to retry" : ""}
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: C.dim }}>
          the small surface you actually trust
        </p>

        {/* dump box — the signature */}
        <div className="rounded-2xl p-3 mb-3" style={{ background: C.card, border: `1px solid ${C.cardEdge}`, borderTop: `2px dashed ${C.faint}` }}>
          <div className="font-mono text-xs mb-2 tracking-widest" style={{ color: C.dim }}>
            📥 PASTE DUMP <span style={{ color: C.faint }}>· straight from Apple Notes · I'll sort it</span>
          </div>
          <textarea
            value={dump}
            onChange={(e) => changeDump(e.target.value)}
            placeholder={"‣ call about the thing\n» buy the other thing\nsome mantra that hit 🔦\n…"}
            rows={4}
            className="w-full rounded-lg p-3 text-sm font-mono resize-y outline-none"
            style={{ ...inputStyle, caretColor: C.blue }}
          />
          <div className="flex justify-between items-center mt-2">
            <span className="font-mono text-xs" style={{ color: C.faint }}>
              {dump.trim() ? `${dump.trim().split("\n").filter(Boolean).length} lines` : "empty"}
            </span>
            <button
              onClick={sortDump}
              disabled={!dump.trim() || sorting}
              className="px-4 py-2 rounded-full text-sm font-bold transition-opacity focus:outline-none focus-visible:ring-2"
              style={{
                background: !dump.trim() || sorting ? C.blueSoft : C.blue,
                color: !dump.trim() || sorting ? C.dim : "#fff",
                opacity: sorting ? 0.8 : 1,
              }}
            >
              {sorting ? "Sorting…" : "Sort it →"}
            </button>
          </div>
        </div>

        {/* arrange toggle (left) + clear done (right) */}
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={() => (arranging ? stopArrange() : startArrange())}
            aria-pressed={arranging}
            className="font-mono text-xs px-3 py-1.5 rounded-full focus:outline-none focus-visible:ring-2 [touch-action:manipulation]"
            style={{
              border: `1px solid ${arranging ? C.blue : C.cardEdge}`,
              color: arranging ? "#fff" : C.dim,
              background: arranging ? C.blue : "transparent",
            }}
          >
            {arranging ? "✓ done arranging" : "↕ arrange"}
          </button>
          <button
            onClick={clearDone}
            disabled={!doneCount}
            className="font-mono text-xs px-3 py-1.5 rounded-full focus:outline-none focus-visible:ring-2"
            style={{
              border: `1px solid ${doneCount ? C.red : C.cardEdge}`,
              color: doneCount ? C.red : C.faint,
              background: "transparent",
            }}
          >
            🛑 clear done ({doneCount})
          </button>
        </div>

        {/* sections (no text selection or callouts while arranging; a drag starts only on ≡) */}
        <div className={arranging ? "select-none [-webkit-touch-callout:none]" : undefined}>
        {data.sections.map((sec) => {
          const items = data.items[sec.key] || [];
          const open = items.filter((i) => !i.done).length;
          const isCollapsed = !!data.collapsed[sec.key];
          const displayLabel = labelFor(sec.key);
          const subKeys = new Set(sec.subs.map((x) => x.key));
          const ungrouped = items.filter((i) => groupOf(i, subKeys) === "");
          return (
            <div key={sec.key} className="mb-6 group">
              <div className="flex items-baseline justify-between mb-2 px-1 gap-2" data-drop="sec" data-sec={sec.key}>
                <h2 className="text-sm font-extrabold tracking-widest flex items-baseline gap-1.5 min-w-0" style={{ color: C.text }}>
                  <button
                    onClick={() => toggleCollapse(sec.key)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "expand" : "collapse"} ${displayLabel}`}
                    className="group/gl -my-2.5 py-2.5 -ml-3 pl-3 -mr-1.5 pr-1.5 focus:outline-none [touch-action:manipulation]"
                    style={{ color: C.blue, opacity: isCollapsed ? 0.5 : 1, background: "transparent" }}
                  >
                    {/* the padding/negative margin above grows the hit area without moving anything; the ring stays on the glyph */}
                    <span className="group-focus-visible/gl:ring-2">{sec.glyph}</span>
                  </button>
                  {editingCat && editingCat.key === sec.key ? (
                    <input
                      autoFocus
                      value={editingCat.value}
                      onChange={(e) => setEditingCat({ key: sec.key, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCatEdit();
                        else if (e.key === "Escape") cancelCatEdit();
                      }}
                      onBlur={commitCatEdit}
                      className="text-sm font-extrabold tracking-widest outline-none"
                      style={{ background: "transparent", color: C.text, borderBottom: `1px solid ${C.blue}`, width: "14rem" }}
                    />
                  ) : (
                    <span className="truncate" onDoubleClick={() => { if (!arranging) startCatEdit(sec.key, displayLabel); }}>{displayLabel}</span>
                  )}
                </h2>
                <span className="flex items-baseline gap-2 flex-shrink-0">
                  <button
                    onClick={() => { if (addingSub === sec.key) closeNewSub(); else { openNewSub(sec.key); if (isCollapsed) toggleCollapse(sec.key); } }}
                    aria-label={`add subsection to ${displayLabel}`}
                    className={`font-mono text-xs px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2 [touch-action:manipulation] ${TOUCH_CHIP} ${REVEAL_SEC} ${arranging ? "invisible" : ""}`}
                    style={{ color: C.blue, border: `1px solid ${C.cardEdge}`, background: "transparent" }}
                  >
                    ＋ subsection
                  </button>
                  <span className="font-mono text-xs" style={{ color: C.faint }}>
                    {sec.key === "note" ? `${items.length}` : `${open} open`}
                  </span>
                </span>
              </div>
              <Collapsible open={!isCollapsed}>
                <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.cardEdge}` }}>
                  {items.length === 0 && sec.subs.length === 0 && (
                    <div className="px-4 py-4 text-sm" style={{ color: C.faint }} data-drop="end" data-sec={sec.key} data-sub="">
                      empty — {metaHint(sec.key)}
                    </div>
                  )}
                  {ungrouped.map((it, idx) => renderItem(sec, it, idx))}
                  {renderQuickAdd(sec.key, null, displayLabel)}

                  {/* subsections */}
                  {sec.subs.map((sub) => {
                    const subItems = items.filter((i) => i.sub === sub.key);
                    const subOpen = subItems.filter((i) => !i.done).length;
                    const isRenaming = editingSub && editingSub.sec === sec.key && editingSub.key === sub.key;
                    const isPendingDelete = pendingDeleteSub && pendingDeleteSub.sec === sec.key && pendingDeleteSub.key === sub.key;
                    return (
                      <div key={sub.key} style={{ borderTop: `1px solid ${C.cardEdge}` }}>
                        <div
                          role="button"
                          tabIndex={0}
                          data-drop="sub"
                          data-sec={sec.key}
                          data-sub={sub.key}
                          aria-expanded={!sub.collapsed}
                          aria-label={`${sub.collapsed ? "expand" : "collapse"} ${sub.name}`}
                          className="group/sub flex items-center gap-2 px-3 py-2 min-h-[36px] cursor-pointer select-none [touch-action:manipulation] focus:outline-none focus-visible:ring-2"
                          style={{ background: "rgba(255,255,255,0.025)" }}
                          onClick={(e) => {
                            const el = e.target.closest && e.target.closest("[data-act]");
                            const act = el ? el.getAttribute("data-act") : "";
                            if (act === "rename") { startSubRename(sec.key, sub.key, sub.name); return; }
                            if (act === "delete") { requestDeleteSub(sec.key, sub.key); return; }
                            if (act === "noop") return;
                            toggleSub(sec.key, sub.key);
                          }}
                          onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleSub(sec.key, sub.key); } }}
                        >
                          <span className="font-mono text-xs w-3 flex-shrink-0" style={{ color: C.blue, opacity: sub.collapsed ? 0.5 : 1 }}>{sub.collapsed ? "▸" : "▾"}</span>
                          {isRenaming ? (
                            <input
                              data-act="noop"
                              autoFocus
                              value={editingSub.value}
                              onChange={(e) => setEditingSub({ ...editingSub, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitSubRename();
                                else if (e.key === "Escape") cancelSubRename();
                              }}
                              onBlur={commitSubRename}
                              aria-label={`rename ${sub.name}`}
                              className="flex-1 min-w-0 text-xs font-bold tracking-widest outline-none rounded-md px-2 py-1"
                              style={{ ...inputStyle, border: `1px solid ${C.blue}` }}
                            />
                          ) : (
                            <span className="flex-1 min-w-0 truncate text-xs font-bold tracking-widest" style={{ color: C.dim }}>{sub.name}</span>
                          )}
                          <span className="font-mono text-xs flex-shrink-0" style={{ color: C.faint }}>
                            {sec.key === "note" ? `${subItems.length}` : `${subOpen} open`}
                          </span>
                          {!isRenaming && (
                            <span className={`flex items-center gap-1 flex-shrink-0 ${REVEAL_SUB} ${arranging ? "invisible" : ""}`}>
                              <button data-act="rename" aria-label={`rename ${sub.name}`} className={`text-xs px-1.5 py-1 rounded-md focus:outline-none focus-visible:ring-2 ${TOUCH_ICON}`} style={{ color: C.dim, background: "transparent" }}>✎</button>
                              <button data-act="delete" aria-label={`delete ${sub.name}`} className={`text-xs px-1.5 py-1 rounded-md focus:outline-none focus-visible:ring-2 ${TOUCH_ICON}`} style={{ color: C.red, background: "transparent" }}>🗑</button>
                            </span>
                          )}
                        </div>
                        {isPendingDelete && (
                          <div className="flex items-center gap-2 px-3 pb-2 flex-wrap" style={{ background: "rgba(255,255,255,0.025)" }}>
                            <span className="font-mono text-xs" style={{ color: C.dim }}>delete "{sub.name}"? its {subItems.length} item{subItems.length === 1 ? "" : "s"} move back to {displayLabel}.</span>
                            <button onClick={() => deleteSub(sec.key, sub.key)} className="font-mono text-xs px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2" style={{ color: C.red, border: `1px solid ${C.red}`, background: "transparent" }}>yes, delete</button>
                            <button onClick={() => setPendingDeleteSub(null)} className="font-mono text-xs px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2" style={{ color: C.dim, border: `1px solid ${C.cardEdge}`, background: "transparent" }}>cancel</button>
                          </div>
                        )}
                        <Collapsible open={!sub.collapsed}>
                          {subItems.length === 0 && (
                            <div className="px-4 py-3 text-xs" style={{ color: C.faint, borderTop: `1px solid ${C.cardEdge}` }} data-drop="end" data-sec={sec.key} data-sub={sub.key}>{arranging ? "empty — drop here" : "empty — add one below"}</div>
                          )}
                          {subItems.map((it, idx) => renderItem(sec, it, idx === 0 ? 1 : idx))}
                          {renderQuickAdd(sec.key, sub.key, `${displayLabel} › ${sub.name}`)}
                        </Collapsible>
                      </div>
                    );
                  })}

                  {/* new subsection */}
                  {addingSub === sec.key && (
                    <div className="px-3 py-2.5" style={{ borderTop: `1px solid ${C.cardEdge}` }}>
                      <input
                        autoFocus
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitNewSub();
                          else if (e.key === "Escape") closeNewSub();
                        }}
                        onBlur={commitNewSub}
                        placeholder="subsection name — enter to create, esc to cancel"
                        aria-label={`new subsection in ${displayLabel}`}
                        className="w-full text-xs font-bold tracking-widest outline-none rounded-md px-2 py-1.5"
                        style={{ ...inputStyle, border: `1px solid ${C.blue}` }}
                      />
                    </div>
                  )}
                </div>
              </Collapsible>
            </div>
          );
        })}
        </div>

        {/* section manager (hidden while arranging: its new-section form has no ref mirror) */}
        {!arranging && (
        <div className="mt-2">
          <div className="flex justify-center">
            <button
              onClick={() => setManagerOpen((o) => !o)}
              aria-expanded={managerOpen}
              className="font-mono text-xs px-3 py-1.5 rounded-full focus:outline-none focus-visible:ring-2"
              style={{ border: `1px solid ${C.cardEdge}`, color: C.dim, background: "transparent" }}
            >
              ⚙ sections {managerOpen ? "▴" : "▾"}
            </button>
          </div>
          {managerOpen && (
            <div className="rounded-2xl overflow-hidden mt-3" style={{ background: C.card, border: `1px solid ${C.cardEdge}` }}>
              <div className="px-3 pt-2.5 pb-1 font-mono text-xs" style={{ color: C.faint }}>▲ ▼ set the order on the page · double-click a name up top to rename</div>
              {data.sections.map((s, idx) => {
                const count = (data.items[s.key] || []).length;
                const name = labelFor(s.key);
                const deletable = count === 0;
                const first = idx === 0;
                const last = idx === data.sections.length - 1;
                const arrow = (dir, disabled, label) => (
                  <button
                    disabled={disabled}
                    onClick={() => !disabled && moveSection(s.key, dir)}
                    aria-label={label}
                    className="flex-shrink-0 w-9 h-9 rounded-md text-sm focus:outline-none focus-visible:ring-2 [touch-action:manipulation]"
                    style={{ color: disabled ? C.faint : C.blue, border: `1px solid ${C.cardEdge}`, opacity: disabled ? 0.35 : 1, background: "transparent", cursor: disabled ? "default" : "pointer" }}
                  >
                    {dir < 0 ? "▲" : "▼"}
                  </button>
                );
                return (
                  <div key={s.key} className="px-3 py-2" style={{ borderTop: `1px solid ${C.cardEdge}` }}>
                    <div className="flex items-center gap-2">
                      {arrow(-1, first, `move ${name} up`)}
                      {arrow(1, last, `move ${name} down`)}
                      {editingGlyph && editingGlyph.key === s.key ? (
                        <input
                          autoFocus
                          value={editingGlyph.value}
                          onChange={(e) => setEditingGlyph({ key: s.key, value: firstGrapheme(e.target.value) })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitGlyphEdit();
                            else if (e.key === "Escape") cancelGlyphEdit();
                          }}
                          onBlur={commitGlyphEdit}
                          aria-label={`glyph for ${name}`}
                          className="w-9 flex-shrink-0 text-center text-sm outline-none rounded-md py-1"
                          style={{ ...inputStyle, border: `1px solid ${C.blue}` }}
                        />
                      ) : (
                        <button
                          onClick={() => startGlyphEdit(s.key, s.glyph)}
                          aria-label={`edit glyph for ${name}`}
                          className="w-9 flex-shrink-0 py-1 rounded-md text-sm focus:outline-none focus-visible:ring-2"
                          style={{ color: C.blue, border: `1px solid ${C.cardEdge}`, background: "transparent" }}
                        >
                          {s.glyph}
                        </button>
                      )}
                      <span className="flex-1 min-w-0 truncate text-sm font-bold tracking-wide" style={{ color: C.text }}>{name}</span>
                      <span className="font-mono text-xs flex-shrink-0" style={{ color: C.faint }}>
                        {count} item{count === 1 ? "" : "s"}{s.subs.length ? ` · ${s.subs.length} sub` : ""}
                      </span>
                      <button
                        disabled={!deletable}
                        onClick={() => deletable && setPendingDelete(s.key)}
                        aria-label={`delete ${name}`}
                        title={deletable ? "" : "clear it out first"}
                        className="flex-shrink-0 text-sm px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2"
                        style={{
                          color: deletable ? C.red : C.faint,
                          border: `1px solid ${deletable ? C.red : C.cardEdge}`,
                          opacity: deletable ? 1 : 0.45,
                          background: "transparent",
                          cursor: deletable ? "pointer" : "default",
                        }}
                      >
                        🗑
                      </button>
                    </div>
                    {pendingDelete === s.key && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="font-mono text-xs" style={{ color: C.dim }}>delete "{name}"? this can't be undone.</span>
                        <button
                          onClick={() => doDelete(s.key)}
                          className="font-mono text-xs px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2"
                          style={{ color: C.red, border: `1px solid ${C.red}`, background: "transparent" }}
                        >
                          yes, delete
                        </button>
                        <button
                          onClick={() => setPendingDelete(null)}
                          className="font-mono text-xs px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2"
                          style={{ color: C.dim, border: `1px solid ${C.cardEdge}`, background: "transparent" }}
                        >
                          cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* add new */}
              <div className="px-3 py-2.5" style={{ borderTop: `1px solid ${C.cardEdge}` }}>
                {adding && !atCap ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={newSec.glyph}
                      onChange={(e) => setNewSec({ ...newSec, glyph: firstGrapheme(e.target.value) })}
                      placeholder="✦"
                      aria-label="new section glyph"
                      className="w-9 flex-shrink-0 text-center text-sm outline-none rounded-md py-1"
                      style={inputStyle}
                    />
                    <input
                      autoFocus
                      value={newSec.name}
                      onChange={(e) => setNewSec({ ...newSec, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addSection();
                        else if (e.key === "Escape") { setAdding(false); setNewSec({ glyph: "", name: "" }); }
                      }}
                      placeholder="section name"
                      aria-label="new section name"
                      className="flex-1 min-w-0 text-sm outline-none rounded-md px-2 py-1"
                      style={inputStyle}
                    />
                    <button
                      onClick={addSection}
                      disabled={!newSecValid}
                      className="font-mono text-xs px-3 py-1.5 rounded-full font-bold flex-shrink-0 focus:outline-none focus-visible:ring-2"
                      style={{ background: newSecValid ? C.blue : C.blueSoft, color: newSecValid ? "#fff" : C.dim }}
                    >
                      create
                    </button>
                    <button
                      onClick={() => { setAdding(false); setNewSec({ glyph: "", name: "" }); }}
                      aria-label="cancel new section"
                      className="font-mono text-xs px-2 py-1.5 rounded-md flex-shrink-0 focus:outline-none"
                      style={{ color: C.dim, background: "transparent" }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => !atCap && setAdding(true)}
                    disabled={atCap}
                    className="w-full text-center font-mono text-xs py-1 focus:outline-none focus-visible:ring-2"
                    style={{ color: atCap ? C.faint : C.blue, background: "transparent", opacity: atCap ? 0.7 : 1, cursor: atCap ? "default" : "pointer" }}
                  >
                    {atCap ? `＋ add new — max ${MAX_SECTIONS} sections reached` : "＋ add new section"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        <div className="text-center font-mono text-xs mt-8" style={{ color: C.faint }}>
          === BRICK BY BRICK === · no recallin means u ain't ballin
        </div>
      </div>

      {/* Arrange mode: exit pill (bottom-left; ⇄ is bottom-right), drag ghost, safe-area probe.
          Rendered here at the root: inside a Collapsible, contain:layout would trap position:fixed. */}
      {arranging && (
        <>
          <button
            onClick={stopArrange}
            className="fixed z-40 font-mono text-xs font-bold px-3 py-1.5 rounded-full shadow-lg focus:outline-none focus-visible:ring-2 [touch-action:manipulation]"
            style={{ left: 14, bottom: "max(14px, env(safe-area-inset-bottom))", background: C.blue, color: "#fff", border: `1px solid ${C.blue}` }}
          >
            ✓ done
          </button>
          <div
            ref={ghostRef}
            aria-hidden="true"
            className="fixed left-0 top-0 z-[60] px-3 py-2 rounded-xl text-sm pointer-events-none truncate"
            style={{ display: "none", maxWidth: "min(280px, 80vw)", background: C.card, color: C.text, border: `1px solid ${C.blue}`, boxShadow: "0 12px 32px rgba(0,0,0,0.65)", transform: "translate(-9999px,0)" }}
          />
          <span
            ref={safeProbeRef}
            aria-hidden="true"
            style={{ position: "fixed", top: 0, left: 0, width: 0, height: 0, visibility: "hidden", pointerEvents: "none", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
          />
        </>
      )}

      {/* toast — sits above the ⇄ sync button (fixed bottom-right, ~30 px tall) so they never overlap */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-40 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full text-sm font-medium shadow-lg w-max"
          style={{ bottom: "calc(max(14px, env(safe-area-inset-bottom)) + 40px)", maxWidth: "calc(100vw - 28px)", background: C.card, color: C.text, border: `1px solid ${C.cardEdge}` }}
        >
          <span className="min-w-0">{toast}</span>
          {toastUndo && (
            <button
              onClick={undo}
              className="flex-shrink-0 font-mono text-xs font-bold px-3 py-1.5 rounded-full focus:outline-none focus-visible:ring-2 [touch-action:manipulation] [@media(pointer:coarse)]:py-2.5"
              style={{ color: C.blue, border: `1px solid ${C.blue}`, background: "transparent" }}
            >
              undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
