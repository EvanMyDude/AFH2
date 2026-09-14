import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, serialize, seed } from "../src/model.js";
import { applySeed, BIG_TICKET } from "../src/seed-big-ticket.js";

const legacy = () => migrate({
  sections: [{ key: "week", glyph: "‣" }, { key: "decision", glyph: "»" }, { key: "buy", glyph: "🛒" }, { key: "circleback", glyph: "∞" }, { key: "note", glyph: "🔦" }],
  items: {
    week: [{ id: "w1", text: "existing week item", done: false }],
    decision: [], buy: [],
    circleback: [{ id: "c1", text: "existing circle back item", done: false }],
    note: [{ id: "n1", text: "Notes don't matter. Fruits do 🍓", done: false }],
  },
  labels: {}, collapsed: {},
});

test("manifest has stable unique ids, no fabricated links, and no duplicate of the existing keeper", () => {
  const ids = BIG_TICKET.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((i) => /^bt-\d{3}$/.test(i)));
  for (const it of BIG_TICKET.items) {
    assert.ok(it.text.trim().length > 0);
    if (it.url) assert.equal(it.url, "https://www.youtube.com/playlist?list=WL");
  }
  assert.ok(!BIG_TICKET.items.some((i) => /^notes don't matter\. fruits do\.?$/i.test(i.text)));
  assert.equal(BIG_TICKET.items.length, 11 + 10 + 6 + 3 + 3 + 2 + 9 + 21 + 9);
});

test("applySeed creates the subsections, inserts THIS MONTH after THIS WEEK, appends items, keeps existing data", () => {
  const before = legacy();
  const out = applySeed(before);
  assert.deepEqual(out.sections.map((s) => s.key), ["week", "month", "decision", "buy", "circleback", "note"]);
  const subs = (k) => out.sections.find((s) => s.key === k).subs.map((x) => x.name);
  assert.deepEqual(subs("circleback"), ["SYSTEMS", "IDEAS WORTH A REAL LOOK", "BODY", "PEOPLE"]);
  assert.deepEqual(subs("week"), ["BIG TICKET"]);
  assert.deepEqual(subs("decision"), ["BIG TICKET"]);
  assert.deepEqual(subs("note"), ["NORTH STAR", "BIG TICKET"]);
  assert.deepEqual(subs("month"), []);
  assert.equal(out.items.week[0].id, "w1", "existing items stay first");
  assert.equal(out.items.circleback[0].id, "c1");
  assert.equal(out.items.circleback[0].sub, undefined, "existing items stay ungrouped");
  assert.equal(out.items.week.length, 1 + 11);
  assert.equal(out.items.month.length, 9);
  assert.equal(out.items.circleback.length, 1 + 6 + 3 + 3 + 2);
  assert.equal(out.items.note.length, 1 + 9 + 21);
  assert.ok(out.items.circleback.some((i) => i.url === "https://www.youtube.com/playlist?list=WL"));
  assert.ok(out.items.week.every((i) => i.done === false));
  assert.deepEqual(out.seeded, ["bigTicket"]);
  assert.equal(before.items.week.length, 1, "input not mutated");
});

test("applySeed twice equals once, and honors deletions of seeded items", () => {
  const once = applySeed(legacy());
  assert.equal(serialize(applySeed(once)), serialize(once));
  const pruned = { ...once, items: { ...once.items, week: once.items.week.filter((i) => i.id !== "bt-001") } };
  assert.equal(applySeed(pruned).items.week.length, once.items.week.length - 1);
});

test("applySeed appends a missing target section instead of throwing", () => {
  const st = legacy();
  st.sections = st.sections.filter((s) => s.key !== "circleback");
  delete st.items.circleback;
  const out = applySeed(st);
  assert.ok(out.sections.some((s) => s.key === "circleback"));
  assert.equal(out.items.circleback.length, 14);
});

test("applySeed on top of seed() survives a migrate round-trip byte-identically", () => {
  const s = applySeed(seed());
  assert.equal(serialize(s), serialize(migrate(JSON.parse(serialize(s)))));
});
