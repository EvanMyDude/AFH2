// "DROP ZONE — Big Ticket" (big ticket.pdf, Sep 13 2026), transcribed verbatim.
// Applied ONCE on top of whatever data the user already has (see applySeed).
// Ids are stable so two devices seeding independently produce identical blobs
// and a deleted seed item never comes back. "EVERYTHING ELSE" is intentionally absent.
import { SECTION_META } from "./model.js";

const G = {
  btWeek: { sec: "week", key: "bt-week", name: "BIG TICKET" },
  btDecision: { sec: "decision", key: "bt-decision", name: "BIG TICKET" },
  systems: { sec: "circleback", key: "cb-systems", name: "SYSTEMS" },
  ideas: { sec: "circleback", key: "cb-ideas", name: "IDEAS WORTH A REAL LOOK" },
  body: { sec: "circleback", key: "cb-body", name: "BODY" },
  people: { sec: "circleback", key: "cb-people", name: "PEOPLE" },
  northStar: { sec: "note", key: "ns-note", name: "NORTH STAR" },
  btNote: { sec: "note", key: "bt-note", name: "BIG TICKET" },
  month: { sec: "month", key: null, name: null }, // top-level section, no subsection
};

const I = (g, text, next, url) => ({ g, text, next, url });

const RAW = [
  // THIS WEEK → week › BIG TICKET
  I(G.btWeek, "Start the 10-minute body timer — every other day, in front of the mirror, no self-hate", "Neal's program or the Notion body-journey page. Intent over intensity."),
  I(G.btWeek, "Five-minute timed prayer — no reflection back on self", "\"Lord I give myself to you completely.\""),
  I(G.btWeek, "Testimony × Mission: \"either way, let's pray.\"", "You flagged this THIS WEEK yourself."),
  I(G.btWeek, "Pick one person to reach out to and go first", "Say happy birthday, check in."),
  I(G.btWeek, "Set the bedtime — one fixed time, phone out of the bed", "\"2 a.m.?\" — that's the decision; see DECISIONS TO CLOSE."),
  I(G.btWeek, "Top 3 priorities each morning — block the day, one task at a time"),
  I(G.btWeek, "Nightly #zzz: what went well, what did not, what would I change"),
  I(G.btWeek, "Hinge: sniper mode — the roster exists", "Transition fast, commit, meet in person before the shot is missed."),
  I(G.btWeek, "Core circuit, week 1 of 4", "Hanging leg raises · alternating side knee raises · hill climbers (3×10). Exhale hard on the crunch."),
  I(G.btWeek, "Send the work email after lunch", "Monday, from the whiteboard."),
  I(G.btWeek, "Daily tongue drill: tip behind the front teeth at 1:00", "Release the mid-back tongue without jaw jutting. 60 seconds, a few times a day."),
  // DECISIONS TO CLOSE → decision › BIG TICKET
  I(G.btDecision, "Bedtime: what time, exactly?"),
  I(G.btDecision, "Cover up the tat, or not."),
  I(G.btDecision, "Take Gw out of the IG bio?", "With Holy Spirit as guide."),
  I(G.btDecision, "Accountability scoreboard: am I actually doing it?", "If yes, when does it start?"),
  I(G.btDecision, "Sorted and Gemini 2: done with them?", "And is one month of Claude next quarter worth a hundo?"),
  I(G.btDecision, "Notion PDF reading: in Notion, or CircleBack?"),
  I(G.btDecision, "Two jobs: keep crawling, or pivot?", "Set the tripwire that tells you it's too much."),
  I(G.btDecision, "Hyenas: offer to work free on weekends, or not?", "The real question is what you're doing with that time otherwise. (Escape room job also on the table.)"),
  I(G.btDecision, "Which program is \"THIS\" (Week 1 Day 2)?", "Name it and schedule day 3, or drop it."),
  I(G.btDecision, "Shrooms: when, and with whom?", "Mr. Mendoza?"),
  // CIRCLE BACK › SYSTEMS
  I(G.systems, "Brave Notion migration", "See Raycast notes."),
  I(G.systems, "Clean up note tags into proper smart folders", "Use collapsible headers more."),
  I(G.systems, "Build the \"notes to self / reminders / best wisdom\" Notion page", "Put a quarterly re-read on the calendar."),
  I(G.systems, "Add \"what cognitive bias am I unaware of right now?\" to the self-check PDF prompt", "Improve the prompt-engineer workflow."),
  I(G.systems, "Sort YouTube Watch Later into playlist buckets", "Split body / PRI / mobility. You marked this \"not urgent.\"", "https://www.youtube.com/playlist?list=WL"),
  I(G.systems, "Cornerstone Landmark Alarms for the bedtime cut-off"),
  // CIRCLE BACK › IDEAS WORTH A REAL LOOK
  I(G.ideas, "Yelp for oil and gas title brokers", "Reviews and ratings so companies know who does good work. Seed the database by scraping — Directory Bro's workflow."),
  I(G.ideas, "Automated print-and-mail for mineral interest offers", "Burner number tied to an AI voice-answering service."),
  I(G.ideas, "Coach women a skill", "Pickleball, dancing, what else?"),
  // CIRCLE BACK › BODY
  I(G.body, "Finish the body-lab rotation hypothesis: upper body wants to turn left, lower body right", "Test it, don't just note it."),
  I(G.body, "Actually learn anatomy (levator scap, supraspinatus, upper trap)", "Instead of collecting cues."),
  I(G.body, "Why were the arms so far forward at TSA?", "Find the cue."),
  // CIRCLE BACK › PEOPLE
  I(G.people, "Find mentors to actually look up to and rub elbows with"),
  I(G.people, "Practice social stories out loud", "Level up storytelling."),
  // NORTH STAR → note › NORTH STAR
  I(G.northStar, "Love God. Love people. Do what's right.", "Going through all of this to serve the Kingdom fruitfully, for God and his people, not only for me. Fruits, not notes."),
  I(G.northStar, "Relationships are all that matters.", "Be the person who makes everyone around him feel valued. Attention curved outward, not inward."),
  I(G.northStar, "Identity: bold adventurer with nothing to lose.", "Someone who keeps promises to himself. Not damaged goods. Every right to be here."),
  I(G.northStar, "Fix the signal.", "Correct the sensory input from feet, eyes, and jaw. The surgery opened the door; walk through it: better sleep, less tension, more consistency, a better speaking voice."),
  I(G.northStar, "Two non-negotiables: movement every day, relationships every day."),
  I(G.northStar, "Simple = sustainable.", "Small wins, small steps, start small and build to the vision. Do less; when you do something, all in."),
  I(G.northStar, "Get out of the 7th and Tom Thumb routine.", "Be the man it takes. Channel the rage into power. Wife fuel."),
  I(G.northStar, "Less screen than sleep.", "Flip the 284-vs-217 hours."),
  I(G.northStar, "Long term: yoga or tai chi for clarity, climbing for adventure, small-group missions."),
  // KEEPERS → note › BIG TICKET  ("Notes don't matter. Fruits do." omitted — already a keeper)
  I(G.btNote, "Keep the promises you make to yourself. Failure is feedback."),
  I(G.btNote, "Nothing great happens by accident. You have to commit."),
  I(G.btNote, "Do less. Most things don't work. When you do something, go all in."),
  I(G.btNote, "Lessons are not lessons if you do not use them."),
  I(G.btNote, "If everything is important, nothing is. Knowing is not enough. Skill stack."),
  I(G.btNote, "Open loops cost more than wrong answers."),
  I(G.btNote, "Anxiety = lack of reps."),
  I(G.btNote, "Learning = repeated recall, not repeated exposure. No recall, no ball."),
  I(G.btNote, "You can't monitor yourself and be present for someone else at the same time."),
  I(G.btNote, "Pride = attention habitually curved inwards. Ask instead: did I give one person real attention today?"),
  I(G.btNote, "The real you shows up not when the fear goes away, but when you love someone enough to forget about yourself."),
  I(G.btNote, "People's walls come down fast when they feel seen and respected."),
  I(G.btNote, "A lot of success is simply knowing how to ask the right way."),
  I(G.btNote, "Stuff swells to however much time we have for it. Sleep > supplements."),
  I(G.btNote, "Stop trying to one-shot everything. Embrace the process. This is the way."),
  I(G.btNote, "The goal is not to fix yourself. Understand your trade-offs and put yourself in the environment that maximizes them."),
  I(G.btNote, "Suffering is a choice. Choose your experience."),
  I(G.btNote, "Just because I have it does not mean I have to use it. I won't have it if I abuse it."),
  I(G.btNote, "How would someone with nothing to lose act in this very moment?"),
  I(G.btNote, "What does the world need from me right now?"),
  I(G.btNote, "What voice am I following right now?"),
  // THIS MONTH → new top-level section `month`
  I(G.month, "Complete the four-week core cycle — one circuit per week", "Then start the TVA / oblique progression from 90/90 breathing forward. Stop any set when the low back arches, ribs flare, or hips twist."),
  I(G.month, "LLF Movement #1 daily: two minutes of breathing at a 5/10 stretch, hips back over the second toe", "Plus tromboning (10 reps) and left-side sleeping."),
  I(G.month, "Make the body timer a habit", "15 sessions by month end."),
  I(G.month, "Re-run the 30-day screen audit", "Target: laptop hours down by a third. Compare to 284."),
  I(G.month, "Join a yoga or tai chi class", "Get to climbing at least once, maybe with Vic after PB."),
  I(G.month, "Write the 5 things for each important goal", "Outcome, target inputs, output measures, minimum floor, review point. Set the floor, then walk backwards from the equation."),
  I(G.month, "Clear the reading queue, items 6 through 10", "Nov, Dec, Jan PDFs, the PRI page, the dating and style playbook."),
  I(G.month, "Self-test everything you're learning away from the source material", "No recall, no ball."),
  I(G.month, "Four weeks of reaching out first: one person a week, minimum", "Check in, say happy birthday, ask a question instead of picking a fight."),
];

export const BIG_TICKET = {
  flag: "bigTicket",
  // subsection definitions in display order, per section
  subs: [G.btWeek, G.btDecision, G.systems, G.ideas, G.body, G.people, G.northStar, G.btNote],
  items: RAW.map((r, i) => {
    const it = { id: "bt-" + String(i + 1).padStart(3, "0"), sec: r.g.sec, sub: r.g.key, text: r.text, done: false };
    if (r.next) it.next = r.next;
    if (r.url) it.url = r.url;
    return it;
  }),
};

// Pure: returns a new state, or the same object if already seeded.
export const applySeed = (st) => {
  if (Array.isArray(st.seeded) && st.seeded.includes(BIG_TICKET.flag)) return st;
  let sections = st.sections.map((s) => ({ ...s, subs: [...(s.subs || [])] }));
  const items = Object.fromEntries(Object.entries(st.items).map(([k, v]) => [k, [...v]]));
  const labels = { ...st.labels };
  const ensureSection = (key, afterKey) => {
    if (sections.some((s) => s.key === key)) return;
    const meta = SECTION_META[key] || { glyph: "•", label: key.toUpperCase() };
    const entry = { key, glyph: meta.glyph, subs: [] };
    const idx = afterKey ? sections.findIndex((s) => s.key === afterKey) : -1;
    if (idx >= 0) sections.splice(idx + 1, 0, entry); else sections.push(entry);
    items[key] = [];
  };
  ensureSection("week");
  ensureSection("month", "week");
  for (const key of ["decision", "circleback", "note"]) ensureSection(key);
  for (const g of BIG_TICKET.subs) {
    const sec = sections.find((s) => s.key === g.sec);
    if (!sec.subs.some((x) => x.key === g.key)) sec.subs.push({ key: g.key, name: g.name });
  }
  const present = new Set(Object.values(items).flat().map((i) => i.id));
  for (const it of BIG_TICKET.items) {
    if (present.has(it.id)) continue;
    const { sec, sub, ...rest } = it;
    const entry = { ...rest };
    if (sub) entry.sub = sub;
    items[sec].push(entry);
  }
  return { ...st, v: 4, sections, items, labels, seeded: [...(st.seeded || []), BIG_TICKET.flag] };
};
