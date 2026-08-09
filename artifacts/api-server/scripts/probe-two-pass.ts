/**
 * Settle the two questions that decide whether two-pass ships, by looking at
 * pictures rather than at a price list.
 *
 * ── Q1. Does the second pass give you back THE TAKE YOU CHOSE? ──────────────
 *
 * "Render the keep at full resolution" hides a problem. A different model given
 * the same prompt and the same references produces a DIFFERENT PICTURE — the
 * first probe showed exactly that: same character, different pose, different
 * framing, different crowd. If promotion re-renders from the prompt, you pick
 * image X and the creative ships image Y, which makes the spread a lie about
 * what you were choosing between.
 *
 * So this probe compares two candidate mechanisms:
 *
 *   reprompt — pro, same prompt + same references. Cheap to build, and almost
 *              certainly wrong: nothing carries the composition across.
 *   refine   — pro, same prompt + same references + THE PREVIEW ITSELF as a
 *              reference image. The preview is what the user pointed at, so it
 *              is the only input that can preserve the shot they chose.
 *
 * ── Q2. Does the cheap tier invent third-party marks, and do they survive? ──
 *
 * The first probe's flash-lite render put legible Pepsi boards in the stadium
 * background where pro's were abstract. n=1, so this samples several and runs
 * the REAL trademark scanner over every output rather than trusting my eye.
 *
 * The exposure is narrower than it first looks: in a two-pass flow the preview
 * is never the artifact — it is a thumbnail for choosing, and the keeper is
 * re-rendered before anything ships. A mark invented in a preview only matters
 * if the refinement CARRIES IT THROUGH, which is precisely what `refine` risks
 * by feeding the preview back in. That is the number this probe exists to get.
 *
 * Run from artifacts/api-server, on a host that already holds the key:
 *   pnpm exec tsx scripts/probe-two-pass.ts --out /tmp/2p
 */
import { writeFile } from "node:fs/promises";
import { db, assetsTable, brandsTable } from "@workspace/db";
import { and, eq, ilike } from "drizzle-orm";
import { generateImageFromPrompt, type ReferenceImage } from "../src/services/imagen.js";
import { IMAGE_PASSES } from "../src/lib/ai-config.js";
import { resolveUrl, readBuffer } from "../src/services/storage.js";
import {
  assessAsset,
  buildTrademarkSystemPrompt,
  parseTrademarkFindings,
  TRADEMARK_RESPONSE_SCHEMA,
  type MarkKind,
} from "../src/services/trademark-scan.js";

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) return process.argv[i + 1]!;
  return process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
};

const OUT = arg("out") ?? "/tmp/2p";
const BRAND = arg("brand") ?? "Crown U";
const SUBJECT = arg("subject") ?? "crownu_char_male_sparq_football";
const KEY = process.env.GEMINI_API_KEY;
const SCAN_MODEL = arg("scan-model") ?? "gemini-3.5-flash";
const LICENSED: MarkKind[] = ["conference", "university"];

/**
 * Three briefs rather than one. A single prompt cannot tell an invented sponsor
 * board apart from a property of that one scene, and "stadium at night" is
 * exactly the setting most likely to summon advertising hoardings.
 */
const PROMPTS = [
  "The athlete in the reference image, mid-stride on a floodlit stadium field at night, " +
    "low three-quarter angle, dramatic rim light, shallow depth of field.",
  "The athlete in the reference image, celebrating in a packed indoor arena, " +
    "confetti in the air, wide shot from the stands.",
  "The athlete in the reference image, walking out of a locker room tunnel toward the pitch, " +
    "backlit, dust in the light.",
];

async function scanForMarks(buf: Buffer, ownMarks: string[]): Promise<ReturnType<typeof assessAsset>> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${SCAN_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY! },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildTrademarkSystemPrompt(BRAND, ownMarks) }] },
        contents: [{
          role: "user",
          parts: [
            { inlineData: { data: buf.toString("base64"), mimeType: "image/png" } },
            { text: "List every third-party mark visible in this image." },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", responseSchema: TRADEMARK_RESPONSE_SCHEMA },
      }),
    },
  );
  const j = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = j.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
  return assessAsset(parseTrademarkFindings(text).findings, { licensedKinds: LICENSED });
}

const marksOf = (a: ReturnType<typeof assessAsset>): string =>
  a.findings.length === 0 ? "none" : a.findings.map(f => `${f.mark}@${f.where}`).join("; ");

async function main(): Promise<void> {
  if (!KEY) throw new Error("need GEMINI_API_KEY");

  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.name, BRAND));
  if (!brand) throw new Error(`brand "${BRAND}" not found`);
  const [subject] = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.brandId, brand.id), ilike(assetsTable.name, `%${SUBJECT}%`)))
    .limit(1);
  if (!subject?.fileUrl) throw new Error(`no asset matching "${SUBJECT}"`);
  const loc = resolveUrl(subject.fileUrl);
  const subjectBuf = loc ? await readBuffer(loc) : null;
  if (!subjectBuf) throw new Error("could not read the subject reference");

  const ownMarks = [
    "the Sparq flame-skull mark",
    "the SPARQ wordmark",
    `the ${brand.name} wordmark and crown mark`,
  ];
  const baseRefs: ReferenceImage[] = [
    { imageBuffer: subjectBuf, mimeType: subject.mimeType ?? "image/png", role: "subject_reference" },
  ];

  let spent = 0;
  const rows: string[] = [];

  for (const [i, prompt] of PROMPTS.entries()) {
    console.log(`\n── brief ${i + 1} ─────────────────────────────────────────`);

    const preview = await generateImageFromPrompt(prompt, "instagram_feed", baseRefs, IMAGE_PASSES.preview.model);
    spent += IMAGE_PASSES.preview.usdPerImage;
    await writeFile(`${OUT}-${i + 1}-preview.png`, preview.imageBuffer);
    const previewScan = await scanForMarks(preview.imageBuffer, ownMarks);
    console.log(`  preview  ${previewScan.severity.padEnd(8)} ${marksOf(previewScan)}`);

    /*
     * The preview goes in as a SUBJECT reference, not a style one. Style
     * references are treated as mood; the whole point here is that this exact
     * composition is the thing being kept, and the subject lane is the one the
     * identity lock copies faithfully.
     */
    const refineRefs: ReferenceImage[] = [
      { imageBuffer: preview.imageBuffer, mimeType: "image/png", role: "subject_reference" },
      ...baseRefs,
    ];
    const refined = await generateImageFromPrompt(
      `${prompt}\n\nRender THIS EXACT COMPOSITION at full fidelity: same pose, same camera angle, ` +
        `same framing, same lighting. Improve detail and material quality only. Change nothing else.`,
      "instagram_feed",
      refineRefs,
      IMAGE_PASSES.full.model,
    );
    spent += IMAGE_PASSES.full.usdPerImage;
    await writeFile(`${OUT}-${i + 1}-refined.png`, refined.imageBuffer);
    const refinedScan = await scanForMarks(refined.imageBuffer, ownMarks);
    console.log(`  refined  ${refinedScan.severity.padEnd(8)} ${marksOf(refinedScan)}`);

    rows.push(
      `${i + 1}\tpreview=${previewScan.severity}\trefined=${refinedScan.severity}\t` +
        `previewMarks=${previewScan.findings.length}\trefinedMarks=${refinedScan.findings.length}`,
    );
    spent += 0.005; // two scan calls
  }

  console.log(`\n───────────────────────────────────────────────────────────`);
  rows.forEach(r => console.log("  " + r));
  console.log(`\n  spent ~$${spent.toFixed(3)}`);
  console.log(`  Files: ${OUT}-N-preview.png and ${OUT}-N-refined.png\n`);
  console.log("  Q1 is answered by EYE: does each refined image show the same shot");
  console.log("  as its preview? If not, promotion cannot re-render and must keep");
  console.log("  the preview or upscale it instead.");
  console.log("  Q2 is answered by the table: marks appearing in preview and");
  console.log("  surviving into refined is the case that actually matters.\n");
}

await main();
process.exit(0);
