// Act From Here 2 — pure state model. No React, no DOM. Tested with node:test.
//
// Persisted shape (v4):
//   { v: 4,
//     sections: [{ key, glyph, subs: [{ key, name, collapsed?: true }] }],   // order = display order
//     items:    { [secKey]: [{ id, text, done, url?, next?, sub? }] },        // flat; sub → subs[].key
//     labels:   { [secKey]: name },
//     collapsed:{ [secKey]: true },                                          // sections only
//     seeded:   ["bigTicket"] }
//
// migrate() is a strict sanitizer: whatever comes in (v1..v4, a hand-edited
// gist, a hostile backup) comes out as this exact shape, and NO item is ever
// dropped — unknown buckets become sections, bad keys are remapped, bad
// fields are coerced. serialize() is the single writer of the persisted form.

export const DEFAULT_SECTIONS = [
  { key: "week", label: "THIS WEEK", glyph: "‣", hint: "check it off, clear it out" },
  { key: "decision", label: "DECISIONS TO CLOSE", glyph: "»", hint: "open loops cost more than wrong answers" },
  { key: "buy", label: "BUY LIST", glyph: "🛒", hint: "one cart, one checkout" },
  { key: "circleback", label: "CIRCLE BACK", glyph: "∞", hint: "infinity and beyond" },
  { key: "note", label: "KEEPERS", glyph: "🔦", hint: "no checkbox — just don't lose it" },
];

// Built-in identity for label/hint lookup. Includes sections that seeding may add.
export const SECTION_META = Object.fromEntries([
  ...DEFAULT_SECTIONS,
  { key: "month", label: "THIS MONTH", glyph: "◑", hint: "habits and programs that need a few weeks to mean anything" },
].map((s) => [s.key, s]));

// Semantic routing hints for the sorter — keyed by stable id, name-independent.
export const SORT_HINTS = {
  week: "concrete task doable soon (do/call/finish/schedule/email/clean)",
  month: "a habit, program or monthly target that needs a few weeks",
  decision: "an open question needing a choice (should I / or no / when do I / keep or sell)",
  buy: "anything to purchase or order",
  circleback: 'someday, blocked, later, "once X happens"',
  note: "mantra, insight, protocol cue, reference — not a task",
};

export const MAX_SECTIONS = 10;
export const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const CAP = { text: 2000, next: 2000, url: 2048, name: 80, label: 80 };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const has = (o, k) => o != null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const str = (v, cap) => {
  if (v == null) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : (() => { try { return JSON.stringify(v); } catch (e) { return ""; } })();
  return s.length > cap ? s.slice(0, cap) : s;
};

// First grapheme cluster — NOT first JS char. "❤️‍🔥" is 1 cluster / 4 code units.
export const firstGrapheme = (s0) => {
  const s = String(s0 || "");
  if (!s) return "";
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const it = seg.segment(s)[Symbol.iterator]().next();
    return it.done ? "" : it.value.segment;
  } catch (e) {
    return Array.from(s)[0] || "";
  }
};

export const catchAllKey = (sections) => {
  if (!Array.isArray(sections) || !sections.length) return null;
  return sections.some((s) => s && s.key === "note") ? "note" : sections[sections.length - 1].key;
};

// Only http/https/mailto become real links. `new URL` strips tabs/newlines and
// lower-cases the scheme, so "java\tscript:" and "JavaScript:" both fail here.
export const safeHref = (url) => {
  if (typeof url !== "string" || !url.trim()) return null;
  let u;
  try { u = new URL(url.trim()); } catch (e) { return null; }
  return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" ? url : null;
};

// A crafted/corrupt timestamp would win last-write-wins forever. Accept only a
// safe non-negative integer no further than a day into the future (the threat
// is absurd values like MAX_SAFE_INTEGER, not a phone whose clock runs fast).
export const clampSavedAt = (x) => {
  if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0) return null;
  if (x > Date.now() + 24 * 60 * 60 * 1000) return null;
  return x;
};

// Shape gate for anything arriving from the network or a file. migrate() is
// deliberately lossless and turns garbage into an empty default state — which
// must never be allowed to replace real data.
export const looksLikeState = (x) =>
  !!x && typeof x === "object" && !Array.isArray(x) &&
  (Array.isArray(x.sections) || (has(x, "items") && !!x.items && typeof x.items === "object") || Array.isArray(x.week));

// ---------- sanitizers ----------
const sanitizeKey = (raw, taken) => {
  const k = typeof raw === "string" ? raw : "";
  const ok = KEY_RE.test(k) && !(k in Object.prototype) && !taken.has(k.toLowerCase());
  const key = ok ? k : "s" + uid() + Math.random().toString(36).slice(2, 4);
  taken.add(key.toLowerCase());
  return key;
};

const sanitizeItems = (arr, subKeys) => {
  const ids = new Set();
  return (Array.isArray(arr) ? arr : []).filter((it) => it && typeof it === "object").map((it) => {
    let id = typeof it.id === "string" ? it.id : it.id != null ? String(it.id) : "";
    if (!id || ids.has(id)) id = uid();
    ids.add(id);
    const out = { id, text: str(it.text, CAP.text), done: !!it.done };
    const url = str(it.url, CAP.url);
    const next = str(it.next, CAP.next);
    if (url) out.url = url;
    if (next) out.next = next;
    if (typeof it.sub === "string" && subKeys.has(it.sub)) out.sub = it.sub;
    return out;
  });
};

const sanitizeSubs = (subs) => {
  const taken = new Set();
  return (Array.isArray(subs) ? subs : []).filter((s) => s && typeof s === "object").map((s) => {
    const out = { key: sanitizeKey(s.key, taken), name: str(s.name, CAP.name) || "UNTITLED" };
    if (s.collapsed === true) out.collapsed = true;
    return out;
  });
};

// Normalize any historical shape into { sections, items, labels, collapsed, seeded } (pre-sanitize).
const toShape = (raw) => {
  if (!raw || typeof raw !== "object") return { sections: DEFAULT_SECTIONS.map((s) => ({ key: s.key, glyph: s.glyph })), items: {}, labels: {}, collapsed: {}, seeded: [] };
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  // v3 / v4
  if (has(raw, "items") && Array.isArray(raw.sections)) {
    return { sections: raw.sections, items: obj(raw.items), labels: obj(raw.labels), collapsed: obj(raw.collapsed), seeded: raw.seeded };
  }
  // v2
  if (has(raw, "items") && typeof raw.items === "object") {
    return { sections: DEFAULT_SECTIONS.map((s) => ({ key: s.key, glyph: s.glyph })), items: obj(raw.items), labels: obj(raw.labels), collapsed: obj(raw.collapsed), seeded: [] };
  }
  // v1: flat buckets keyed by default section keys
  return { sections: DEFAULT_SECTIONS.map((s) => ({ key: s.key, glyph: s.glyph })), items: raw, labels: {}, collapsed: {}, seeded: [] };
};

export const migrate = (raw) => {
  const src = toShape(raw);
  const taken = new Set();
  const keyMap = new Map(); // original key → sanitized key
  const sections = [];
  for (const s of Array.isArray(src.sections) ? src.sections : []) {
    if (!s || typeof s !== "object") continue;
    const origKey = typeof s.key === "string" ? s.key : "";
    if (origKey && keyMap.has(origKey)) continue; // duplicate entry → merged
    const key = sanitizeKey(origKey, taken);
    if (origKey) keyMap.set(origKey, key);
    sections.push({ key, glyph: firstGrapheme(typeof s.glyph === "string" ? s.glyph.trim() : "") || "•", subs: sanitizeSubs(s.subs) });
  }
  // Orphan item buckets: never dropped. Become sections up to the cap; overflow folds into the catch-all.
  const items = {};
  const labels = {};
  const srcItems = src.items && typeof src.items === "object" ? src.items : {};
  for (const sec of sections) items[sec.key] = [];
  const overflow = [];
  for (const origKey of Object.keys(srcItems)) {
    if (!Array.isArray(srcItems[origKey])) continue;
    if (keyMap.has(origKey)) continue;
    if (sections.length < MAX_SECTIONS + 1) {
      const key = sanitizeKey(origKey, taken);
      keyMap.set(origKey, key);
      sections.push({ key, glyph: "•", subs: [] });
      items[key] = [];
      if (!has(src.labels, origKey)) labels[key] = str(origKey, CAP.label) || "RECOVERED";
    } else {
      overflow.push(...srcItems[origKey]);
    }
  }
  for (const [origKey, key] of keyMap) {
    const sec = sections.find((s) => s.key === key);
    const subKeys = new Set(sec ? sec.subs.map((x) => x.key) : []);
    items[key] = sanitizeItems(srcItems[origKey], subKeys);
  }
  if (overflow.length) {
    const ca = catchAllKey(sections);
    if (ca) items[ca] = items[ca].concat(sanitizeItems(overflow, new Set()));
  }
  // Ensure id uniqueness across the whole state (items may have moved between buckets).
  const seen = new Set();
  for (const key of Object.keys(items)) {
    items[key] = items[key].map((it) => {
      if (seen.has(it.id)) return { ...it, id: uid() };
      seen.add(it.id);
      return it;
    });
  }
  for (const origKey of Object.keys(src.labels || {})) {
    const key = keyMap.get(origKey);
    if (!key) continue;
    const v = str(src.labels[origKey], CAP.label);
    if (v) labels[key] = v;
  }
  const collapsed = {};
  for (const origKey of Object.keys(src.collapsed || {})) {
    const key = keyMap.get(origKey);
    if (key && src.collapsed[origKey] === true) collapsed[key] = true;
  }
  const seeded = Array.isArray(src.seeded) ? src.seeded.filter((x) => typeof x === "string") : [];
  return { v: 4, sections, items, labels, collapsed, seeded };
};

// The ONLY producer of the persisted string. Strips cosmetic `fresh`, fixes field order.
export const serialize = (st) => {
  const sections = st.sections.map((s) => ({
    key: s.key,
    glyph: s.glyph,
    subs: (s.subs || []).map((x) => (x.collapsed ? { key: x.key, name: x.name, collapsed: true } : { key: x.key, name: x.name })),
  }));
  const items = {};
  for (const s of sections) {
    items[s.key] = (st.items[s.key] || []).map((it) => {
      const o = { id: it.id, text: it.text, done: !!it.done };
      if (it.url) o.url = it.url;
      if (it.next) o.next = it.next;
      if (it.sub) o.sub = it.sub;
      return o;
    });
  }
  const labels = {};
  for (const s of sections) if (st.labels && st.labels[s.key]) labels[s.key] = st.labels[s.key];
  const collapsed = {};
  for (const s of sections) if (st.collapsed && st.collapsed[s.key]) collapsed[s.key] = true;
  return JSON.stringify({ v: 4, sections, items, labels, collapsed, seeded: Array.isArray(st.seeded) ? st.seeded : [] });
};

// ---------- default first-load content (ACT-FROM-HERE.md) ----------
export const seed = () => migrate({
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

// Storage keys owned by AFH2. The old app keeps afh-v1 / afh-meta untouched.
export const STORE_KEY = "afh2-v1";
export const CORRUPT_KEY = "afh2-corrupt-backup";
