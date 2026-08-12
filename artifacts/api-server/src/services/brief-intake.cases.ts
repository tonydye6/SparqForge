/**
 * Brief-intake derivation cases, shared by the vitest suite and the tsx runner.
 *
 * Lives apart from both runners for the same reason stage-graph.cases.ts does:
 * vitest cannot start on the development Mac (the Linux-resolved lockfile omits
 * @rollup/rollup-darwin-arm64), so the invariants have to be executable without
 * it. Both runners consume this file, so neither can drift from the other.
 *
 * The invariants worth protecting here are the spec's, not the prompt's. In
 * particular §1.11 rule 3: a question without a stated assumption is a gate, and
 * `normalizeQuestions` must drop it no matter what the model returned.
 */

import {
  MAX_QUESTIONS,
  MAX_SHOTS,
  buildDerivedRows,
  deriveChannels,
  deriveGoal,
  deriveMustNot,
  normalizeQuestions,
  normalizeShots,
  readsAsStory,
  renumberShots,
} from "./brief-intake.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const q = (over: Record<string, unknown> = {}) => ({
  id: "timing",
  question: "Is this live now, or a tease?",
  options: ["Live now", "Tease"],
  assumption: "live now, because your last three posts of this kind were",
  ...over,
});

export function collectBriefIntakeCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ---------------------------------------------------------------- questions
  {
    const out = normalizeQuestions([q()]);
    check("a well formed question survives", out.length === 1 && out[0].id === "timing", out);
  }
  {
    const out = normalizeQuestions([q({ assumption: "" })]);
    check("a question with an empty assumption is dropped", out.length === 0, out);
  }
  {
    const out = normalizeQuestions([q({ assumption: undefined })]);
    check("a question with no assumption field is dropped", out.length === 0, out);
  }
  {
    const out = normalizeQuestions([q({ assumption: "   " })]);
    check("a whitespace-only assumption is dropped", out.length === 0, out);
  }
  {
    const out = normalizeQuestions([q({ question: "" })]);
    check("a question with empty text is dropped", out.length === 0, out);
  }
  {
    const out = normalizeQuestions([q({ options: ["Only one"] })]);
    check("a question with one option is dropped", out.length === 0, out);
  }
  {
    const out = normalizeQuestions([q({ options: [] })]);
    check("a question with no options is dropped", out.length === 0, out);
  }
  {
    const out = normalizeQuestions([q({ options: ["A", "A", "B"] })]);
    check("duplicate options are collapsed", out.length === 1 && out[0].options.length === 2, out);
  }
  {
    const out = normalizeQuestions([q({ options: ["A", "B", "C", "D", "E", "F"] })]);
    check("options are capped at four", out[0]?.options.length === 4, out);
  }
  {
    const many = Array.from({ length: 8 }, (_, i) => q({ id: `q${i}` }));
    const out = normalizeQuestions(many);
    check(`questions are capped at ${MAX_QUESTIONS}`, out.length === MAX_QUESTIONS, out.length);
  }
  {
    const out = normalizeQuestions([q({ id: "same" }), q({ id: "same" })]);
    check("a duplicate question id is dropped", out.length === 1, out);
  }
  {
    const out = normalizeQuestions([q({ id: undefined })]);
    check("a missing id is backfilled rather than dropping the question", out.length === 1 && !!out[0].id, out);
  }
  {
    const out = normalizeQuestions([q(), q({ assumption: "" }), q({ id: "art" })]);
    check("a bad question does not take good ones with it", out.length === 2, out);
  }
  for (const junk of [null, undefined, "nope", 7, {}] as unknown[]) {
    const out = normalizeQuestions(junk);
    check(`non-array input ${JSON.stringify(junk) ?? "undefined"} yields no questions`, out.length === 0, out);
  }
  {
    const out = normalizeQuestions([null, "x", 1, q()]);
    check("junk entries are skipped, real ones kept", out.length === 1, out);
  }
  {
    const out = normalizeQuestions([q({ question: "  padded  ", assumption: "  also padded  " })]);
    check(
      "question and assumption are trimmed",
      out[0]?.question === "padded" && out[0]?.assumption === "also padded",
      out,
    );
  }

  // ----------------------------------------------------------------- channels
  {
    const row = deriveChannels([]);
    check(
      "no connected account says so plainly and is labelled brand",
      row.provenance === "brand" && /no channel is connected/i.test(row.value),
      row,
    );
  }
  {
    const row = deriveChannels(["tiktok", "instagram", "twitter"]);
    check("channels are ordered and labelled", row.value === "IG, X, TikTok", row.value);
  }
  {
    const row = deriveChannels(["instagram", "instagram"]);
    check("a duplicate account platform is listed once", row.value === "IG", row.value);
  }
  {
    const row = deriveChannels(["mastodon"]);
    check("an unknown platform falls back to its own name", row.value === "mastodon", row.value);
  }

  // ----------------------------------------------------------------- must-not
  {
    const row = deriveMustNot({});
    check("a brand with no constraints yields no must-not row at all", row === null, row);
  }
  {
    const row = deriveMustNot({ bannedTerms: [], negativePrompt: "", trademarkRules: "" });
    check("empty constraint fields also yield no row", row === null, row);
  }
  {
    const row = deriveMustNot({ bannedTerms: ["  ", ""] });
    check("whitespace-only banned terms do not manufacture a row", row === null, row);
  }
  {
    const row = deriveMustNot({ bannedTerms: ["a", "b", "c", "d", "e", "f"] });
    check(
      "banned terms are capped and the omission is counted honestly",
      !!row && row.value.includes("and 2 more"),
      row?.value,
    );
  }
  {
    const row = deriveMustNot({ bannedTerms: ["gamble"], negativePrompt: "no red" });
    check(
      "multiple constraint sources are joined",
      !!row && row.value.includes("gamble") && row.value.includes("no red"),
      row?.value,
    );
  }
  {
    const row = deriveMustNot({ negativePrompt: "x".repeat(400) });
    check("an over-long constraint is truncated", !!row && row.value.length <= 220, row?.value.length);
  }
  {
    const row = deriveMustNot({ negativePrompt: "no red." });
    check("a trailing period is stripped", row?.value === "no red", row?.value);
  }

  // --------------------------------------------------------------------- goal
  {
    const row = deriveGoal("retention", 0.95, null);
    check("a confident goal carries no hedge note", row.note === undefined, row);
  }
  {
    const row = deriveGoal("retention", 0.5, { intent: "community_engagement", confidence: 0.3 });
    check(
      "a weak goal states its confidence and the runner up",
      !!row.note && row.note.includes("50%") && row.note.includes("Community engagement"),
      row.note,
    );
  }
  {
    const row = deriveGoal("retention", 0.5, null);
    check("a weak goal with no runner up still states confidence", !!row.note && row.note.includes("50%"), row.note);
  }
  {
    const row = deriveGoal("awareness", 0.9, null);
    check("the goal row is labelled inferred, never brand", row.provenance === "inferred", row);
  }

  // ------------------------------------------------------------ full assembly
  {
    const rows = buildDerivedRows({
      intent: "community_engagement",
      confidence: 0.9,
      runnerUp: null,
      connectedPlatforms: ["instagram"],
      brand: {},
    });
    check(
      "with no brand constraints the panel is goal, audience, channels",
      rows.map(r => r.key).join(",") === "goal,audience,channels",
      rows.map(r => r.key),
    );
  }
  {
    const rows = buildDerivedRows({
      intent: "community_engagement",
      confidence: 0.9,
      runnerUp: null,
      connectedPlatforms: ["instagram"],
      brand: { bannedTerms: ["gamble"] },
    });
    check(
      "must-not is appended when the brand has one",
      rows.map(r => r.key).join(",") === "goal,audience,channels,mustnot",
      rows.map(r => r.key),
    );
  }
  {
    const rows = buildDerivedRows({
      intent: "acquisition",
      confidence: 0.9,
      runnerUp: null,
      connectedPlatforms: [],
      brand: {},
    });
    check("every row carries a provenance", rows.every(r => !!r.provenance), rows);
  }
  {
    const rows = buildDerivedRows({
      intent: "acquisition",
      confidence: 0.9,
      runnerUp: null,
      connectedPlatforms: [],
      brand: {},
    });
    check("row keys are unique", new Set(rows.map(r => r.key)).size === rows.length, rows.map(r => r.key));
  }
  {
    // The derivation must never echo the typed line back as a derived row,
    // because that is what "your line is never rewritten" means in practice.
    const rows = buildDerivedRows({
      intent: "education",
      confidence: 0.9,
      runnerUp: null,
      connectedPlatforms: ["youtube"],
      brand: {},
    });
    check("no derived row is authored by 'you' before any edit", rows.every(r => r.provenance !== "you"), rows);
  }

  // ---- the shot list (story path, step 4a) ----
  {
    const shots = normalizeShots([
      "At the starting line — coiled, focused",
      "Mid-race — wheel to wheel down the straight",
      "The win — chest through the tape",
    ]);
    check("plain strings become shots", shots.length === 3, shots);
    check("shots are numbered from 1, never 0", shots.map(s => s.n).join() === "1,2,3", shots);
    check("a derived shot is inferred, not authored", shots.every(s => s.provenance === "inferred"), shots);
    check("three moments read as a story", readsAsStory(shots));
  }
  {
    const shots = normalizeShots([{ text: "The start" }, { text: "The finish" }]);
    check("objects with text become shots too", shots.length === 2, shots);
  }
  {
    /*
     * The failure this exists to stop: a model asked for MOMENTS returning the
     * same beat twice in different words. Paying twice to generate one moment
     * is precisely what the shot list is meant to prevent.
     */
    const shots = normalizeShots(["The win, arms up", "the WIN arms up!", "The start"]);
    check("the same moment twice is one shot", shots.length === 2, shots);
    check("and the survivors renumber contiguously", shots.map(s => s.n).join() === "1,2", shots);
  }
  {
    const shots = normalizeShots(["Only one moment"]);
    check("one moment is NOT a story", !readsAsStory(shots), shots);
  }
  check("nothing at all is not a story", !readsAsStory(normalizeShots(null)));
  check("a non-array returns no shots rather than throwing", normalizeShots("a story").length === 0);
  {
    const shots = normalizeShots(["", "   ", null, 42, { text: "" }, { nope: 1 }, "A real moment"]);
    check("malformed rows are dropped, not repaired", shots.length === 1, shots);
    check("and the one real row is shot 1", shots[0]?.n === 1, shots);
  }
  {
    const many = normalizeShots(Array.from({ length: 12 }, (_, i) => `Moment number ${i + 1}`));
    check(`the cap holds at ${MAX_SHOTS}`, many.length === MAX_SHOTS, many.length);
    check("and the cap does not break the numbering", many[many.length - 1]?.n === MAX_SHOTS, many);
  }
  {
    const long = normalizeShots(["x".repeat(400)]);
    check("an essay is truncated rather than dropped", (long[0]?.text.length ?? 0) <= 180, long[0]?.text.length);
  }
  {
    // What a delete and a reorder do. A gap or a duplicate would make "beat 2"
    // mean two things, and the storyboard's slot families are named off these.
    const edited = renumberShots([
      { n: 3, text: "Third", provenance: "you" },
      { n: 1, text: "  ", provenance: "inferred" },
      { n: 2, text: "Second", provenance: "inferred" },
    ]);
    check("renumbering drops an emptied row", edited.length === 2, edited);
    check("renumbering is contiguous from 1", edited.map(s => s.n).join() === "1,2", edited);
    check("renumbering keeps the given order, not the old numbers", edited[0]?.text === "Third", edited);
    check("and it does not relabel who wrote a row", edited[0]?.provenance === "you", edited);
  }

  return cases;
}
