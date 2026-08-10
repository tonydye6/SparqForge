/**
 * Bridge cases, shared by the vitest suite and the tsx runner.
 *
 * The invariants worth protecting, in order:
 *
 *   1. NOTHING SHIPS SILENTLY WRONG. Every fallback the plan takes is named in
 *      a warning the user reads. A generic caption presented as one written for
 *      the placement is the failure nobody notices until it has published.
 *   2. SHIPPING TWICE UPDATES, it does not duplicate. `creative_variants` has
 *      no unique on (creative, platform), so this is the only thing standing
 *      between a second press and two rows the scheduler would both send.
 *   3. A SCHEDULED POST IS NOT REWRITTEN UNDERNEATH. Same class of failure as
 *      an approval surviving a content swap, which is what prompted this.
 */

import { planShip, composeCaption, shippingBlockedBySchedule, type ShipInput } from "./ship.js";
import { resolveChannels } from "./channels.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

const CHANNELS = resolveChannels(["instagram", "twitter"]);

function input(over: Partial<ShipInput> = {}): ShipInput {
  return {
    channels: CHANNELS,
    image: { imageUrl: "/api/files/take.png" },
    copy: {
      hook: "Samantha Has Entered The Court",
      base: "The rivalry that made the league.",
      channels: {
        instagram_feed: { caption: "Lightning doesn't ask permission.", hashtags: "#CrownU #ChargedServe" },
        instagram_story: { caption: "Tap through.", hashtags: "" },
        twitter: { caption: "NEW DROP: Meet Samantha.", hashtags: "#CrownU" },
      },
    },
    crops: { focal: { x: 0.5, y: 0.42 } },
    existingVariants: [],
    ...over,
  };
}

export function collectShipCases(): Case[] {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------ the happy path
  {
    const plan = planShip(input());
    check("a finished post ships one variant per connected channel", plan.variants.length === 3, plan.variants.map((v) => v.platform));
    check("and nothing blocks it", plan.blocked.length === 0, plan.blocked);
    const ig = plan.variants.find((v) => v.platform === "instagram_feed");
    check(
      "the caption that publishes is the channel's words plus its hashtags",
      ig?.caption === "Lightning doesn't ask permission.\n\n#CrownU #ChargedServe",
      ig?.caption,
    );
    check("the hook becomes the second text layer", ig?.hookText === "Samantha Has Entered The Court", ig?.hookText);
    check("the chosen picture is carried to every channel", plan.variants.every((v) => v.imageUrl === "/api/files/take.png"));
    check("the framing is carried to every channel", plan.variants.every((v) => v.focalX === 0.5 && v.focalY === 0.42));
    check("each channel is shaped for its own placement", ig?.aspectRatio === "4:5", plan.variants.map((v) => v.aspectRatio));
    const story = plan.variants.find((v) => v.platform === "instagram_story");
    check("and the story is not shaped like the feed", story?.aspectRatio === "9:16", story?.aspectRatio);
  }

  // ------------------------------------------------------------------- blocks
  {
    const plan = planShip(input({ image: null }));
    check("no picture blocks the whole thing", plan.blocked.length === 1 && plan.variants.length === 0, plan.blocked);
    check("and the block says where to go", plan.blocked[0].includes("stage 03"), plan.blocked[0]);
  }
  {
    const plan = planShip(input({ copy: null }));
    check("no copy blocks the whole thing", plan.blocked.length === 1, plan.blocked);
    check("and that block says stage 04", plan.blocked[0].includes("stage 04"), plan.blocked[0]);
  }
  {
    const plan = planShip(input({ channels: [] }));
    check("a brand with no connected account cannot ship", plan.blocked.length === 1, plan.blocked);
    check("and is told to connect one", plan.blocked[0].includes("Settings"), plan.blocked[0]);
  }
  {
    const plan = planShip(input({ image: null, copy: null, channels: [] }));
    check("every reason is reported at once, not one per attempt", plan.blocked.length === 3, plan.blocked);
  }

  // ---------------------------------------------------------------- warnings
  {
    const plan = planShip(input({ crops: null }));
    check("shipping without framing is allowed", plan.blocked.length === 0);
    check("but it is said out loud", plan.warnings.some((w) => w.includes("Framing was never set")), plan.warnings);
    check("and the default focal point is used", plan.variants[0]?.focalY === 0.42, plan.variants[0]);
  }
  {
    const copy = input().copy!;
    const plan = planShip(input({ copy: { ...copy, channels: { instagram_feed: copy.channels.instagram_feed } } }));
    check(
      "a channel with no copy of its own falls back to the base caption",
      plan.variants.find((v) => v.platform === "twitter")?.caption === "The rivalry that made the league.",
      plan.variants.find((v) => v.platform === "twitter")?.caption,
    );
    check(
      "and the fallback is named per channel rather than left to be discovered",
      plan.warnings.filter((w) => w.includes("no caption of its own")).length === 2,
      plan.warnings,
    );
  }
  {
    const copy = input().copy!;
    const plan = planShip(input({ copy: { ...copy, hook: "  " } }));
    check("a post with no hook still ships", plan.blocked.length === 0);
    check("with no text layer, said plainly", plan.variants.every((v) => v.hookText === null));
    check("and a warning", plan.warnings.some((w) => w.includes("no hook")), plan.warnings);
  }
  {
    const plan = planShip(input({ channels: resolveChannels(["linkedin"]) }));
    check(
      "a channel whose furniture is unmapped warns that its crop was unchecked",
      plan.warnings.some((w) => w.includes("furniture is not mapped")),
      plan.warnings,
    );
    check("but it still ships", plan.variants.length === 1, plan.variants);
  }
  {
    // The feed and X both have empty safeAreas by design (their chrome sits
    // outside the picture), so the unmapped warning must not fire for them.
    const plan = planShip(input());
    check(
      "placements whose chrome sits outside the picture are not called unmapped",
      !plan.warnings.some((w) => w.includes("Instagram feed's on-screen furniture")),
      plan.warnings,
    );
  }

  // ------------------------------------------------------------ idempotency
  {
    const plan = planShip(input({
      existingVariants: [{ id: "v-ig", platform: "instagram_feed" }, { id: "v-x", platform: "twitter" }],
    }));
    check(
      "shipping again updates the variants that exist",
      plan.variants.find((v) => v.platform === "instagram_feed")?.existingId === "v-ig"
      && plan.variants.find((v) => v.platform === "twitter")?.existingId === "v-x",
      plan.variants.map((v) => [v.platform, v.existingId]),
    );
    check(
      "and creates only the one that does not",
      plan.variants.find((v) => v.platform === "instagram_story")?.existingId === null,
      plan.variants.find((v) => v.platform === "instagram_story"),
    );
  }
  {
    const plan = planShip(input({ existingVariants: [{ id: "v-li", platform: "linkedin" }] }));
    check(
      "a variant on a channel the brand dropped is left alone, not deleted",
      plan.variants.every((v) => v.platform !== "linkedin"),
      plan.variants.map((v) => v.platform),
    );
    check(
      "and its survival is reported, because it is still on the record",
      plan.warnings.some((w) => w.includes("left untouched")),
      plan.warnings,
    );
  }

  // ------------------------------------------------------------- the schedule
  {
    check(
      "nothing on the calendar means nothing to protect",
      shippingBlockedBySchedule([]) === null,
    );
    check(
      "a published entry does not block a re-ship",
      shippingBlockedBySchedule([{ platform: "twitter", publishStatus: "published" }]) === null,
    );
    const blocked = shippingBlockedBySchedule([
      { platform: "instagram_feed", publishStatus: "scheduled" },
      { platform: "twitter", publishStatus: "failed" },
    ]);
    check("a scheduled entry blocks it", blocked !== null, blocked);
    check("and the message names the channel and the way out", Boolean(blocked?.includes("instagram_feed") && blocked?.includes("Pipeline")), blocked);
    check(
      "an entry mid-flight blocks it too",
      shippingBlockedBySchedule([{ platform: "tiktok", publishStatus: "publishing" }]) !== null,
    );
  }

  // ----------------------------------------------------------- caption joining
  {
    check("a caption with no hashtags is left alone", composeCaption("Words.", "") === "Words.");
    check("hashtags with no caption stand alone", composeCaption("", "#CrownU") === "#CrownU");
    check("both are separated by a blank line", composeCaption("Words.", "#CrownU") === "Words.\n\n#CrownU");
    check("whitespace-only parts do not leave a dangling gap", composeCaption("  ", "  ") === "");
  }

  return cases;
}
