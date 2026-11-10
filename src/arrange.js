// Arrange mode's state changes: put an item at an exact spot in a list, move a
// subsection, or turn one into a section. Pure, no React. Each one rearranges
// fields that are already persisted (the order of items[sec] and of
// sections[].subs, item `sub`, a section entry with its label and collapse flag,
// the same shape the ⚙ "add new section" form creates), so no schema change is
// involved and older builds' migrate() keeps all of it.
import { MAX_SECTIONS, KEY_RE } from "./model.js";

// Which list an item renders in: its subsection if that still exists, else the
// section's main list (""). The UI's main-list filter uses this too.
export const groupOf = (it, subKeys) => (it.sub && subKeys.has(it.sub) ? it.sub : "");

// placeItem(state, { id, fromSec, toSec, toSub, anchor })
//   toSub:  "" = the section's main list, else a subsection key of toSec
//   anchor: { id, side: "before" | "after" }  next to an item of the target list
//           "top" | "end"                      first / last in the target list
// Positions are taken relative to the target list's own members, so array order
// stays sensible if a subsection is deleted later (its items rejoin the main
// list in array order). Returns the SAME object when nothing would visibly
// change or the request is stale (missing item, section, subsection or anchor),
// so the caller writes and syncs nothing.
export const placeItem = (st, { id, fromSec, toSec, toSub = "", anchor }) => {
  const src = st && st.items && st.items[fromSec];
  const dst = st && st.items && st.items[toSec];
  const sec = st && Array.isArray(st.sections) && st.sections.find((s) => s.key === toSec);
  if (!Array.isArray(src) || !Array.isArray(dst) || !sec) return st;
  const from = src.findIndex((it) => it.id === id);
  if (from < 0) return st;
  const subKeys = new Set((sec.subs || []).map((x) => x.key));
  if (toSub && !subKeys.has(toSub)) return st;
  if (fromSec !== toSec && dst.some((it) => it.id === id)) return st;

  const item = src[from];
  const without = src.filter((_, i) => i !== from);
  const target = fromSec === toSec ? without : dst;
  const inTarget = (it) => groupOf(it, subKeys) === toSub;

  let at;
  if (anchor && typeof anchor === "object") {
    if (anchor.id === id) return st;
    const a = target.findIndex((it) => it.id === anchor.id);
    if (a < 0 || !inTarget(target[a])) return st;
    at = anchor.side === "after" ? a + 1 : a;
  } else if (anchor === "top" || anchor === "end") {
    const members = [];
    target.forEach((it, i) => { if (inTarget(it)) members.push(i); });
    if (members.length) at = anchor === "top" ? members[0] : members[members.length - 1] + 1;
    else at = fromSec === toSec ? from : 0; // empty list: keep its slot, or go first like move()
  } else {
    return st;
  }

  const { sub: _old, ...rest } = item;
  const placed = toSub ? { ...rest, sub: toSub } : rest;
  const next = [...target.slice(0, at), placed, ...target.slice(at)];

  // Same list, same visible order → nothing to save.
  if (fromSec === toSec && groupOf(item, subKeys) === toSub) {
    const order = (arr) => arr.filter(inTarget).map((it) => it.id).join("\n");
    if (order(src) === order(next)) return st;
  }
  const items = { ...st.items, [toSec]: next };
  if (fromSec !== toSec) items[fromSec] = without;
  return { ...st, items };
};

// Keys are compared case-insensitively, like migrate(): a clash there would be
// re-keyed on load and the items would end up in the wrong subsection.
const clashes = (keys, key) => keys.some((k) => k.toLowerCase() === key.toLowerCase());
const freshKey = (key, keys) => typeof key === "string" && KEY_RE.test(key) && !(key in Object.prototype) && !clashes(keys, key);

// placeSub(state, { fromSec, subKey, toSec, anchor, newKey })
//   anchor: { subKey, side: "before" | "after" }  next to a subsection of toSec
//           "end"                                 after toSec's last subsection
//   newKey: used only when toSec already has a subsection with this key
// Within a section only sections[].subs is permuted. Across sections the
// subsection keeps its name and collapse flag, and its items (in order, with
// their `sub`) move from items[fromSec] to the end of items[toSec]. Returns the
// SAME object for a no-op or a stale request.
export const placeSub = (st, { fromSec, subKey, toSec, anchor, newKey }) => {
  const secs = st && Array.isArray(st.sections) ? st.sections : null;
  const from = secs && secs.find((s) => s.key === fromSec);
  const to = secs && secs.find((s) => s.key === toSec);
  if (!from || !to || !st.items || !Array.isArray(st.items[fromSec])) return st;
  const sub = (from.subs || []).find((x) => x.key === subKey);
  if (!sub) return st;
  const same = fromSec === toSec;
  const target = (to.subs || []).filter((x) => !(same && x.key === subKey));

  let at;
  if (anchor === "end") at = target.length;
  else if (anchor && typeof anchor === "object") {
    if (same && anchor.subKey === subKey) return st;
    const a = target.findIndex((x) => x.key === anchor.subKey);
    if (a < 0) return st;
    at = anchor.side === "after" ? a + 1 : a;
  } else return st;

  if (same) {
    const subs = [...target.slice(0, at), sub, ...target.slice(at)];
    if (subs.every((x, i) => x === from.subs[i])) return st;
    return { ...st, sections: secs.map((s) => (s.key === fromSec ? { ...s, subs } : s)) };
  }

  let key = subKey;
  if (clashes(target.map((x) => x.key), subKey)) {
    if (!freshKey(newKey, target.map((x) => x.key))) return st;
    key = newKey;
  }
  const moved = key === subKey ? sub : { ...sub, key };
  const subs = [...target.slice(0, at), moved, ...target.slice(at)];
  const travel = st.items[fromSec].filter((it) => it.sub === subKey).map((it) => (key === subKey ? it : { ...it, sub: key }));
  return {
    ...st,
    sections: secs.map((s) => (s.key === fromSec ? { ...s, subs: s.subs.filter((x) => x.key !== subKey) } : s.key === toSec ? { ...s, subs } : s)),
    items: { ...st.items, [fromSec]: st.items[fromSec].filter((it) => it.sub !== subKey), [toSec]: [...(st.items[toSec] || []), ...travel] },
  };
};

// promoteSub(state, { sec, subKey, newKey })
// The subsection becomes a section right after `sec`: key newKey, glyph "•",
// no subsections, labels[newKey] = its name, collapsed if it was. Its items
// move there in order and lose their `sub`. Returns the SAME object at
// MAX_SECTIONS or for a stale request or an unusable newKey.
export const promoteSub = (st, { sec, subKey, newKey }) => {
  const secs = st && Array.isArray(st.sections) ? st.sections : null;
  if (!secs || secs.length >= MAX_SECTIONS || !st.items || !Array.isArray(st.items[sec])) return st;
  const i = secs.findIndex((s) => s.key === sec);
  const sub = i < 0 ? null : (secs[i].subs || []).find((x) => x.key === subKey);
  if (!sub) return st;
  if (!freshKey(newKey, [...secs.map((s) => s.key), ...Object.keys(st.items)])) return st;
  const travel = st.items[sec].filter((it) => it.sub === subKey).map(({ sub: _s, ...rest }) => rest);
  const sections = [...secs.slice(0, i), { ...secs[i], subs: secs[i].subs.filter((x) => x.key !== subKey) }, { key: newKey, glyph: "•", subs: [] }, ...secs.slice(i + 1)];
  return {
    ...st,
    sections,
    items: { ...st.items, [sec]: st.items[sec].filter((it) => it.sub !== subKey), [newKey]: travel },
    labels: { ...st.labels, [newKey]: sub.name },
    collapsed: sub.collapsed ? { ...st.collapsed, [newKey]: true } : st.collapsed,
  };
};
