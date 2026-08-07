/*
 * Mac-runnable proof that the designed-graphic pipeline can only render the
 * brand type stack.
 *
 *   pnpm exec tsx src/services/design-fonts.verify.ts
 *
 * Written because vitest does not run on this machine (rollup's native module
 * is missing), and because the thing being asserted — that an off-brand face
 * cannot reach a deliverable — is a brand rule, not a detail. A typecheck
 * cannot see it: `anton` failing is a runtime file read and a Zod parse.
 */

import { DESIGN_FONTS, DesignSpecSchema, type DesignFont } from "./design-spec.js";
import { loadDesignFont } from "./designed-compositor.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** A minimal spec that parses, so font handling can be varied in isolation. */
function specWith(font: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    canvasColor: "#1e1e24",
    accentColor: "#eb0028",
    neutralColor: "#f4f1ea",
    headline: { lines: ["GAME DAY"], color: "#f4f1ea" },
    subject: { prompt: "a cut-out athlete mid-stride" },
  };
  if (font !== undefined) {
    (base.headline as Record<string, unknown>).font = font;
  }
  return base;
}

console.log("\ndesign fonts · the brand stack is the only stack\n");

console.log("the enum is exactly the brand faces");
check("three roles are offered", DESIGN_FONTS.length === 3, `got ${DESIGN_FONTS.length}`);
check("barlow is present", DESIGN_FONTS.includes("barlow" as DesignFont));
check("barlowItalic is present", DESIGN_FONTS.includes("barlowItalic" as DesignFont));
check("oxanium is present", DESIGN_FONTS.includes("oxanium" as DesignFont));
check(
  "no off-brand face is offered",
  !(DESIGN_FONTS as readonly string[]).some(f => f === "anton" || f === "archivo"),
);

console.log("\nevery offered face actually loads and draws");
for (const font of DESIGN_FONTS) {
  let cmds = -1;
  let err = "";
  try {
    const parsed = loadDesignFont(font);
    // Digits matter as much as letters: Oxanium exists to set scores and times.
    cmds = parsed.getPath("SPARQ 00:42.7", 0, 0, 72).commands.length;
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check(`${font} renders glyph outlines`, cmds > 20, err || `only ${cmds} path commands`);
}

console.log("\nlegacy specs still render, by stated migration");
for (const legacy of ["anton", "archivo"]) {
  const parsed = DesignSpecSchema.safeParse(specWith(legacy));
  check(
    `"${legacy}" is accepted and mapped to barlow`,
    parsed.success && parsed.data.headline.font === "barlow",
    parsed.success ? `mapped to ${parsed.data.headline.font}` : parsed.error.issues[0]?.message,
  );
}

console.log("\nanything else is refused rather than quietly substituted");
for (const bogus of ["helvetica", "impact", "rajdhani", ""]) {
  const parsed = DesignSpecSchema.safeParse(specWith(bogus));
  check(`"${bogus}" is rejected`, !parsed.success);
}

console.log("\nthe default is the display face");
{
  const parsed = DesignSpecSchema.safeParse(specWith(undefined));
  check(
    "an omitted font defaults to barlow",
    parsed.success && parsed.data.headline.font === "barlow",
    parsed.success ? `got ${parsed.data.headline.font}` : parsed.error.issues[0]?.message,
  );
}

console.log(
  failures === 0
    ? "\nall checks passed\n"
    : `\n${failures} CHECK${failures === 1 ? "" : "S"} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
