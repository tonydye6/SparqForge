/**
 * Brief-assist cases, shared by the vitest suite and the tsx runner.
 *
 * The invariants are the entrance's rules from Tony's mock review:
 * chips are shortcuts with a hard cap, never the conversation; the user's own
 * words can never be replaced by model output on their side of the brief; and
 * a malformed model reply fails loudly instead of rendering an empty bubble.
 */

import {
  MAX_CHIPS,
  buildCollabSystem,
  buildImprovePrompt,
  normalizeImprove,
  normalizeReply,
  toModelMessages,
  yoursFrom,
  type CollabMessage,
} from "./brief-assist.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const BRAND = {
  name: "Crown U",
  voiceDescription: "broadcaster hype, not corporate",
  bannedTerms: ["synergy", "game-changer"],
};

const VOICE = {
  id: "persona-la",
  name: "B Moore - LA",
  composition: "concept-first, one vivid narrative idea per post",
  mood: "audacious but disciplined",
  colorPhilosophy: "",
};

export function collectBriefAssistCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------ improve
  {
    const p = buildImprovePrompt("  new map for crown u  ", BRAND);
    check("improve carries the brand voice", p.includes("broadcaster hype"), p.slice(0, 120));
    check("improve carries the banned terms", p.includes("synergy"), undefined);
    check("improve asks for exactly one proposal, no list", p.includes("ONLY the improved brief text"));
  }
  {
    check(
      "a quoted proposal is unwrapped",
      normalizeImprove('"Crown U reveals Samantha."')?.proposal === "Crown U reveals Samantha.",
    );
    check("an empty proposal fails rather than proposing nothing", normalizeImprove("   ") === null);
    check("a runaway proposal fails rather than flooding the composer", normalizeImprove("x".repeat(700)) === null);
  }

  // ------------------------------------------------------------ the system
  {
    const s = buildCollabSystem(VOICE, BRAND);
    check("the director speaks as themselves", s.includes("You are B Moore - LA"), undefined);
    check("their fingerprint is their voice", s.includes("concept-first"), undefined);
    check("chips are offered, never required", s.includes("can always type anything instead"));
    check("the creator's words are protected in the instructions", s.includes("Never rewrite the creator's own words"));
    check("questions must carry their assumption", s.includes("what you will assume if they skip it"));
  }

  // ------------------------------------------------- reply discipline
  {
    const r = normalizeReply({
      message: "Then the frame is the half-second before the serve.",
      chips: ["Live now", "Tease", "Third", "Fourth", "Fifth"],
      assumption: "live now",
      directors: "One frame: charge held, not spent.",
    });
    check("a good reply survives", r !== null && r.message.startsWith("Then the frame"));
    check(
      `chips are capped at ${MAX_CHIPS}, so the chat cannot become a form`,
      r?.chips.length === MAX_CHIPS,
      r?.chips,
    );
  }
  {
    check("a reply with no message fails loudly", normalizeReply({ chips: ["a"] }) === null);
    check("a non-object reply fails loudly", normalizeReply("just text") === null);
    const r = normalizeReply({ message: "ok", chips: "not-an-array", assumption: 7, directors: null });
    check(
      "malformed optional fields degrade to empty, not to a crash",
      r !== null && r.chips.length === 0 && r.assumption === null && r.directors === "",
      r,
    );
    const long = normalizeReply({ message: "ok", directors: "d".repeat(2000) });
    check("a runaway directors block is truncated", (long?.directors.length ?? 0) <= 600);
  }

  // ------------------------------------------------- whose words are whose
  {
    const messages: CollabMessage[] = [
      { role: "you", text: "new map release for crown u" },
      { role: "director", text: "What is the ability called?" },
      { role: "you", text: "it's Charged Serve — lightning racket" },
      { role: "director", text: "Then the frame is the half-second before." },
    ];
    const yours = yoursFrom(messages);
    check(
      "yours is only what the user typed",
      yours === "new map release for crown u it's Charged Serve — lightning racket",
      yours,
    );
    check(
      "and nothing the director said can enter it",
      !yours.includes("half-second") && !yours.includes("ability called"),
    );
  }
  {
    const modelSide = toModelMessages([
      { role: "you", text: "hi" },
      { role: "director", text: "hello" },
      { role: "you", text: "  " },
    ]);
    check(
      "roles map to the API's vocabulary and blanks are dropped",
      modelSide.length === 2 && modelSide[0].role === "user" && modelSide[1].role === "assistant",
      modelSide,
    );
  }

  return cases;
}
