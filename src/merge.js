// Three-way merge of two versions of the state that both grew from a common
// base: a tab whose stored copy was replaced by another tab, or a device whose
// gist was pushed to by another device. Pure, no React, no storage.
//
// merge3(base, local, remote) keeps remote's changes AND local's changes, each
// measured against base, instead of letting one whole copy overwrite the other.
// Inputs are migrated v4 states (cosmetic fields such as `fresh` are ignored);
// the result goes through migrate() so it is always a valid state. No field is
// added to the persisted shape.
//
//   items       by id (ids are unique across the state). Per field (section,
//               subsection, text, done, link, next step) the side that changed
//               it wins; if both did, local wins. An item added on either side
//               is kept. A deletion wins only if the other side left the item
//               unchanged; an edit beats a deletion.
//   order       per list (a section's items, a section's subsections, the
//               sections): the side that reordered relative to base gives the
//               order (remote if both did); entries only the other side has go
//               right after their predecessor on that side.
//   sections,   by key, the same presence rule as items; a section or
//   subsections subsection that still holds an item is never dropped. Glyph,
//               label, collapse and subsection name are merged per field.
//   seeded      union.
//
// base === null (nothing known in common): a union of both sides that never
// drops anything; local's fields and order win.
import { migrate } from "./model.js";

const EMPTY = { sections: [], items: {}, labels: {}, collapsed: {}, seeded: [] };
const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const ITEM_FIELDS = ["sec", "text", "done", "url", "next", "sub"];

// id → flat record { sec, text, done, url, next, sub } ("" for absent strings)
const itemRecords = (st) => {
  const m = new Map();
  for (const s of st.sections || []) {
    for (const it of (st.items && st.items[s.key]) || []) {
      if (!it || m.has(it.id)) continue;
      m.set(it.id, { id: it.id, sec: s.key, text: it.text || "", done: !!it.done, url: it.url || "", next: it.next || "", sub: it.sub || "" });
    }
  }
  return m;
};
const listOf = (st, sec) => ((st.items && st.items[sec]) || []).map((it) => it.id);
const sectionRecords = (st) => {
  const m = new Map();
  for (const s of st.sections || []) {
    m.set(s.key, {
      key: s.key,
      glyph: s.glyph,
      label: has(st.labels, s.key) ? st.labels[s.key] : "",
      collapsed: !!(st.collapsed && st.collapsed[s.key]),
      subs: new Map((s.subs || []).map((x) => [x.key, { key: x.key, name: x.name, collapsed: !!x.collapsed }])),
      subOrder: (s.subs || []).map((x) => x.key),
    });
  }
  return m;
};

const same = (a, b, fields) => fields.every((f) => a[f] === b[f]);
// one field, three ways: the side that changed it wins; both → local
const pick = (b, l, r, f) => (b === undefined ? l[f] : l[f] !== b[f] ? l[f] : r[f]);

// Presence of one keyed entry. Returns "local" | "remote" | "both" | null (dropped).
const presence = (inB, inL, inR, changedL, changedR) => {
  if (inL && inR) return "both";
  if (inL) return !inB || changedL ? "local" : null;   // added locally, or edited locally while deleted remotely
  if (inR) return !inB || changedR ? "remote" : null;
  return null;
};

// Order of one list. `keep` = the ids that belong in the result.
export const mergeOrder = (baseList, localList, remoteList, keep, localFirst = false) => {
  const reordered = (side) => {
    const inBoth = new Set(side.filter((id) => baseList.includes(id)));
    const a = baseList.filter((id) => inBoth.has(id));
    const b = side.filter((id) => inBoth.has(id));
    return a.some((id, i) => id !== b[i]);
  };
  const useLocal = localFirst || (reordered(localList) && !reordered(remoteList));
  const primary = useLocal ? localList : remoteList;
  const secondary = useLocal ? remoteList : localList;
  const out = primary.filter((id) => keep.has(id));
  const placed = new Set(out);
  let prev = null;
  for (const id of secondary) {
    if (placed.has(id)) { prev = id; continue; }
    if (!keep.has(id)) continue;
    const at = prev === null ? 0 : out.indexOf(prev) + 1;
    out.splice(at, 0, id);
    placed.add(id);
    prev = id;
  }
  for (const id of keep) if (!placed.has(id)) out.push(id); // safety: never lose one
  return out;
};

export const merge3 = (base0, local, remote) => {
  const noBase = !base0;
  const base = base0 || EMPTY;
  const B = itemRecords(base), L = itemRecords(local), R = itemRecords(remote);

  // ---- items: presence + per-field values ----
  const items = new Map(); // id → record
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    const who = presence(!!b, !!l, !!r, l && b && !same(l, b, ITEM_FIELDS), r && b && !same(r, b, ITEM_FIELDS));
    if (who === "local") items.set(id, l);
    else if (who === "remote") items.set(id, r);
    else if (who === "both") {
      const rec = { id };
      for (const f of ITEM_FIELDS) rec[f] = noBase ? l[f] : pick(b, l, r, f);
      items.set(id, rec);
    }
  }

  // ---- sections and subsections ----
  const SB = sectionRecords(base), SL = sectionRecords(local), SR = sectionRecords(remote);
  const used = new Set([...items.values()].map((it) => it.sec));
  const usedSub = new Set([...items.values()].filter((it) => it.sub).map((it) => it.sec + "/" + it.sub));
  const SEC_FIELDS = ["glyph", "label", "collapsed"];
  const SUB_FIELDS = ["name", "collapsed"];
  const sections = new Map();
  for (const key of new Set([...SL.keys(), ...SR.keys()])) {
    const b = SB.get(key), l = SL.get(key), r = SR.get(key);
    const subsChanged = (x) => x && b && (x.subOrder.join("\n") !== b.subOrder.join("\n") || [...x.subs.values()].some((s) => !b.subs.has(s.key) || !same(s, b.subs.get(s.key), SUB_FIELDS)));
    let who = presence(!!b, !!l, !!r, l && b && (!same(l, b, SEC_FIELDS) || subsChanged(l)), r && b && (!same(r, b, SEC_FIELDS) || subsChanged(r)));
    if (!who && used.has(key)) who = l ? "local" : "remote"; // still holds an item: never dropped
    if (!who) continue;
    const rec = who === "both" ? { key } : { ...(who === "local" ? l : r) };
    if (who === "both") for (const f of SEC_FIELDS) rec[f] = noBase ? l[f] : pick(b, l, r, f);
    // subsections of this section
    const bs = (b && b.subs) || new Map(), ls = (l && l.subs) || new Map(), rs = (r && r.subs) || new Map();
    const subs = new Map();
    for (const sk of new Set([...ls.keys(), ...rs.keys()])) {
      const sb = bs.get(sk), sl = ls.get(sk), sr = rs.get(sk);
      let sw = presence(!!sb, !!sl, !!sr, sl && sb && !same(sl, sb, SUB_FIELDS), sr && sb && !same(sr, sb, SUB_FIELDS));
      if (!sw && usedSub.has(key + "/" + sk)) sw = sl ? "local" : "remote";
      if (!sw) continue;
      if (sw === "both") {
        const s = { key: sk };
        for (const f of SUB_FIELDS) s[f] = noBase ? sl[f] : pick(sb, sl, sr, f);
        subs.set(sk, s);
      } else subs.set(sk, sw === "local" ? sl : sr);
    }
    rec.subOrder = mergeOrder((b && b.subOrder) || [], (l && l.subOrder) || [], (r && r.subOrder) || [], new Set(subs.keys()), noBase);
    rec.subs = subs;
    sections.set(key, rec);
  }
  // an item whose section vanished on both sides (can't happen through the UI) keeps a home: the remote's or local's section
  for (const it of items.values()) {
    if (sections.has(it.sec)) continue;
    const src = SL.get(it.sec) || SR.get(it.sec);
    if (src) sections.set(it.sec, { ...src, subOrder: src.subOrder.slice(), subs: new Map(src.subs) });
  }
  const order = mergeOrder(
    (base.sections || []).map((s) => s.key), (local.sections || []).map((s) => s.key), (remote.sections || []).map((s) => s.key),
    new Set(sections.keys()), noBase,
  );

  // ---- item order per section ----
  const raw = { v: 4, sections: [], items: {}, labels: {}, collapsed: {}, seeded: [] };
  for (const key of order) {
    const s = sections.get(key);
    raw.sections.push({ key, glyph: s.glyph, subs: s.subOrder.map((sk) => { const x = s.subs.get(sk); return x.collapsed ? { key: sk, name: x.name, collapsed: true } : { key: sk, name: x.name }; }) });
    if (s.label) raw.labels[key] = s.label;
    if (s.collapsed) raw.collapsed[key] = true;
    const keep = new Set([...items.values()].filter((it) => it.sec === key).map((it) => it.id));
    const ids = mergeOrder(listOf(base, key), listOf(local, key), listOf(remote, key), keep, noBase);
    raw.items[key] = ids.map((id) => {
      const it = items.get(id);
      const o = { id, text: it.text, done: it.done };
      if (it.url) o.url = it.url;
      if (it.next) o.next = it.next;
      if (it.sub) o.sub = it.sub;
      return o;
    });
  }
  raw.seeded = [...new Set([...(remote.seeded || []), ...(local.seeded || [])])];
  return migrate(raw);
};

// ---------- sync history: compare a saved version with now, put items back ----------

// How a saved version differs from the current state, item by item:
//   missing: items the version had that are gone now
//   changed: items in both whose text, done, link, next step, section or subsection differ
//   added:   items that are here now but weren't in the version
// Each entry: { id, then, now } with flat records { sec, sub, text, done, url, next } (absent side = null),
// in the order the version (missing, changed) or the current state (added) lists them.
export const diffVersion = (current, version) => {
  const C = itemRecords(current), V = itemRecords(version);
  const out = { missing: [], changed: [], added: [] };
  for (const [id, v] of V) {
    const c = C.get(id);
    if (!c) out.missing.push({ id, then: v, now: null });
    else if (!same(c, v, ITEM_FIELDS)) out.changed.push({ id, then: v, now: c });
  }
  for (const [id, c] of C) if (!V.has(id)) out.added.push({ id, then: null, now: c });
  return out;
};

// Put the chosen items back the way the version had them, on top of the current
// state (never a whole-state restore): a missing item is re-inserted, a changed
// one gets the version's text, done, link, next step and place. Its place is the
// version's section when that still exists, else the catch-all; its subsection
// only if that section still has it; its position right after the item that
// preceded it in the version, when that item is still in the same list,
// else first. Ids that aren't missing or changed are ignored.
export const restoreItems = (current, version, ids) => {
  const want = new Set(ids);
  const C = itemRecords(current), V = itemRecords(version);
  const secs = new Map((current.sections || []).map((s) => [s.key, new Set((s.subs || []).map((x) => x.key))]));
  const keys = [...secs.keys()];
  const fallback = keys.includes("note") ? "note" : keys[keys.length - 1];
  const items = Object.fromEntries(keys.map((k) => [k, ((current.items && current.items[k]) || []).slice()]));
  let touched = 0;
  for (const id of want) {
    const v = V.get(id), c = C.get(id);
    if (!v || (c && same(c, v, ITEM_FIELDS)) || !fallback) continue;
    if (c) items[c.sec] = items[c.sec].filter((it) => it.id !== id);
    const sec = secs.has(v.sec) ? v.sec : fallback;
    const rec = { id, text: v.text, done: v.done };
    if (v.url) rec.url = v.url;
    if (v.next) rec.next = v.next;
    if (sec === v.sec && v.sub && secs.get(sec).has(v.sub)) rec.sub = v.sub;
    const order = listOf(version, v.sec);
    const before = order.slice(0, order.indexOf(id)).reverse().find((p) => items[sec].some((it) => it.id === p));
    const at = before ? items[sec].findIndex((it) => it.id === before) + 1 : 0;
    items[sec].splice(at, 0, rec);
    touched++;
  }
  return touched ? migrate({ ...current, items }) : current;
};
