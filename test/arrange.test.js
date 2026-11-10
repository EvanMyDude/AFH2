import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, serialize } from "../src/model.js";
import { placeItem, groupOf, placeSub, promoteSub } from "../src/arrange.js";

// week: main list a1 a2 a3 + subsection "bt" (b1 b2) interleaved in the array; buy: empty main list + empty "cart".
const base = () => migrate({
  sections: [
    { key: "week", glyph: "‣", subs: [{ key: "bt", name: "BIG TICKET" }, { key: "zz", name: "FOLDED", collapsed: true }] },
    { key: "buy", glyph: "🛒", subs: [{ key: "cart", name: "CART" }] },
    { key: "note", glyph: "🔦", subs: [] },
  ],
  items: {
    week: [
      { id: "a1", text: "A1", done: false },
      { id: "b1", text: "B1", done: false, sub: "bt" },
      { id: "a2", text: "A2", done: true, url: "https://example.com/a2", next: "n" },
      { id: "b2", text: "B2", done: false, sub: "bt" },
      { id: "a3", text: "A3", done: false },
      { id: "z1", text: "Z1", done: false, sub: "zz" },
    ],
    buy: [],
    note: [{ id: "n1", text: "N1", done: false }],
  },
  labels: {}, collapsed: { note: true },
});

const freeze = (o) => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const list = (st, sec, sub = "") => {
  const keys = new Set(st.sections.find((s) => s.key === sec).subs.map((x) => x.key));
  return st.items[sec].filter((it) => groupOf(it, keys) === sub).map((it) => it.id);
};

test("reorders within the main list, down and up, without touching other lists", () => {
  const st = freeze(base());
  const down = placeItem(st, { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: { id: "a3", side: "after" } });
  assert.deepEqual(list(down, "week"), ["a2", "a3", "a1"]);
  assert.deepEqual(list(down, "week", "bt"), ["b1", "b2"]);
  const up = placeItem(down, { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: "top" });
  assert.deepEqual(list(up, "week"), ["a1", "a2", "a3"]);
  assert.equal(down.items.buy, st.items.buy, "other sections are the same arrays");
  assert.equal(down.items.note, st.items.note);
});

test("reorders within a subsection", () => {
  const st = freeze(base());
  const out = placeItem(st, { id: "b2", fromSec: "week", toSec: "week", toSub: "bt", anchor: { id: "b1", side: "before" } });
  assert.deepEqual(list(out, "week", "bt"), ["b2", "b1"]);
  assert.deepEqual(list(out, "week"), ["a1", "a2", "a3"]);
});

test("moves main list → subsection and back, keeping every other field", () => {
  const st = freeze(base());
  const into = placeItem(st, { id: "a2", fromSec: "week", toSec: "week", toSub: "bt", anchor: { id: "b1", side: "after" } });
  assert.deepEqual(list(into, "week", "bt"), ["b1", "a2", "b2"]);
  assert.deepEqual(list(into, "week"), ["a1", "a3"]);
  const moved = into.items.week.find((i) => i.id === "a2");
  assert.deepEqual(moved, { id: "a2", text: "A2", done: true, url: "https://example.com/a2", next: "n", sub: "bt" });
  const back = placeItem(into, { id: "a2", fromSec: "week", toSec: "week", toSub: "", anchor: "end" });
  assert.deepEqual(list(back, "week"), ["a1", "a3", "a2"]);
  assert.equal(back.items.week.find((i) => i.id === "a2").sub, undefined);
});

test("top of a collapsed subsection, and of an empty one", () => {
  const st = freeze(base());
  const folded = placeItem(st, { id: "a3", fromSec: "week", toSec: "week", toSub: "zz", anchor: "top" });
  assert.deepEqual(list(folded, "week", "zz"), ["a3", "z1"]);
  const empty = placeItem(st, { id: "a1", fromSec: "week", toSec: "buy", toSub: "cart", anchor: "top" });
  assert.deepEqual(list(empty, "buy", "cart"), ["a1"]);
});

test("cross-section to the top of the main list removes it from the source", () => {
  const st = freeze(base());
  const out = placeItem(st, { id: "b2", fromSec: "week", toSec: "note", toSub: "", anchor: "top" });
  assert.deepEqual(list(out, "note"), ["b2", "n1"]);
  assert.deepEqual(list(out, "week", "bt"), ["b1"]);
  assert.equal(out.items.note[0].sub, undefined);
  assert.equal(out.collapsed, st.collapsed, "collapse state untouched");
});

test("top/end anchor to the list's own members, not the array ends", () => {
  const st = freeze(base());
  // b1 sits at array index 1; "top" of bt must land right before it, not at index 0.
  const out = placeItem(st, { id: "b2", fromSec: "week", toSec: "week", toSub: "bt", anchor: "top" });
  assert.deepEqual(out.items.week.map((i) => i.id), ["a1", "b2", "b1", "a2", "a3", "z1"]);
  const end = placeItem(st, { id: "a1", fromSec: "week", toSec: "week", toSub: "bt", anchor: "end" });
  assert.deepEqual(end.items.week.map((i) => i.id), ["b1", "a2", "b2", "a1", "a3", "z1"]);
});

test("no visible change returns the same object", () => {
  const st = freeze(base());
  const same = [
    { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: "top" },
    { id: "a3", fromSec: "week", toSec: "week", toSub: "", anchor: "end" },
    { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: { id: "a2", side: "before" } },
    { id: "a2", fromSec: "week", toSec: "week", toSub: "", anchor: { id: "a1", side: "after" } },
    { id: "b1", fromSec: "week", toSec: "week", toSub: "bt", anchor: { id: "b2", side: "before" } },
  ];
  for (const req of same) assert.equal(placeItem(st, req), st, JSON.stringify(req));
});

test("stale or invalid requests return the same object", () => {
  const st = freeze(base());
  const bad = [
    { id: "nope", fromSec: "week", toSec: "week", toSub: "", anchor: "top" },
    { id: "a1", fromSec: "gone", toSec: "week", toSub: "", anchor: "top" },
    { id: "a1", fromSec: "week", toSec: "gone", toSub: "", anchor: "top" },
    { id: "a1", fromSec: "week", toSec: "week", toSub: "deleted-sub", anchor: "top" },
    { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: { id: "a1", side: "after" } },
    { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: { id: "missing", side: "before" } },
    { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: { id: "b1", side: "before" } }, // anchor in another list
    { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: "middle" },
    { id: "a1", fromSec: "week", toSec: "week", toSub: "" },
  ];
  for (const req of bad) assert.equal(placeItem(st, req), st, JSON.stringify(req));
  const dup = { ...st, items: { ...st.items, note: [...st.items.note, { id: "a1", text: "dup", done: false }] } };
  assert.equal(placeItem(dup, { id: "a1", fromSec: "week", toSec: "note", toSub: "", anchor: "top" }), dup);
});

test("results survive the model round trip byte for byte (older builds keep the order)", () => {
  const st = base();
  let out = placeItem(st, { id: "a3", fromSec: "week", toSec: "week", toSub: "bt", anchor: "top" });
  out = placeItem(out, { id: "b1", fromSec: "week", toSec: "buy", toSub: "", anchor: "top" });
  out = placeItem(out, { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: "end" });
  const s = serialize(out);
  assert.equal(serialize(migrate(JSON.parse(s))), s);
  assert.notEqual(s, serialize(st));
});

// ---------- subsections ----------
// week: subs bt, zz (collapsed), mid; buy: cart; note: "BT" (a case-insensitive clash with week's bt).
const subsBase = () => migrate({
  sections: [
    { key: "week", glyph: "‣", subs: [{ key: "bt", name: "BIG TICKET" }, { key: "zz", name: "FOLDED", collapsed: true }, { key: "mid", name: "MIDDLE" }] },
    { key: "buy", glyph: "🛒", subs: [{ key: "cart", name: "CART" }] },
    { key: "note", glyph: "🔦", subs: [{ key: "BT", name: "OTHER BT" }] },
  ],
  items: {
    week: [
      { id: "a1", text: "A1", done: false },
      { id: "b1", text: "B1", done: false, sub: "bt" },
      { id: "z1", text: "Z1", done: true, url: "https://example.com/z1", next: "n", sub: "zz" },
      { id: "b2", text: "B2", done: false, sub: "bt" },
      { id: "z2", text: "Z2", done: false, sub: "zz" },
    ],
    buy: [{ id: "c1", text: "C1", done: false, sub: "cart" }, { id: "u1", text: "U1", done: false }],
    note: [{ id: "n1", text: "N1", done: false, sub: "BT" }],
  },
  labels: { week: "THIS WEEK" }, collapsed: { note: true },
});
const subKeysOf = (st, sec) => st.sections.find((s) => s.key === sec).subs.map((x) => x.key);

test("placeSub reorders subsections within a section, both ways, touching nothing else", () => {
  const st = freeze(subsBase());
  const down = placeSub(st, { fromSec: "week", subKey: "bt", toSec: "week", anchor: { subKey: "mid", side: "after" } });
  assert.deepEqual(subKeysOf(down, "week"), ["zz", "mid", "bt"]);
  assert.equal(down.items, st.items, "items untouched by a reorder");
  assert.equal(down.sections[1], st.sections[1], "other sections are the same objects");
  const up = placeSub(down, { fromSec: "week", subKey: "bt", toSec: "week", anchor: { subKey: "zz", side: "before" } });
  assert.deepEqual(subKeysOf(up, "week"), ["bt", "zz", "mid"]);
  assert.equal(serialize(up), serialize(st));
  const end = placeSub(st, { fromSec: "week", subKey: "zz", toSec: "week", anchor: "end" });
  assert.deepEqual(subKeysOf(end, "week"), ["bt", "mid", "zz"]);
  assert.deepEqual(end.sections[0].subs[2], { key: "zz", name: "FOLDED", collapsed: true }, "collapse flag kept");
});

test("placeSub moves a subsection to another section with its items, in order", () => {
  const st = freeze(subsBase());
  const out = placeSub(st, { fromSec: "week", subKey: "zz", toSec: "buy", anchor: { subKey: "cart", side: "before" } });
  assert.deepEqual(subKeysOf(out, "buy"), ["zz", "cart"]);
  assert.deepEqual(subKeysOf(out, "week"), ["bt", "mid"]);
  assert.deepEqual(out.sections[1].subs[0], { key: "zz", name: "FOLDED", collapsed: true });
  assert.deepEqual(out.items.week.map((i) => i.id), ["a1", "b1", "b2"]);
  assert.deepEqual(out.items.buy.map((i) => i.id), ["c1", "u1", "z1", "z2"]);
  assert.deepEqual(out.items.buy[2], { id: "z1", text: "Z1", done: true, url: "https://example.com/z1", next: "n", sub: "zz" }, "every field travels");
  assert.deepEqual(list(out, "buy", "zz"), ["z1", "z2"]);
  assert.deepEqual(list(out, "buy"), ["u1"], "the target's main list is unchanged");
  assert.equal(out.items.note, st.items.note);
  assert.equal(out.labels, st.labels);
  assert.equal(out.collapsed, st.collapsed);
  const end = placeSub(st, { fromSec: "week", subKey: "mid", toSec: "buy", anchor: "end" });
  assert.deepEqual(subKeysOf(end, "buy"), ["cart", "mid"]);
  assert.deepEqual(end.items.week, st.items.week, "an empty subsection moves no items");
});

test("placeSub into a section that has no subsections", () => {
  const st = freeze(migrate({ ...subsBase(), sections: subsBase().sections.map((s) => (s.key === "buy" ? { ...s, subs: [] } : s)) }));
  const out = placeSub(st, { fromSec: "week", subKey: "bt", toSec: "buy", anchor: "end" });
  assert.deepEqual(subKeysOf(out, "buy"), ["bt"]);
  assert.deepEqual(list(out, "buy", "bt"), ["b1", "b2"]);
});

test("placeSub re-keys on a case-insensitive key clash and re-points the items", () => {
  const st = freeze(subsBase());
  const out = placeSub(st, { fromSec: "week", subKey: "bt", toSec: "note", anchor: "end", newKey: "u123" });
  assert.deepEqual(subKeysOf(out, "note"), ["BT", "u123"]);
  assert.deepEqual(out.sections[2].subs[1], { key: "u123", name: "BIG TICKET" });
  assert.deepEqual(list(out, "note", "u123"), ["b1", "b2"]);
  assert.deepEqual(list(out, "note", "BT"), ["n1"], "the resident subsection keeps its items");
  const s = serialize(out);
  assert.equal(serialize(migrate(JSON.parse(s))), s, "no clash left for migrate to repair");
  for (const newKey of [undefined, "", "BT", "bt", "bad key", "constructor"]) {
    assert.equal(placeSub(st, { fromSec: "week", subKey: "bt", toSec: "note", anchor: "end", newKey }), st, String(newKey));
  }
});

test("placeSub no-ops and stale requests return the same object", () => {
  const st = freeze(subsBase());
  const same = [
    { fromSec: "week", subKey: "bt", toSec: "week", anchor: { subKey: "zz", side: "before" } },
    { fromSec: "week", subKey: "zz", toSec: "week", anchor: { subKey: "bt", side: "after" } },
    { fromSec: "week", subKey: "mid", toSec: "week", anchor: "end" },
    { fromSec: "week", subKey: "bt", toSec: "week", anchor: { subKey: "bt", side: "after" } },
    { fromSec: "week", subKey: "gone", toSec: "buy", anchor: "end" },
    { fromSec: "gone", subKey: "bt", toSec: "buy", anchor: "end" },
    { fromSec: "week", subKey: "bt", toSec: "gone", anchor: "end" },
    { fromSec: "week", subKey: "bt", toSec: "buy", anchor: { subKey: "missing", side: "before" } },
    { fromSec: "week", subKey: "bt", toSec: "buy", anchor: { subKey: "zz", side: "before" } }, // anchor in another section
    { fromSec: "week", subKey: "bt", toSec: "buy", anchor: "top" },
    { fromSec: "week", subKey: "bt", toSec: "buy" },
  ];
  for (const req of same) assert.equal(placeSub(st, req), st, JSON.stringify(req));
});

test("promoteSub makes a section right after its own, named after the subsection", () => {
  const st = freeze(subsBase());
  const out = promoteSub(st, { sec: "week", subKey: "zz", newKey: "s123" });
  assert.deepEqual(out.sections.map((s) => s.key), ["week", "s123", "buy", "note"]);
  assert.deepEqual(out.sections[1], { key: "s123", glyph: "•", subs: [] });
  assert.deepEqual(subKeysOf(out, "week"), ["bt", "mid"]);
  assert.equal(out.labels.s123, "FOLDED");
  assert.equal(out.labels.week, "THIS WEEK");
  assert.equal(out.collapsed.s123, true, "a collapsed subsection becomes a collapsed section");
  assert.equal(out.collapsed.note, true);
  assert.deepEqual(out.items.s123, [{ id: "z1", text: "Z1", done: true, url: "https://example.com/z1", next: "n" }, { id: "z2", text: "Z2", done: false }]);
  assert.deepEqual(out.items.week.map((i) => i.id), ["a1", "b1", "b2"]);
  assert.equal(out.items.buy, st.items.buy);
  const open = promoteSub(st, { sec: "note", subKey: "BT", newKey: "s9" });
  assert.deepEqual(open.sections.map((s) => s.key), ["week", "buy", "note", "s9"]);
  assert.equal(open.collapsed, st.collapsed, "an open subsection leaves collapse state alone");
  const s = serialize(out);
  assert.equal(serialize(migrate(JSON.parse(s))), s);
});

test("promoteSub refuses at the section cap, for stale requests and for unusable keys", () => {
  const st = freeze(subsBase());
  const full = freeze(migrate({ ...subsBase(), sections: [...subsBase().sections, ...Array.from({ length: 7 }, (_, i) => ({ key: "x" + i, glyph: "•", subs: [] }))] }));
  assert.equal(full.sections.length, 10);
  assert.equal(promoteSub(full, { sec: "week", subKey: "bt", newKey: "s123" }), full);
  const bad = [
    { sec: "week", subKey: "gone", newKey: "s1" },
    { sec: "gone", subKey: "bt", newKey: "s1" },
    { sec: "week", subKey: "bt", newKey: "WEEK" },
    { sec: "week", subKey: "bt", newKey: "" },
    { sec: "week", subKey: "bt", newKey: "has space" },
    { sec: "week", subKey: "bt" },
  ];
  for (const req of bad) assert.equal(promoteSub(st, req), st, JSON.stringify(req));
});
