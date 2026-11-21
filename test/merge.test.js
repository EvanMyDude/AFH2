import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, serialize, seed } from "../src/model.js";
import { applySeed } from "../src/seed-big-ticket.js";
import { merge3, mergeOrder } from "../src/merge.js";
import { placeItem, placeSub, promoteSub } from "../src/arrange.js";

const base = () => migrate({
  sections: [
    { key: "week", glyph: "‣", subs: [{ key: "bt", name: "BIG TICKET" }, { key: "zz", name: "FOLDED", collapsed: true }] },
    { key: "buy", glyph: "🛒", subs: [] },
    { key: "note", glyph: "🔦", subs: [] },
    { key: "spare", glyph: "•", subs: [] },
  ],
  items: {
    week: [
      { id: "a1", text: "A1", done: false },
      { id: "b1", text: "B1", done: false, sub: "bt" },
      { id: "a2", text: "A2", done: false, next: "n2" },
      { id: "b2", text: "B2", done: false, sub: "bt" },
      { id: "a3", text: "A3", done: true, url: "https://example.com/3" },
    ],
    buy: [{ id: "c1", text: "C1", done: false }],
    note: [{ id: "n1", text: "N1", done: false }],
    spare: [],
  },
  labels: { week: "THIS WEEK" }, collapsed: {},
});
const freeze = (o) => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const S = (st) => serialize(st);
const ids = (st, sec) => st.items[sec].map((i) => i.id);
const item = (st, id) => { for (const k of Object.keys(st.items)) { const it = st.items[k].find((i) => i.id === id); if (it) return { ...it, sec: k }; } return null; };
// tiny edit helpers on clones
const edit = (st, fn) => { const c = clone(st); fn(c); return migrate(c); };
const setItem = (c, id, patch) => { for (const k of Object.keys(c.items)) c.items[k] = c.items[k].map((i) => (i.id === id ? { ...i, ...patch } : i)); };
const delItem = (c, id) => { for (const k of Object.keys(c.items)) c.items[k] = c.items[k].filter((i) => i.id !== id); };

test("identities: nothing changed locally → remote; nothing changed remotely → local", () => {
  const b = freeze(base());
  const r = freeze(edit(b, (c) => { c.items.week.unshift({ id: "x", text: "PHONE X", done: false }); setItem(c, "a2", { done: true }); }));
  const l = freeze(edit(b, (c) => { delItem(c, "c1"); c.collapsed.buy = true; }));
  assert.equal(S(merge3(b, b, r)), S(r));
  assert.equal(S(merge3(b, l, b)), S(l));
  assert.equal(S(merge3(b, b, b)), S(b));
});

test("the two-tab case: a stale copy with no edits takes the newer one whole; with an edit, both survive", () => {
  const b = freeze(base());
  const phone = freeze(edit(b, (c) => { c.items.week.unshift({ id: "x", text: "PHONE X", done: false }); }));
  assert.equal(S(merge3(b, b, phone)), S(phone));
  const tab = freeze(edit(b, (c) => { setItem(c, "a1", { done: true }); }));
  const m = merge3(b, tab, phone);
  assert.deepEqual(ids(m, "week"), ["x", "a1", "b1", "a2", "b2", "a3"]);
  assert.equal(item(m, "a1").done, true);
});

test("additions on both sides are kept, each next to its neighbour", () => {
  const b = freeze(base());
  const l = edit(b, (c) => { c.items.week.splice(2, 0, { id: "L", text: "local add", done: false }); }); // after b1
  const r = edit(b, (c) => { c.items.week.push({ id: "R", text: "remote add", done: false }); c.items.buy.unshift({ id: "R2", text: "r2", done: false }); });
  const m = merge3(b, l, r);
  assert.deepEqual(ids(m, "week"), ["a1", "b1", "L", "a2", "b2", "a3", "R"]);
  assert.deepEqual(ids(m, "buy"), ["R2", "c1"]);
});

test("a deletion wins over an untouched item, an edit wins over a deletion", () => {
  const b = freeze(base());
  const l = edit(b, (c) => { delItem(c, "a1"); delItem(c, "c1"); });
  const r = edit(b, (c) => { setItem(c, "c1", { text: "C1 edited" }); });
  const m = merge3(b, l, r);
  assert.equal(item(m, "a1"), null, "deleted locally, untouched remotely → gone");
  assert.equal(item(m, "c1").text, "C1 edited", "deleted locally, edited remotely → kept with the edit");
  const m2 = merge3(b, r, l); // mirrored
  assert.equal(item(m2, "a1"), null);
  assert.equal(item(m2, "c1").text, "C1 edited");
});

test("per field: different fields from both sides combine; the same field → local", () => {
  const b = freeze(base());
  const l = edit(b, (c) => { setItem(c, "a2", { text: "A2 local", done: true }); });
  const r = edit(b, (c) => { setItem(c, "a2", { text: "A2 remote", next: "n2 remote", url: "https://example.com/r" }); });
  const it = item(merge3(b, l, r), "a2");
  assert.deepEqual([it.text, it.done, it.next, it.url], ["A2 local", true, "n2 remote", "https://example.com/r"]);
  const cleared = edit(b, (c) => { setItem(c, "a2", { next: "" }); });
  assert.equal(item(merge3(b, cleared, b), "a2").next, undefined, "clearing a field is a change too");
});

test("a move on one side plus an edit on the other: moved, and edited", () => {
  const b = freeze(base());
  const l = placeItem(b, { id: "a2", fromSec: "week", toSec: "buy", toSub: "", anchor: "top" });
  const r = edit(b, (c) => { setItem(c, "a2", { text: "A2 remote" }); });
  const m = merge3(b, l, r);
  assert.deepEqual(ids(m, "buy"), ["a2", "c1"]);
  assert.equal(item(m, "a2").text, "A2 remote");
  assert.ok(!ids(m, "week").includes("a2"));
  const into = placeItem(b, { id: "a1", fromSec: "week", toSec: "week", toSub: "bt", anchor: "end" });
  assert.equal(item(merge3(b, into, r), "a1").sub, "bt");
});

test("order: one side's reorder wins; both reordered → remote's, with local additions placed", () => {
  const b = freeze(base());
  const l = placeItem(b, { id: "a3", fromSec: "week", toSec: "week", toSub: "", anchor: "top" });
  assert.deepEqual(ids(merge3(b, l, b), "week"), ids(l, "week"));
  const r = edit(b, (c) => { setItem(c, "a1", { done: true }); });
  assert.deepEqual(ids(merge3(b, l, r), "week"), ids(l, "week"), "remote only edited a field, local order stays");
  const r2 = placeItem(b, { id: "a1", fromSec: "week", toSec: "week", toSub: "", anchor: "end" });
  const l2 = edit(l, (c) => { c.items.week.splice(1, 0, { id: "L", text: "L", done: false }); }); // after a3
  const m = merge3(b, l2, r2);
  assert.deepEqual(ids(m, "week"), ["b1", "a2", "b2", "a3", "L", "a1"], "remote order, L after its local predecessor a3");
});

test("sections: adds, label and collapse changes combine; an empty section deleted on one side goes", () => {
  const b = freeze(base());
  const l = edit(b, (c) => { c.sections.push({ key: "snew", glyph: "★", subs: [] }); c.items.snew = [{ id: "s1", text: "S1", done: false }]; c.labels.snew = "NEW"; c.collapsed.week = true; });
  const r = edit(b, (c) => { c.labels.buy = "SHOPPING"; c.collapsed.note = true; c.sections = c.sections.filter((s) => s.key !== "spare"); delete c.items.spare; });
  const m = merge3(b, l, r);
  assert.deepEqual(m.sections.map((s) => s.key), ["week", "buy", "note", "snew"]);
  assert.equal(m.labels.snew, "NEW");
  assert.equal(m.labels.buy, "SHOPPING");
  assert.deepEqual(m.collapsed, { week: true, note: true });
  assert.deepEqual(ids(m, "snew"), ["s1"]);
});

test("a section deleted on one side but given an item on the other is kept", () => {
  const b = freeze(base());
  const l = edit(b, (c) => { c.sections = c.sections.filter((s) => s.key !== "spare"); delete c.items.spare; });
  const r = edit(b, (c) => { c.items.spare.push({ id: "sp", text: "kept", done: false }); });
  const m = merge3(b, l, r);
  assert.ok(m.sections.some((s) => s.key === "spare"));
  assert.deepEqual(ids(m, "spare"), ["sp"]);
});

test("subsections: add, rename, collapse, reorder and cross-section moves combine with item edits", () => {
  const b = freeze(base());
  const l = placeSub(b, { fromSec: "week", subKey: "bt", toSec: "buy", anchor: "end", newKey: "u1" });
  const r = edit(b, (c) => {
    setItem(c, "b1", { text: "B1 remote" });
    c.sections[0].subs.find((x) => x.key === "zz").name = "RENAMED";
    c.sections[2].subs.push({ key: "nn", name: "NOTE SUB" });
  });
  const m = merge3(b, l, r);
  const week = m.sections.find((s) => s.key === "week"), buy = m.sections.find((s) => s.key === "buy"), note = m.sections.find((s) => s.key === "note");
  assert.deepEqual(week.subs, [{ key: "zz", name: "RENAMED", collapsed: true }]);
  assert.deepEqual(buy.subs, [{ key: "bt", name: "BIG TICKET" }]);
  assert.deepEqual(note.subs, [{ key: "nn", name: "NOTE SUB" }]);
  assert.equal(item(m, "b1").sec, "buy");
  assert.equal(item(m, "b1").sub, "bt");
  assert.equal(item(m, "b1").text, "B1 remote");
});

test("promote on one side, edits inside it on the other", () => {
  const b = freeze(base());
  const l = promoteSub(b, { sec: "week", subKey: "bt", newKey: "sP" });
  const r = edit(b, (c) => { setItem(c, "b2", { done: true }); c.items.week.push({ id: "rb", text: "remote into bt", done: false, sub: "bt" }); });
  const m = merge3(b, l, r);
  assert.deepEqual(ids(m, "sP"), ["b1", "b2"]);
  assert.equal(item(m, "b2").done, true);
  // the remote's new item still points at bt in week, which local removed and nothing local re-added:
  // it is kept (never lost), its subsection kept with it
  assert.equal(item(m, "rb").sec, "week");
  assert.ok(m.sections.find((s) => s.key === "week").subs.some((x) => x.key === "bt"));
});

test("no base: a union that loses nothing, local fields and order first", () => {
  const b = base();
  const l = edit(b, (c) => { setItem(c, "a1", { text: "A1 local" }); delItem(c, "c1"); });
  const r = edit(b, (c) => { setItem(c, "a1", { text: "A1 remote" }); c.items.week.push({ id: "R", text: "R", done: false }); });
  const m = merge3(null, l, r);
  assert.equal(item(m, "a1").text, "A1 local");
  assert.ok(item(m, "c1"), "without a base a missing item is not a deletion");
  assert.ok(item(m, "R"));
});

test("inputs are not mutated; results survive the model round trip", () => {
  const b = freeze(base());
  const l = freeze(edit(b, (c) => { setItem(c, "a1", { done: true }); }));
  const r = freeze(edit(b, (c) => { c.items.week.unshift({ id: "x", text: "X", done: false }); }));
  const m = merge3(b, l, r);
  assert.equal(serialize(migrate(JSON.parse(S(m)))), S(m));
});

test("mergeOrder places entries only the other side has after their predecessor", () => {
  assert.deepEqual(mergeOrder(["a", "b", "c"], ["a", "x", "b", "c"], ["c", "a", "b"], new Set(["a", "b", "c", "x"])), ["c", "a", "x", "b"]);
  assert.deepEqual(mergeOrder([], ["x"], ["y"], new Set(["x", "y"])), ["x", "y"]);
});

// Fuzz on the real seed: random concurrent edits on both sides must never lose an item that either
// side added or edited, never resurrect one deleted on one side and untouched on the other, and always
// produce a state that round-trips.
test("fuzz: concurrent random edits never lose or resurrect items", () => {
  let seedN = 12345;
  const rand = () => ((seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648);
  const choose = (a) => a[Math.floor(rand() * a.length)];
  const b0 = applySeed(seed());
  for (let round = 0; round < 150; round++) {
    const b = freeze(clone(b0));
    const sideEdits = { added: new Set(), deleted: new Set(), touched: new Set() };
    const mutate = (st, tag, rec) => {
      const c = clone(st);
      for (let k = 0; k < 6; k++) {
        const secs = c.sections.map((s) => s.key);
        const sec = choose(secs);
        const list = c.items[sec];
        const op = rand();
        if (op < 0.25) { const id = `${tag}${round}_${k}`; list.splice(Math.floor(rand() * (list.length + 1)), 0, { id, text: id, done: false }); rec.added.add(id); }
        else if (op < 0.45 && list.length) { const i = Math.floor(rand() * list.length); rec.deleted.add(list[i].id); list.splice(i, 1); }
        else if (op < 0.7 && list.length) { const it = choose(list); it.done = !it.done; it.text += "*"; rec.touched.add(it.id); }
        else if (op < 0.85 && list.length) { const i = Math.floor(rand() * list.length); const [it] = list.splice(i, 1); const to = choose(secs); delete it.sub; c.items[to].splice(Math.floor(rand() * (c.items[to].length + 1)), 0, it); rec.touched.add(it.id); }
        else if (list.length > 1) { list.reverse(); }
      }
      return migrate(c);
    };
    const lr = { added: new Set(), deleted: new Set(), touched: new Set() };
    const rr = { added: new Set(), deleted: new Set(), touched: new Set() };
    const l = mutate(b, "L", lr), r = mutate(b, "R", rr);
    const m = merge3(b, l, r);
    const all = new Map();
    for (const k of Object.keys(m.items)) for (const it of m.items[k]) { assert.ok(!all.has(it.id), "duplicate id " + it.id); all.set(it.id, it); }
    for (const id of [...lr.added].filter((id) => !lr.deleted.has(id))) assert.ok(all.has(id), `round ${round}: local addition ${id} lost`);
    for (const id of [...rr.added].filter((id) => !rr.deleted.has(id))) assert.ok(all.has(id), `round ${round}: remote addition ${id} lost`);
    for (const id of lr.deleted) if (!lr.added.has(id) && !rr.touched.has(id)) assert.ok(!all.has(id), `round ${round}: ${id} deleted locally came back`);
    for (const id of rr.deleted) if (!rr.added.has(id) && !lr.touched.has(id)) assert.ok(!all.has(id), `round ${round}: ${id} deleted remotely came back`);
    for (const id of lr.touched) if (!lr.deleted.has(id)) assert.ok(all.has(id), `round ${round}: locally edited ${id} lost`);
    for (const id of rr.touched) if (!rr.deleted.has(id)) assert.ok(all.has(id), `round ${round}: remotely edited ${id} lost`);
    assert.equal(serialize(migrate(JSON.parse(serialize(m)))), serialize(m));
  }
});

test("seeded markers from both sides are kept (a seed applied on either device stays applied)", () => {
  const b = freeze(base());
  const l = freeze({ ...clone(b), seeded: ["one"] });
  const r = freeze({ ...clone(b), seeded: ["two"] });
  assert.deepEqual([...merge3(b, l, r).seeded].sort(), ["one", "two"]);
});
