import { test } from "node:test";
import assert from "node:assert/strict";
import {
  migrate, serialize, seed, catchAllKey, safeHref, clampSavedAt,
  DEFAULT_SECTIONS, MAX_SECTIONS, firstGrapheme,
} from "../src/model.js";

const v3 = () => ({
  sections: [{ key: "week", glyph: "‣" }, { key: "buy", glyph: "🛒" }, { key: "note", glyph: "🔦" }, { key: "sabc12", glyph: "✦" }],
  items: {
    week: [{ id: "a1", text: "call Dr. K", done: false, url: "https://example.com/x", next: "book slot" }],
    buy: [{ id: "b1", text: "book ends", done: true, fresh: true }],
    note: [{ id: "n1", text: "Notes don't matter. Fruits do 🍓", done: false }],
    sabc12: [{ id: "c1", text: "custom section item", done: false }],
  },
  labels: { sabc12: "MY CUSTOM", week: "THIS WEEK RENAMED" },
  collapsed: { buy: true, week: false },
});

test("migrate v3 → v4 keeps every item, label, url, next, glyph and collapse state", () => {
  const out = migrate(v3());
  assert.equal(out.v, 4);
  assert.deepEqual(out.sections.map((s) => s.key), ["week", "buy", "note", "sabc12"]);
  assert.deepEqual(out.sections.map((s) => s.glyph), ["‣", "🛒", "🔦", "✦"]);
  assert.deepEqual(out.sections.map((s) => s.subs), [[], [], [], []]);
  assert.deepEqual(out.items.week[0], { id: "a1", text: "call Dr. K", done: false, url: "https://example.com/x", next: "book slot" });
  assert.deepEqual(out.items.buy[0], { id: "b1", text: "book ends", done: true }); // fresh stripped
  assert.equal(out.items.sabc12[0].text, "custom section item");
  assert.deepEqual(out.labels, { sabc12: "MY CUSTOM", week: "THIS WEEK RENAMED" });
  assert.deepEqual(out.collapsed, { buy: true });
  assert.deepEqual(out.seeded, []);
});

test("migrate v4 passes subsections and item.sub through", () => {
  const raw = { ...migrate(v3()), seeded: ["bigTicket"] };
  raw.sections[0].subs = [{ key: "bt-week", name: "BIG TICKET", collapsed: true }];
  raw.items.week.push({ id: "a2", text: "in sub", done: false, sub: "bt-week" });
  const out = migrate(raw);
  assert.deepEqual(out.sections[0].subs, [{ key: "bt-week", name: "BIG TICKET", collapsed: true }]);
  assert.equal(out.items.week[1].sub, "bt-week");
  assert.deepEqual(out.seeded, ["bigTicket"]);
});

test("migrate drops a dangling item.sub but keeps the item", () => {
  const raw = migrate(v3());
  raw.items.week.push({ id: "a2", text: "orphan sub ref", done: false, sub: "nope" });
  const out = migrate(raw);
  assert.equal(out.items.week.length, 2);
  assert.equal(out.items.week[1].sub, undefined);
});

test("migrate v2 (no sections) seeds default sections and keeps items", () => {
  const raw = { items: { week: [{ id: "w", text: "hi", done: false }], decision: [] }, labels: {}, collapsed: {} };
  const out = migrate(raw);
  assert.deepEqual(out.sections.map((s) => s.key), DEFAULT_SECTIONS.map((s) => s.key));
  assert.equal(out.items.week[0].text, "hi");
  assert.deepEqual(out.items.buy, []);
});

test("migrate v1 (flat buckets) keeps items", () => {
  const out = migrate({ week: [{ id: "w", text: "hi", done: false }], note: [{ id: "n", text: "m", done: false }] });
  assert.equal(out.items.week[0].text, "hi");
  assert.equal(out.items.note[0].text, "m");
});

test("migrate recovers an orphan item bucket as a section instead of dropping it", () => {
  const raw = v3();
  raw.items.ghost = [{ id: "g1", text: "I must survive", done: false }];
  raw.labels.ghost = "GHOST";
  const out = migrate(raw);
  const sec = out.sections.find((s) => s.key === "ghost");
  assert.ok(sec, "orphan bucket became a section");
  assert.equal(sec.glyph, "•");
  assert.equal(out.items.ghost[0].text, "I must survive");
  assert.equal(out.labels.ghost, "GHOST");
});

test("migrate keeps a section with a blank glyph (defaults to •) and its items", () => {
  const raw = v3();
  raw.sections[1].glyph = "";
  const out = migrate(raw);
  assert.equal(out.sections[1].glyph, "•");
  assert.equal(out.items.buy.length, 1);
});

test("migrate remaps hostile section keys and keeps their items", () => {
  const raw = v3();
  raw.sections.push({ key: "__proto__", glyph: "x" }, { key: "a/b", glyph: "y" });
  raw.items["a/b"] = [{ id: "s1", text: "slash key item", done: false }];
  const out = migrate(raw);
  for (const s of out.sections) assert.match(s.key, /^[a-z0-9][a-z0-9_-]{0,31}$/i);
  const all = Object.values(out.items).flat().map((i) => i.text);
  assert.ok(all.includes("slash key item"));
});

test("migrate coerces non-string fields and caps lengths", () => {
  const raw = v3();
  raw.items.week.push({ id: 7, text: { evil: true }, done: "yes", next: 12, url: "x".repeat(5000) });
  raw.labels.week = { evil: 1 };
  const out = migrate(raw);
  const it = out.items.week[1];
  assert.equal(typeof it.id, "string");
  assert.equal(typeof it.text, "string");
  assert.equal(it.done, true);
  assert.equal(it.next, "12");
  assert.equal(it.url.length, 2048);
  assert.equal(typeof out.labels.week, "string");
});

test("migrate regenerates missing or duplicate item ids", () => {
  const raw = v3();
  raw.items.week.push({ id: "a1", text: "dup id", done: false }, { text: "no id", done: false });
  const out = migrate(raw);
  const ids = out.items.week.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((i) => typeof i === "string" && i.length > 0));
});

test("migrate caps recovered orphan sections at MAX_SECTIONS + 1 and folds the rest into the catch-all", () => {
  const raw = v3();
  for (let i = 0; i < 20; i++) raw.items["orphan" + i] = [{ id: "o" + i, text: "orphan " + i, done: false }];
  const out = migrate(raw);
  assert.ok(out.sections.length <= MAX_SECTIONS + 1);
  const all = Object.values(out.items).flat().length;
  assert.equal(all, 4 + 20, "no items lost");
});

test("migrate prunes collapsed keys for dead sections and stores only trues", () => {
  const raw = v3();
  raw.collapsed = { buy: true, dead: true, week: false };
  const out = migrate(raw);
  assert.deepEqual(out.collapsed, { buy: true });
});

test("serialize(migrate(x)) is idempotent and strips fresh", () => {
  const once = serialize(migrate(v3()));
  const twice = serialize(migrate(JSON.parse(once)));
  assert.equal(once, twice);
  assert.ok(!once.includes("fresh"));
  assert.ok(once.startsWith('{"v":4,'));
});

test("seed() returns a v4 state with the five default sections and items", () => {
  const s = seed();
  assert.equal(s.v, 4);
  assert.deepEqual(s.sections.map((x) => x.key), ["week", "decision", "buy", "circleback", "note"]);
  assert.ok(s.items.week.length > 0);
  assert.equal(serialize(s), serialize(migrate(JSON.parse(serialize(s)))));
});

test("catchAllKey prefers note, else the last section", () => {
  assert.equal(catchAllKey([{ key: "note" }, { key: "week" }]), "note");
  assert.equal(catchAllKey([{ key: "week" }, { key: "buy" }]), "buy");
  assert.equal(catchAllKey([]), null);
});

test("safeHref allows http/https/mailto only and never rewrites", () => {
  assert.equal(safeHref("https://a.co/x"), "https://a.co/x");
  assert.equal(safeHref("http://a.co"), "http://a.co");
  assert.equal(safeHref("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("JavaScript:alert(1)"), null);
  assert.equal(safeHref("java\tscript:alert(1)"), null);
  assert.equal(safeHref(" \njavascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,hi"), null);
  assert.equal(safeHref("shortcuts://run"), null);
  assert.equal(safeHref("a.co/x"), null);
  assert.equal(safeHref(""), null);
  assert.equal(safeHref(undefined), null);
});

test("clampSavedAt rejects unsafe, negative, non-number and far-future values", () => {
  const now = Date.now();
  assert.equal(clampSavedAt(now), now);
  assert.equal(clampSavedAt(0), 0);
  assert.equal(clampSavedAt(1), 1);
  assert.equal(clampSavedAt(9007199254740991), null);
  assert.equal(clampSavedAt(now + 60 * 60 * 1000), null);
  assert.equal(clampSavedAt(-5), null);
  assert.equal(clampSavedAt("123"), null);
  assert.equal(clampSavedAt(NaN), null);
  assert.equal(clampSavedAt(1.5), null);
});

test("firstGrapheme returns one grapheme cluster", () => {
  assert.equal(firstGrapheme("❤️‍🔥ab"), "❤️‍🔥");
  assert.equal(firstGrapheme(""), "");
});
