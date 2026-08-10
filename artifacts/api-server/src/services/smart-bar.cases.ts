/**
 * Smart Bar cases, shared by the vitest suite and the tsx runner.
 *
 * The invariants worth protecting:
 *
 *   1. EVERY CARD CITES THE EVENT THAT WOKE IT. A suggestion with no `saw`
 *      line is an opinion, and the whole design is that this is a colleague
 *      pointing at the board.
 *   2. PINK IS RESERVED FOR SUBJECT FIDELITY. One risk class, per doc 24 §4;
 *      everything else is a note.
 *   3. CARDS FIRE ON STATE, NOT ON NOISE. A finished, picked, on-brief post
 *      produces an event feed and ZERO cards — a bar that always has advice
 *      teaches people to stop reading it.
 */

import { deriveCards, deriveEvents, type BarInput, type BarTake } from "./smart-bar.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const at = (m: number) => `2026-08-10T14:${String(m).padStart(2, "0")}:00.000Z`;

function take(over: Partial<BarTake>): BarTake {
  return {
    stageKind: "asset",
    slotKey: "as_briefed__mid",
    origin: "generated",
    isCurrent: true,
    createdAt: at(30),
    payload: {},
    ...over,
  };
}

/** A community-engagement spread: axes People × Timing, 8 takes, 3 departures. */
function spreadTakes(opts: { subjectCount: number; catalogSize: number } = { subjectCount: 1, catalogSize: 300 }): BarTake[] {
  const material = {
    material: {
      referenceCount: 6,
      catalogSize: opts.catalogSize,
      directorSelections: Array.from({ length: opts.subjectCount }, () => ({ role: "subject" })),
    },
  };
  // Slot keys must match the deterministic plan for community_engagement.
  const keys = [
    "as_briefed__peak", "the_crowd__peak", "one_face__peak", "no_one__peak",
    "as_briefed__aftermath", "the_crowd__aftermath", "one_face__aftermath", "no_one__aftermath",
  ];
  return keys.map((k, i) => take({ slotKey: k, createdAt: at(30 + i), payload: material }));
}

function input(over: Partial<BarInput>): BarInput {
  return {
    stages: [],
    takes: [],
    intent: "community_engagement",
    spreadSize: 8,
    directorName: "LA",
    ...over,
  };
}

export function collectSmartBarCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  const briefTake = take({
    stageKind: "brief", slotKey: "brief", origin: "user_typed", createdAt: at(10),
    payload: { line: "rivalry week hype for crown u" },
  });
  const directionTake = take({
    stageKind: "direction", slotKey: "direction", origin: "swapped_in", createdAt: at(12),
    payload: { name: "B Moore - LA" },
  });
  const pickedTake = take({
    stageKind: "asset", slotKey: "selected", origin: "swapped_in", createdAt: at(45),
    payload: { slotKey: "as_briefed__peak" },
  });

  // ---------------------------------------------------------------- events
  {
    const events = deriveEvents(input({ takes: [briefTake, directionTake, ...spreadTakes(), pickedTake] }));
    check(
      "events are ordered oldest first",
      JSON.stringify(events.map((e) => e.kind)) === JSON.stringify(["brief_saved", "direction_chosen", "spread_rendered", "take_picked"]),
      events.map((e) => e.kind),
    );
    check("the brief event counts the words", events[0].line.includes("6 words"), events[0].line);
    check("the director event names the director", events[1].line.includes("B Moore - LA"), events[1].line);
    check("each line opens with the clock", /^\d{2}:\d{2} /.test(events[0].line), events[0].line);
    check("the picked event names the position", events[3].line.includes("as_briefed / peak"), events[3].line);
  }

  {
    const events = deriveEvents(input({ takes: [] }));
    check("an empty session has an empty feed, not an invented one", events.length === 0, events);
  }

  // ---------------------------------------------------- the quiet invariant
  {
    // A finished, on-brief post: brief with goal, direction, spread with a
    // subject reference, an on-brief pick. The bar should have NOTHING to say.
    const cards = deriveCards(input({ takes: [briefTake, directionTake, ...spreadTakes(), pickedTake] }));
    check("a healthy session produces zero cards", cards.length === 0, cards.map((c) => c.id));
  }

  // ------------------------------------------------------- subject fidelity
  {
    const cards = deriveCards(input({ takes: [briefTake, ...spreadTakes({ subjectCount: 0, catalogSize: 300 })] }));
    const card = cards.find((c) => c.id === "no-subject-reference");
    check("zero subject references raises the pink card", card !== undefined, cards.map((c) => c.id));
    check("and it is the only pink class", cards.every((c) => c.id === "no-subject-reference" || c.tone !== "risk"));
    check("it cites what it saw", card?.saw.includes("material") === true, card?.saw);
    check("it states the catalog it was chosen from", card?.text.includes("300") === true, card?.text);
    check("pink sorts first", cards[0]?.id === "no-subject-reference", cards.map((c) => c.id));
  }
  {
    const cards = deriveCards(input({ takes: spreadTakes({ subjectCount: 0, catalogSize: 0 }) }));
    check(
      "an empty library does not accuse the director of ignoring it",
      !cards.some((c) => c.id === "no-subject-reference"),
      cards.map((c) => c.id),
    );
  }

  // ---------------------------------------------------------- off-brief bulk
  const secondSpread = spreadTakes().map((t) => ({ ...t, createdAt: at(50), isCurrent: false }));
  {
    // One spread's departures are the PLAN'S shape, not a signal. Only a
    // re-roll whose departure half has still never been chosen is worth a card.
    const oneRun = deriveCards(input({ takes: [...spreadTakes(), pickedTake] }));
    check(
      "one spread with an on-brief pick raises nothing: departures are the plan's shape",
      !oneRun.some((c) => c.id === "off-brief-bulk"),
      oneRun.map((c) => c.id),
    );
    const cards = deriveCards(input({ takes: [...spreadTakes(), ...secondSpread, pickedTake] }));
    const card = cards.find((c) => c.id === "off-brief-bulk");
    check("a re-roll still picked on-brief raises the narrower-run note", card !== undefined, cards.map((c) => c.id));
    check("it is a note, not an alarm", card?.tone === "note");
    check("its citation counts the split", /\d+ of \d+/.test(card?.saw ?? ""), card?.saw);
  }
  {
    const offBriefPick = take({
      stageKind: "asset", slotKey: "selected", origin: "swapped_in", createdAt: at(55),
      payload: { slotKey: "one_face__peak" },
    });
    const cards = deriveCards(input({ takes: [...spreadTakes(), ...secondSpread, offBriefPick] }));
    check(
      "picking a departure silences the narrower-run note, because the departures earned it",
      !cards.some((c) => c.id === "off-brief-bulk"),
      cards.map((c) => c.id),
    );
  }

  // --------------------------------------------------- second spread, no pick
  {
    const twoSpreads = [...spreadTakes(), ...spreadTakes().map((t) => ({ ...t, createdAt: at(50), isCurrent: false }))];
    const cards = deriveCards(input({ takes: twoSpreads }));
    check(
      "two spreads with nothing picked raises the refine-beats-reroll note",
      cards.some((c) => c.id === "second-spread-no-pick"),
      cards.map((c) => c.id),
    );
    const withPick = deriveCards(input({ takes: [...twoSpreads, pickedTake] }));
    check("picking anything silences it", !withPick.some((c) => c.id === "second-spread-no-pick"));
  }

  // ------------------------------------------------------------- no goal
  {
    const cards = deriveCards(input({ takes: [briefTake], intent: null }));
    const card = cards.find((c) => c.id === "no-goal");
    check("a goalless brief raises the default-axes note before money is spent", card !== undefined, cards.map((c) => c.id));
    check("its action goes to the brief", card?.action?.type === "open_stage" && card.action.stageKind === "brief");
    const after = deriveCards(input({ takes: [briefTake, ...spreadTakes()], intent: null }));
    check(
      "once the spread has run, the moment has passed and the note stays quiet",
      !after.some((c) => c.id === "no-goal"),
      after.map((c) => c.id),
    );
  }

  // ------------------------------------------------------------ the contract
  {
    const noisy = deriveCards(input({ takes: [briefTake, ...spreadTakes({ subjectCount: 0, catalogSize: 300 })], intent: null }));
    check("every card cites what it saw", noisy.every((c) => c.saw.trim().length > 0), noisy.map((c) => c.saw));
    check("every card offers one action or none, never a lecture", noisy.every((c) => c.action === null || Boolean(c.action.label)));
  }

  return cases;
}
