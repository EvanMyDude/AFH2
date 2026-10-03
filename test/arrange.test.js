import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, serialize } from "../src/model.js";
import { placeItem, groupOf } from "../src/arrange.js";

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
