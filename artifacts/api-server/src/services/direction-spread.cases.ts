/**
 * Stage 02 designer-spread cases, shared by the vitest suite and the tsx runner.
 *
 * Same reason as stage-graph.cases.ts and brief-intake.cases.ts: vitest cannot
 * start on the development Mac, so the invariants have to be executable without
 * it. Both runners consume this file, so neither can drift.
 *
 * The invariants worth protecting are the spec's: House style is always present
 * (§ plan item 2), a human decision outranks a derived ranking (§1.17), a hit
 * rate is withheld below a real sample, and iteration signals are never counted
 * as a verdict on the director.
 */

import {
  BRAND_OWNED,
  HOUSE_STYLE_ID,
  HOUSE_STYLE_INDEX,
  MIN_SIGNALS_FOR_HIT_RATE,
  buildDirectionSpread,
  computeHitRate,
  groupSignalsByPersona,
  personaGoverns,
  referenceCount,
  type PersonaRow,
  type SignalRow,
} from "./direction-spread.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const persona = (over: Partial<PersonaRow> & { id: string; name: string }): PersonaRow => ({
  description: "",
  typography: "",
  composition: "tight crops, heavy negative space",
  colorPhilosophy: "",
  textureAndEffects: "",
  mood: "",
  referenceImages: [],
  ...over,
});

const sig = (personaId: string | null, signalType: string, payload?: unknown): SignalRow => ({
  personaId,
  signalType,
  ...(payload === undefined ? {} : { payload }),
});

/** n positive + m negative judged signals for one persona. */
const signals = (personaId: string | null, pos: number, neg: number): SignalRow[] => [
  ...Array.from({ length: pos }, () => sig(personaId, "take_selected")),
  ...Array.from({ length: neg }, () => sig(personaId, "take_passed_over")),
];

export function collectDirectionSpreadCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // --------------------------------------------------------------- hit rate
  {
    const hr = computeHitRate(signals("a", 4, 2));
    check("a real sample reports a rate", hr.rate !== null && Math.abs(hr.rate - 4 / 6) < 1e-9, hr);
  }
  {
    const hr = computeHitRate(signals("a", 2, 1));
    check(
      `under ${MIN_SIGNALS_FOR_HIT_RATE} judged signals the rate is withheld`,
      hr.rate === null && hr.n === 3,
      hr,
    );
  }
  {
    const hr = computeHitRate([]);
    check("no signals yields a null rate and n of zero", hr.rate === null && hr.n === 0, hr);
  }
  {
    const hr = computeHitRate(signals("a", 5, 0));
    check("a perfect record at the threshold reports 1", hr.rate === 1 && hr.n === 5, hr);
  }
  {
    const hr = computeHitRate(signals("a", 0, 5));
    check("a total miss reports 0 rather than null", hr.rate === 0 && hr.n === 5, hr);
  }
  {
    const hr = computeHitRate([
      ...signals("a", 5, 0),
      sig("a", "vary"),
      sig("a", "regenerate"),
      sig("a", "caption_edit"),
      sig("a", "headline_edit"),
      sig("a", "edit_instruction"),
    ]);
    check("iteration signals are not counted as a verdict", hr.n === 5 && hr.rate === 1, hr);
  }
  {
    const hr = computeHitRate([
      sig("a", "variant_approved"),
      sig("a", "variant_approved"),
      sig("a", "variant_rejected"),
      sig("a", "take_selected"),
      sig("a", "take_passed_over"),
    ]);
    check("approve and reject count alongside select and pass", hr.positive === 3 && hr.negative === 2, hr);
  }
  {
    const hr = computeHitRate([
      sig("a", "reaction", { reaction: "Love it" }),
      sig("a", "reaction", { reaction: "Great colors" }),
      sig("a", "reaction", { reaction: "Off-brand" }),
      sig("a", "reaction", { reaction: "Too busy" }),
      sig("a", "reaction", { reaction: "Wrong tone" }),
    ]);
    check("reaction chips are polarised correctly", hr.positive === 2 && hr.negative === 3, hr);
  }
  {
    const hr = computeHitRate([sig("a", "reaction", { reaction: "Brand new chip" })]);
    check("an unrecognised chip is not evidence either way", hr.n === 0, hr);
  }
  for (const bad of [undefined, null, "x", 5, {}, { reaction: 7 }] as unknown[]) {
    const hr = computeHitRate([sig("a", "reaction", bad)]);
    check(`a malformed reaction payload ${JSON.stringify(bad) ?? "undefined"} is ignored`, hr.n === 0, hr);
  }

  // ------------------------------------------------------------- references
  for (const [input, expected] of [
    [[], 0],
    [[{ url: "a" }, { url: "b" }], 2],
    [null, 0],
    [undefined, 0],
    ["not an array", 0],
    [{ length: 5 }, 0],
  ] as Array<[unknown, number]>) {
    check(
      `referenceCount(${JSON.stringify(input) ?? "undefined"}) is ${expected}`,
      referenceCount(input) === expected,
      referenceCount(input),
    );
  }

  // ---------------------------------------------------------------- governs
  {
    const g = personaGoverns(persona({ id: "a", name: "A", composition: "", mood: "brooding" }));
    check("only filled fields are claimed", g.length === 1 && g[0] === "Mood", g);
  }
  {
    const g = personaGoverns(persona({ id: "a", name: "A", composition: "   " }));
    check("a whitespace-only field is not claimed", g.length === 0, g);
  }
  {
    const g = personaGoverns(
      persona({
        id: "a",
        name: "A",
        typography: "t",
        colorPhilosophy: "c",
        textureAndEffects: "x",
        mood: "m",
      }),
    );
    check("a full persona claims all five", g.length === 5, g);
  }
  {
    const g = personaGoverns(persona({ id: "a", name: "A" }));
    check(
      "nothing a persona governs is brand-owned",
      g.every(x => !(BRAND_OWNED as readonly string[]).includes(x)),
      g,
    );
  }

  // --------------------------------------------------------------- grouping
  {
    const g = groupSignalsByPersona([sig("a", "take_selected"), sig(null, "take_selected")]);
    check("a null persona signal is kept under House, not discarded", g.get(HOUSE_STYLE_ID)?.length === 1, [
      ...g.keys(),
    ]);
  }

  // ----------------------------------------------------------------- spread
  {
    const spread = buildDirectionSpread({ personas: [], signals: [], defaultPersonaId: null });
    check("House style is present even with no personas at all", spread.length === 1 && spread[0].kind === "house", spread);
  }
  {
    const personas = ["A", "B", "C", "D", "E"].map(n => persona({ id: n.toLowerCase(), name: n }));
    const spread = buildDirectionSpread({ personas, signals: [], defaultPersonaId: null });
    check(
      `House style sits at index ${HOUSE_STYLE_INDEX} when there are enough personas`,
      spread[HOUSE_STYLE_INDEX].kind === "house",
      spread.map(c => c.id),
    );
    check("no persona is dropped to make room for House", spread.length === personas.length + 1, spread.length);
  }
  {
    const personas = [persona({ id: "a", name: "A" }), persona({ id: "b", name: "B" })];
    const spread = buildDirectionSpread({ personas, signals: [], defaultPersonaId: null });
    check(
      "with too few personas House still appears, at the end",
      spread.length === 3 && spread[2].kind === "house",
      spread.map(c => c.id),
    );
  }
  {
    const personas = [persona({ id: "a", name: "A" }), persona({ id: "b", name: "B" })];
    const spread = buildDirectionSpread({ personas, signals: [], defaultPersonaId: "b" });
    check("the locked default director leads the spread", spread[0].id === "b", spread.map(c => c.id));
    check("the default card is flagged as such", spread[0].isBrandDefault === true, spread[0]);
  }
  {
    // The human decision must win even when the ranking disagrees loudly.
    const personas = [persona({ id: "good", name: "Good" }), persona({ id: "bad", name: "Bad" })];
    const spread = buildDirectionSpread({
      personas,
      signals: [...signals("good", 10, 0), ...signals("bad", 0, 10)],
      defaultPersonaId: "bad",
    });
    check(
      "a locked default outranks a better hit rate",
      spread[0].id === "bad",
      spread.map(c => `${c.id}:${c.hitRate.rate}`),
    );
  }
  {
    const personas = [
      persona({ id: "low", name: "Low" }),
      persona({ id: "high", name: "High" }),
      persona({ id: "mid", name: "Mid" }),
    ];
    const spread = buildDirectionSpread({
      personas,
      signals: [...signals("low", 1, 9), ...signals("high", 9, 1), ...signals("mid", 5, 5)],
      defaultPersonaId: null,
    });
    const ids = spread.filter(c => c.kind === "persona").map(c => c.id);
    check("rated personas are ordered best first", ids.join(",") === "high,mid,low", ids);
  }
  {
    const personas = [
      persona({ id: "proven", name: "Proven" }),
      persona({ id: "unproven", name: "Unproven" }),
    ];
    const spread = buildDirectionSpread({
      personas,
      // Proven has a poor but real record; unproven has almost no signal.
      signals: [...signals("proven", 2, 4), ...signals("unproven", 1, 0)],
      defaultPersonaId: null,
    });
    const ids = spread.filter(c => c.kind === "persona").map(c => c.id);
    check("a rated persona sorts above an unrated one", ids.join(",") === "proven,unproven", ids);
  }
  {
    const personas = [persona({ id: "b", name: "Bravo" }), persona({ id: "a", name: "Alpha" })];
    const spread = buildDirectionSpread({
      personas,
      signals: [...signals("a", 3, 2), ...signals("b", 3, 2)],
      defaultPersonaId: null,
    });
    const ids = spread.filter(c => c.kind === "persona").map(c => c.id);
    check("equal rate and sample break on name for a stable order", ids.join(",") === "a,b", ids);
  }
  {
    const personas = ["A", "B", "C", "D"].map(n => persona({ id: n.toLowerCase(), name: n }));
    const once = buildDirectionSpread({ personas, signals: [], defaultPersonaId: null }).map(c => c.id);
    const twice = buildDirectionSpread({ personas, signals: [], defaultPersonaId: null }).map(c => c.id);
    check("the spread is deterministic across calls", once.join(",") === twice.join(","), [once, twice]);
  }
  {
    const spread = buildDirectionSpread({
      personas: [persona({ id: "a", name: "A" })],
      signals: [],
      defaultPersonaId: null,
    });
    const house = spread.find(c => c.kind === "house")!;
    check("with no locked default, House is the implied default", house.isBrandDefault === true, house);
  }
  {
    const spread = buildDirectionSpread({
      personas: [persona({ id: "a", name: "A" })],
      signals: [],
      defaultPersonaId: "a",
    });
    const house = spread.find(c => c.kind === "house")!;
    check("with a locked default, House is not the default", house.isBrandDefault === false, house);
  }
  {
    const spread = buildDirectionSpread({
      personas: [persona({ id: "a", name: "A" })],
      signals: [],
      defaultPersonaId: null,
    });
    check(
      "no card claims anything the brand owns",
      spread.every(c => c.governs.every(g => !(BRAND_OWNED as readonly string[]).includes(g))),
      spread.map(c => c.governs),
    );
  }
  {
    const spread = buildDirectionSpread({
      personas: ["A", "B"].map(n => persona({ id: n.toLowerCase(), name: n })),
      signals: [],
      defaultPersonaId: null,
    });
    check("card ids are unique", new Set(spread.map(c => c.id)).size === spread.length, spread.map(c => c.id));
  }
  {
    // House style output carries no personaId, so its own record must accumulate.
    const spread = buildDirectionSpread({
      personas: [],
      signals: signals(null, 6, 2),
      defaultPersonaId: null,
    });
    const house = spread[0];
    check("House style earns its own hit rate from persona-less signals", house.hitRate.n === 8, house.hitRate);
  }

  return cases;
}
