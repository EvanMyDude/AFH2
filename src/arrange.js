// Arrange mode's one state change: put an item at an exact spot in a list.
// Pure, no React. Reordering is a permutation of items[sec] plus the item's
// `sub`, both of which are already persisted, so no schema change is involved.

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
