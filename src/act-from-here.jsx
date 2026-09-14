import { useState, useEffect, useRef } from "react";

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

// Category IDENTITY is the key — name, glyph, and existence are all data.
// DEFAULT_SECTIONS seeds first load + provides labels/hints for the built-ins.
const DEFAULT_SECTIONS = [
  { key: "week", label: "THIS WEEK", glyph: "‣", hint: "check it off, clear it out" },
  { key: "decision", label: "DECISIONS TO CLOSE", glyph: "»", hint: "open loops cost more than wrong answers" },
  { key: "buy", label: "BUY LIST", glyph: "🛒", hint: "one cart, one checkout" },
  { key: "circleback", label: "CIRCLE BACK", glyph: "∞", hint: "infinity and beyond" },
  { key: "note", label: "KEEPERS", glyph: "🔦", hint: "no checkbox — just don't lose it" },
];
const DEFAULTS_BY_KEY = Object.fromEntries(DEFAULT_SECTIONS.map((s) => [s.key, s]));

// Semantic routing hints for the sorter — keyed by stable id, name-independent.
const SORT_HINTS = {
  week: "concrete task doable soon (do/call/finish/schedule/email/clean)",
  decision: "an open question needing a choice (should I / or no / when do I / keep or sell)",
  buy: "anything to purchase or order",
  circleback: 'someday, blocked, later, "once X happens"',
  note: "mantra, insight, protocol cue, reference — not a task",
};

const MAX_SECTIONS = 10;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const CLICK_DELAY = 220; // ms window separating single click (expand) from double click (edit)

// First grapheme cluster — NOT first JS char. "❤️‍🔥" is 1 cluster / 4 code units;
// maxLength=1 would shred it. Intl.Segmenter with a code-point fallback.
export const firstGrapheme = (str) => {
  const s = String(str || "");
  if (!s) return "";
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const it = seg.segment(s)[Symbol.iterator]().next();
    return it.done ? "" : it.value.segment;
  } catch (e) {
    return Array.from(s)[0] || "";
  }
};

// v1: { week:[], decision:[], ... }
// v2: { items, labels, collapsed }
// v3: v2 + sections:[{key,glyph}]  (order + glyph + existence)
// Migrations pass item arrays through UNTOUCHED; v2→v3 seeds sections from
// DEFAULT_SECTIONS so first load looks identical.
export const migrate = (raw) => {
  // v3
  if (raw && typeof raw === "object" && raw.items && Array.isArray(raw.sections)) {
    const sections = raw.sections
      .filter((s) => s && typeof s.key === "string" && s.key && typeof s.glyph === "string" && s.glyph)
      .map((s) => ({ key: s.key, glyph: s.glyph }));
    return {
      sections,
      items: Object.fromEntries(sections.map((s) => [s.key, Array.isArray(raw.items[s.key]) ? raw.items[s.key].map(({ fresh, ...rest }) => rest) : []])),
      labels: raw.labels && typeof raw.labels === "object" ? raw.labels : {},
      collapsed: raw.collapsed && typeof raw.collapsed === "object" ? raw.collapsed : {},
    };
  }
  // v2
  if (raw && typeof raw === "object" && raw.items && typeof raw.items === "object") {
    return {
      sections: DEFAULT_SECTIONS.map((s) => ({ key: s.key, glyph: s.glyph })),
      items: Object.fromEntries(DEFAULT_SECTIONS.map((s) => [s.key, Array.isArray(raw.items[s.key]) ? raw.items[s.key].map(({ fresh, ...rest }) => rest) : []])),
      labels: raw.labels && typeof raw.labels === "object" ? raw.labels : {},
      collapsed: raw.collapsed && typeof raw.collapsed === "object" ? raw.collapsed : {},
    };
  }
  // v1 (or unknown)
  return {
    sections: DEFAULT_SECTIONS.map((s) => ({ key: s.key, glyph: s.glyph })),
    items: Object.fromEntries(DEFAULT_SECTIONS.map((s) => [s.key, Array.isArray(raw?.[s.key]) ? raw[s.key].map(({ fresh, ...rest }) => rest) : []])),
    labels: {},
    collapsed: {},
  };
};

// ---------- seed from ACT-FROM-HERE.md ----------
const seed = () => ({
  sections: DEFAULT_SECTIONS.map((s) => ({ key: s.key, glyph: s.glyph })),
  items: {
    week: [
      { id: uid(), text: "Solarium sorting solidification (plan in §5A of the doc)", done: false },
      { id: uid(), text: "Dr. K", done: false },
      { id: uid(), text: "Finish Dan's Noodling + everything down to 🛑", done: false },
      { id: uid(), text: "Weighted vest → into the solarium cart session (one checkout)", done: false },
      { id: uid(), text: "Meal prep: judge Icon vs. Snap → cb Creative Prep next wk · fitfoodie reply pending 👀", done: false },
      { id: uid(), text: "Say hbd / check in on people", done: false },
      { id: uid(), text: "Verify Apple Music car shortcut actually fires the ET mixer", done: false },
      { id: uid(), text: "Cold plunge: call re: expiry → then buy the 8-pack ($20/sesh)", done: false },
    ],
    decision: [
      { id: uid(), text: "Treadmill — not in the weekly routine + solarium needs floor = sell", done: false },
      { id: uid(), text: "Desk posture program $30 — calendar slot FIRST, then buy", url: "https://www.gotrom.com/desk-posture-therapy-program-29-99?ac=3&utm_source=e1&utm_medium=email&s=e1&m=email", done: false },
      { id: uid(), text: "Cable tray for living room — only after cables annoy you twice", done: false },
      { id: uid(), text: "Skim WF debit around the 6th once — confirm no phantom Gamepass charge", done: false },
    ],
    buy: [
      { id: uid(), text: "3-drawer file cabinet (also covers basket replacement)", url: "https://a.co/d/050FGQTZ", done: false },
      { id: uid(), text: "Book ends for shelves", done: false },
      { id: uid(), text: "Storage ottoman 🔥", done: false },
      { id: uid(), text: "Balance board foot rocker (cheaper than the wishlist one)", done: false },
      { id: uid(), text: "Body-stuff container — AFTER electronics bin arrives (size check)", done: false },
      { id: uid(), text: "Slant board — trigger: once in FW", url: "https://frylr.com/products/frylr-wooden-slant-board-calf-stretcher-pain-relief?variant=43257915637838", done: false },
      { id: uid(), text: "Maybe: small string lights for room", done: false },
      { id: uid(), text: "L888r: new monitor setup → wide boiiii", done: false },
    ],
    circleback: [
      { id: uid(), text: "Fitness re-entry — pick ONE to trial: Orange Theory · Indigo yoga · climbing", done: false },
      { id: uid(), text: "Laser foot: 3× more sessions this year + 6× more hydro!!!", done: false },
      { id: uid(), text: "Micro-needle right arm — next step?", done: false },
      { id: uid(), text: "Forehead mole removal — when?", done: false },
      { id: uid(), text: "Finish 🎧 NOTES ON MY BODY JOURNEY pdf (iCloud)", done: false },
      { id: uid(), text: "Peep 2013 oldest workout logs", done: false },
      { id: uid(), text: "Shiverrr stimulation — develop or delete on next pass", done: false },
    ],
    note: [
      { id: uid(), text: "No recallin means u ain't ballin", done: false },
      { id: uid(), text: "Notes don't matter. Fruits do 🍓", done: false },
      { id: uid(), text: "There's no expectation: I HAVE EVERY RIGHT TO BE HERE.", done: false },
    ],
  },
  labels: {},
  collapsed: {},
});

const STORE_KEY = "afh-v1";

export default function ActFromHere() {
  const [data, setData] = useState(null); // { sections, items, labels, collapsed }
  const [dump, setDump] = useState("");
  const [sorting, setSorting] = useState(false);
  const [toast, setToast] = useState("");
  const [saveState, setSaveState] = useState("");
  const [openItem, setOpenItem] = useState(null);
  const [editing, setEditing] = useState(null);         // { sec, id, text, url }
  const [editingCat, setEditingCat] = useState(null);   // { key, value }
  const [managerOpen, setManagerOpen] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState(null); // { key, value }
  const [pendingDelete, setPendingDelete] = useState(null); // key
  const [adding, setAdding] = useState(false);
  const [newSec, setNewSec] = useState({ glyph: "", name: "" });
  const [addingItem, setAddingItem] = useState(null); // section key with an open quick-add form
  const [newItem, setNewItem] = useState({ text: "", url: "" });
  const addItemInputRef = useRef(null);
  const toastTimer = useRef(null);
  const latest = useRef(null);     // newest state, source of truth for writes AND mutations
  const saveTimer = useRef(null);  // debounce handle
  const busy = useRef(false);      // a write is in flight
  const dirty = useRef(false);     // state changed while writing
  const clickTimer = useRef(null); // single-vs-double click disambiguation

  const cur = () => latest.current;
  const labelFor = (key) => {
    const st = latest.current || data;
    return (st && st.labels && st.labels[key]) || (DEFAULTS_BY_KEY[key] && DEFAULTS_BY_KEY[key].label) || "UNTITLED";
  };

  // ---------- load ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORE_KEY);
        const parsed = JSON.parse(res.value);
        const migrated = migrate(parsed);
        latest.current = migrated;
        setData(migrated);
        if (!parsed.items || !Array.isArray(parsed.sections)) scheduleSave(); // persist migrated shape via the writer
      } catch (e) {
        const s = seed();
        latest.current = s;
        setData(s);
        scheduleSave();
      }
    })();
  }, []);

  // ---------- save ----------
  // Writes are debounced + serialized: rapid taps (check, check, clear, rename,
  // glyph edit, add, delete) coalesce into ONE storage.set instead of a burst
  // that trips the rate limit. Failed writes retry with backoff; nothing is dropped.
  const flush = async () => {
    if (busy.current) { dirty.current = true; return; }
    busy.current = true;
    dirty.current = false;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        // strip cosmetic `fresh` flags so highlights don't survive reload
        const src = latest.current;
        const clean = {
          sections: src.sections,
          items: Object.fromEntries(Object.entries(src.items).map(([k, arr]) => [k, arr.map(({ fresh, ...rest }) => rest)])),
          labels: src.labels,
          collapsed: src.collapsed,
        };
        await window.storage.set(STORE_KEY, JSON.stringify(clean));
        ok = true;
      } catch (e) {
        console.error("save attempt", attempt + 1, "failed", e);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    busy.current = false;
    if (dirty.current) { flush(); return; } // state changed mid-write → write newest
    if (ok) {
      setSaveState("saved");
      setTimeout(() => setSaveState((s) => (s === "saved" ? "" : s)), 1200);
    } else {
      setSaveState("error");
    }
  };

  const scheduleSave = () => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 400);
  };

  const persist = (next) => {
    setData(next);
    latest.current = next;
    scheduleSave();
  };

  // Cosmetic state updates (e.g. clearing flash highlights) — keeps latest.current
  // and rendered data in LOCKSTEP without scheduling a write. If these diverge,
  // later persists rebuild from latest and resurrect stale flags (the stuck-blue bug).
  const setLocal = (updater) => {
    const st = latest.current;
    if (!st) return;
    const next = updater(st);
    if (!next || next === st) return;
    latest.current = next;
    setData(next);
  };

  const flash = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  // ---------- item ops (all read cur(), never stale closures) ----------
  const toggle = (secKey, id) => {
    const st = cur();
    persist({ ...st, items: { ...st.items, [secKey]: st.items[secKey].map((it) => (it.id === id ? { ...it, done: !it.done } : it)) } });
  };

  const remove = (secKey, id) => {
    const st = cur();
    setOpenItem(null);
    persist({ ...st, items: { ...st.items, [secKey]: st.items[secKey].filter((it) => it.id !== id) } });
  };

  const move = (fromSec, id, toSec) => {
    if (fromSec === toSec) return;
    const st = cur();
    const item = st.items[fromSec].find((it) => it.id === id);
    if (!item) return;
    setOpenItem(null);
    persist({
      ...st,
      items: {
        ...st.items,
        [fromSec]: st.items[fromSec].filter((it) => it.id !== id),
        [toSec]: [{ ...item, fresh: true }, ...st.items[toSec]],
      },
    });
    setTimeout(() => {
      setLocal((st) => (st.items[toSec] ? { ...st, items: { ...st.items, [toSec]: st.items[toSec].map((it) => (it.fresh ? { ...it, fresh: false } : it)) } } : null));
    }, 1500);
  };

  // ---------- quick add (per-section) ----------
  // Enter commits and keeps the form open for rapid consecutive entry;
  // tapping away commits and closes; Esc discards; empty text creates nothing.
  const closeNewItem = () => { setAddingItem(null); setNewItem({ text: "", url: "" }); };

  const commitNewItem = (keepOpen) => {
    if (!addingItem) return;
    const secKey = addingItem;
    const text = newItem.text.trim();
    const url = newItem.url.trim();
    if (!text) { if (!keepOpen) closeNewItem(); return; }
    const st = cur();
    if (!st.items[secKey]) { closeNewItem(); return; } // section deleted mid-entry
    const item = { id: uid(), text, done: false, fresh: true };
    if (url) item.url = url;
    persist({ ...st, items: { ...st.items, [secKey]: [item, ...st.items[secKey]] } });
    setNewItem({ text: "", url: "" });
    if (!keepOpen) closeNewItem();
    else setTimeout(() => { if (addItemInputRef.current) addItemInputRef.current.focus(); }, 0);
    setTimeout(() => {
      setLocal((st) => (st.items[secKey] ? { ...st, items: { ...st.items, [secKey]: st.items[secKey].map((x) => (x.fresh ? { ...x, fresh: false } : x)) } } : null));
    }, 1800);
  };

  const doneCount = data ? Object.values(data.items).flat().filter((it) => it.done).length : 0;

  const clearDone = () => {
    const st = cur();
    const n = Object.values(st.items).flat().filter((it) => it.done).length;
    if (!n) return;
    persist({ ...st, items: Object.fromEntries(Object.entries(st.items).map(([k, arr]) => [k, arr.filter((it) => !it.done)])) });
    flash(`Cleared ${n} — brick by brick 🧱`);
  };

  // ---------- collapse ----------
  const toggleCollapse = (key) => {
    const st = cur();
    persist({ ...st, collapsed: { ...st.collapsed, [key]: !st.collapsed[key] } });
  };

  // ---------- category rename ----------
  const commitCatEdit = () => {
    if (!editingCat) return;
    const { key, value } = editingCat;
    setEditingCat(null);
    const name = value.trim();
    if (!name) return; // empty reverts to previous value
    const st = cur();
    const currentName = (st.labels && st.labels[key]) || (DEFAULTS_BY_KEY[key] && DEFAULTS_BY_KEY[key].label) || "UNTITLED";
    if (name === currentName) return;
    persist({ ...st, labels: { ...st.labels, [key]: name } });
  };

  // ---------- section management ----------
  const warnIfDuplicateGlyph = (glyph, st, exceptKey) => {
    const clash = st.sections.find((s) => s.key !== exceptKey && s.glyph === glyph);
    if (clash) flash(`heads up — ${glyph} is already used by ${labelFor(clash.key)}`);
  };

  const commitGlyphEdit = () => {
    if (!editingGlyph) return;
    const { key, value } = editingGlyph;
    setEditingGlyph(null);
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
    if (editing && editing.sec === key) setEditing(null);
    if (editingCat && editingCat.key === key) setEditingCat(null);
    persist({ sections: st.sections.filter((s) => s.key !== key), items, labels, collapsed });
  };

  const addSection = () => {
    const g = firstGrapheme(newSec.glyph.trim());
    const n = newSec.name.trim();
    if (!g || !n) return;
    const st = cur();
    if (st.sections.length >= MAX_SECTIONS) return;
    warnIfDuplicateGlyph(g, st, null);
    const key = "s" + uid();
    persist({
      ...st,
      sections: [...st.sections, { key, glyph: g }],
      items: { ...st.items, [key]: [] },
      labels: { ...st.labels, [key]: n },
      // collapsed left unset → defaults open
    });
    setNewSec({ glyph: "", name: "" });
    setAdding(false);
  };

  // ---------- item edit ----------
  const startEdit = (secKey, it) => {
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
    setOpenItem((prev) => (prev === it.id ? prev : null)); // don't leave another item's menu hanging open
    setEditing({ sec: secKey, id: it.id, text: it.text, url: it.url || "", next: it.next || "" });
  };

  const commitItemEdit = () => {
    if (!editing) return;
    const { sec, id } = editing;
    const st = cur();
    const item = st.items[sec] && st.items[sec].find((i) => i.id === id);
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

  const cancelItemEdit = () => setEditing(null);

  // ---------- click vs double-click on item text ----------
  const handleItemClick = (id) => {
    if (editing && editing.id === id) return;
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

  // ---------- AI dump sorter — consumes the LIVE section set ----------
  const sortDump = async () => {
    const raw = dump.trim();
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
        .map((s) => `- "${s.key}": ${labelFor(s.key)} — ${SORT_HINTS[s.key] || "route here anything that fits this section's name"}`)
        .join("\n");
      const keyEnum = liveSecs.map((s) => s.key).join("|");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
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
      const catchAll = st.sections[st.sections.length - 1].key;
      const nextItems = { ...st.items };
      let n = 0;
      for (const it of arr) {
        if (!it || !it.text) continue;
        const sec = valid.has(it.section) ? it.section : catchAll;
        nextItems[sec] = [{ id: uid(), text: String(it.text), done: false, fresh: true }, ...nextItems[sec]];
        n++;
      }
      persist({ ...st, items: nextItems });
      setDump("");
      flash(`Sorted ${n} item${n === 1 ? "" : "s"} ⚡`);
      setTimeout(() => {
        setLocal((st) => ({ ...st, items: Object.fromEntries(Object.entries(st.items).map(([k, a]) => [k, a.map((x) => (x.fresh ? { ...x, fresh: false } : x))])) }));
      }, 1800);
    } catch (e) {
      console.error(e);
      const reason = String(e && e.message ? e.message : e).slice(0, 90);
      // fallback: raw lines land in the last section so nothing is lost
      const st = cur();
      if (!st.sections.length) { setSorting(false); return; }
      const catchAll = st.sections[st.sections.length - 1].key;
      const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l && !/^[=^\-\s]+$/.test(l));
      persist({ ...st, items: { ...st.items, [catchAll]: [...lines.map((l) => ({ id: uid(), text: l, done: false, fresh: true })), ...st.items[catchAll]] } });
      setDump("");
      flash(`Sort failed (${reason}) — dumped into ${labelFor(catchAll)} as-is, nothing lost`);
    } finally {
      setSorting(false);
    }
  };

  // ---------- render ----------
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg, color: C.dim }}>
        <div className="font-mono text-sm tracking-widest">loading the surface…</div>
      </div>
    );
  }

  const atCap = data.sections.length >= MAX_SECTIONS;
  const newSecValid = !!firstGrapheme(newSec.glyph.trim()) && !!newSec.name.trim();

  return (
    <div className="min-h-screen pb-24" style={{ background: C.bg, color: C.text, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" }}>
      <div className="max-w-xl mx-auto px-4 pt-6">

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
            onChange={(e) => setDump(e.target.value)}
            placeholder={"‣ call about the thing\n» buy the other thing\nsome mantra that hit 🔦\n…"}
            rows={4}
            className="w-full rounded-lg p-3 text-sm font-mono resize-y outline-none"
            style={{ background: C.bg, color: C.text, border: `1px solid ${C.cardEdge}`, caretColor: C.blue }}
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

        {/* clear done */}
        <div className="flex justify-end mb-4">
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

        {/* sections */}
        {data.sections.map((secEntry) => {
          const sec = {
            key: secEntry.key,
            glyph: secEntry.glyph,
            hint: (DEFAULTS_BY_KEY[secEntry.key] && DEFAULTS_BY_KEY[secEntry.key].hint) || "nothing here yet",
          };
          const items = data.items[sec.key] || [];
          const open = items.filter((i) => !i.done).length;
          const isCollapsed = !!data.collapsed[sec.key];
          const displayLabel = (data.labels && data.labels[sec.key]) || (DEFAULTS_BY_KEY[sec.key] && DEFAULTS_BY_KEY[sec.key].label) || "UNTITLED";
          return (
            <div key={sec.key} className="mb-6">
              <div className="flex items-baseline justify-between mb-2 px-1">
                <h2 className="text-sm font-extrabold tracking-widest flex items-baseline gap-1.5" style={{ color: C.text }}>
                  <button
                    onClick={() => toggleCollapse(sec.key)}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "expand" : "collapse"} ${displayLabel}`}
                    className="focus:outline-none focus-visible:ring-2"
                    style={{ color: C.blue, opacity: isCollapsed ? 0.5 : 1, background: "transparent" }}
                  >
                    {sec.glyph}
                  </button>
                  {editingCat && editingCat.key === sec.key ? (
                    <input
                      autoFocus
                      value={editingCat.value}
                      onChange={(e) => setEditingCat({ key: sec.key, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCatEdit();
                        else if (e.key === "Escape") setEditingCat(null);
                      }}
                      onBlur={commitCatEdit}
                      className="text-sm font-extrabold tracking-widest outline-none"
                      style={{ background: "transparent", color: C.text, borderBottom: `1px solid ${C.blue}`, width: "14rem" }}
                    />
                  ) : (
                    <span onDoubleClick={() => setEditingCat({ key: sec.key, value: displayLabel })}>{displayLabel}</span>
                  )}
                </h2>
                <span className="font-mono text-xs" style={{ color: C.faint }}>
                  {sec.key === "note" ? `${items.length}` : `${open} open`}
                </span>
              </div>
              {!isCollapsed && (
                <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.cardEdge}` }}>
                  {items.length === 0 && (
                    <div className="px-4 py-4 text-sm" style={{ color: C.faint }}>
                      empty — {sec.hint}
                    </div>
                  )}
                  {items.map((it, idx) => {
                    const isEditing = editing && editing.id === it.id && editing.sec === sec.key;
                    return (
                      <div
                        key={it.id}
                        className="transition-colors duration-700"
                        style={{
                          borderTop: idx === 0 ? "none" : `1px solid ${C.cardEdge}`,
                          background: it.fresh ? C.blueSoft : "transparent",
                        }}
                      >
                        <div className="flex items-start gap-3 px-3 py-2.5">
                          {sec.key !== "note" ? (
                            <button
                              onClick={() => toggle(sec.key, it.id)}
                              aria-label={it.done ? "mark not done" : "mark done"}
                              className="mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs focus:outline-none focus-visible:ring-2"
                              style={{
                                border: `1.5px solid ${it.done ? C.blue : C.faint}`,
                                background: it.done ? C.blue : "transparent",
                                color: "#fff",
                              }}
                            >
                              {it.done ? "✓" : ""}
                            </button>
                          ) : (
                            <span className="mt-0.5 w-5 flex-shrink-0 text-center" style={{ color: C.faint }}>·</span>
                          )}
                          <div className="flex-1 min-w-0">
                            {isEditing ? (
                              <div
                                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commitItemEdit(); }}
                              >
                                <input
                                  autoFocus
                                  value={editing.text}
                                  onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitItemEdit();
                                    else if (e.key === "Escape") cancelItemEdit();
                                  }}
                                  className="w-full text-sm leading-snug outline-none rounded-md px-2 py-1"
                                  style={{ background: C.bg, color: C.text, border: `1px solid ${C.blue}` }}
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
                                  style={{ background: C.bg, color: C.text, border: `1px solid ${C.cardEdge}` }}
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
                                  style={{ background: C.bg, color: C.blue, border: `1px solid ${C.cardEdge}` }}
                                />
                              </div>
                            ) : (
                              <>
                                <button
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
                                {it.next && (
                                  <div className="text-xs mt-0.5" style={{ color: C.dim }}>→ {it.next}</div>
                                )}
                                {it.url && (
                                  <a
                                    href={it.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-block mt-0.5 text-xs font-mono"
                                    style={{ color: C.blue }}
                                  >
                                    link ↗
                                  </a>
                                )}
                                {openItem === it.id && (
                                  <div className="flex items-center gap-2 mt-2 mb-1">
                                    <select
                                      value={sec.key}
                                      onChange={(e) => move(sec.key, it.id, e.target.value)}
                                      className="text-xs font-mono rounded-md px-2 py-1 focus:outline-none"
                                      style={{ background: C.bg, color: C.text, border: `1px solid ${C.cardEdge}` }}
                                    >
                                      {data.sections.map((s) => (
                                        <option key={s.key} value={s.key}>{s.glyph} {labelFor(s.key).toLowerCase()}</option>
                                      ))}
                                    </select>
                                    <button
                                      onClick={() => startEdit(sec.key, it)}
                                      className="text-xs font-mono px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2"
                                      style={{ color: C.blue, border: `1px solid ${C.cardEdge}` }}
                                    >
                                      edit
                                    </button>
                                    <button
                                      onClick={() => remove(sec.key, it.id)}
                                      className="text-xs font-mono px-2 py-1 rounded-md focus:outline-none focus-visible:ring-2"
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
                  })}
                  {/* quick add */}
                  {addingItem === sec.key ? (
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
                        style={{ background: C.bg, color: C.text, border: `1px solid ${C.blue}` }}
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
                        style={{ background: C.bg, color: C.blue, border: `1px solid ${C.cardEdge}` }}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingItem(sec.key); setNewItem({ text: "", url: "" }); }}
                      aria-label={`add item to ${displayLabel}`}
                      className="w-full text-center font-mono text-xs py-2 focus:outline-none focus-visible:ring-2"
                      style={{ color: C.blue, background: "transparent", borderTop: `1px solid ${C.cardEdge}` }}
                    >
                      ＋ add item
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* section manager */}
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
              {data.sections.map((s, idx) => {
                const count = (data.items[s.key] || []).length;
                const name = labelFor(s.key);
                const deletable = count === 0;
                return (
                  <div key={s.key} className="px-3 py-2.5" style={{ borderTop: idx === 0 ? "none" : `1px solid ${C.cardEdge}` }}>
                    <div className="flex items-center gap-2.5">
                      {editingGlyph && editingGlyph.key === s.key ? (
                        <input
                          autoFocus
                          value={editingGlyph.value}
                          onChange={(e) => setEditingGlyph({ key: s.key, value: firstGrapheme(e.target.value) })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitGlyphEdit();
                            else if (e.key === "Escape") setEditingGlyph(null);
                          }}
                          onBlur={commitGlyphEdit}
                          aria-label={`glyph for ${name}`}
                          className="w-9 flex-shrink-0 text-center text-sm outline-none rounded-md py-1"
                          style={{ background: C.bg, border: `1px solid ${C.blue}`, color: C.text }}
                        />
                      ) : (
                        <button
                          onClick={() => setEditingGlyph({ key: s.key, value: s.glyph })}
                          aria-label={`edit glyph for ${name}`}
                          className="w-9 flex-shrink-0 py-1 rounded-md text-sm focus:outline-none focus-visible:ring-2"
                          style={{ color: C.blue, border: `1px solid ${C.cardEdge}`, background: "transparent" }}
                        >
                          {s.glyph}
                        </button>
                      )}
                      <span className="flex-1 min-w-0 truncate text-sm font-bold tracking-wide" style={{ color: C.text }}>{name}</span>
                      <span className="font-mono text-xs flex-shrink-0" style={{ color: C.faint }}>
                        {count} item{count === 1 ? "" : "s"}
                      </span>
                      {!deletable && (
                        <span className="font-mono text-xs flex-shrink-0" style={{ color: C.faint }}>· clear it out first</span>
                      )}
                      <button
                        disabled={!deletable}
                        onClick={() => deletable && setPendingDelete(s.key)}
                        aria-label={`delete ${name}`}
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
                      style={{ background: C.bg, border: `1px solid ${C.cardEdge}`, color: C.text }}
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
                      style={{ background: C.bg, border: `1px solid ${C.cardEdge}`, color: C.text }}
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

        <div className="text-center font-mono text-xs mt-8" style={{ color: C.faint }}>
          === BRICK BY BRICK === · no recallin means u ain't ballin
        </div>
      </div>

      {/* toast */}
      {toast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-medium shadow-lg"
          style={{ background: C.card, color: C.text, border: `1px solid ${C.cardEdge}` }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
