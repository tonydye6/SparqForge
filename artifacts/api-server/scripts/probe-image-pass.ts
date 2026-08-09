/**
 * Render the SAME prompt and the SAME references at both image passes, so the
 * two-pass decision is made on pictures rather than on a price list.
 *
 * WHY THIS EXISTS. Doc 30 §7 records two-pass as "verified worth building",
 * and what was actually verified was the PRICE — `gemini-3.1-flash-lite-image`
 * is on the price list at $0.0336 and answers `models.list`. Neither of those
 * facts says the model accepts a multi-image reference payload, and neither
 * says it holds subject identity. Doc 24 §4 is blunt about which of those
 * matters: "a beautiful Studio that generates the wrong person is a failed
 * Studio". A preview you cannot recognise the character in is not a preview,
 * it is a cheaper way to learn nothing.
 *
 * So this pays for one image at each tier — about $0.17 all in — and writes
 * both out to be looked at side by side. That is the probe doc 30 §6 asks for
 * before quoting a saving.
 *
 * Run from artifacts/api-server, on a host that already holds the key:
 *   pnpm exec tsx scripts/probe-image-pass.ts --subject crownu_char_male_sparq_football \
 *     --out /tmp/probe
 */
import { writeFile } from "node:fs/promises";
import { db, assetsTable, brandsTable } from "@workspace/db";
import { and, eq, ilike } from "drizzle-orm";
import { generateImageFromPrompt, type ReferenceImage } from "../src/services/imagen.js";
import { IMAGE_PASSES, type ImagePassType } from "../src/lib/ai-config.js";
import { resolveUrl, readBuffer } from "../src/services/storage.js";

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) return process.argv[i + 1]!;
  return process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
};

const SUBJECT = arg("subject") ?? "crownu_char_male_sparq_football";
const OUT = arg("out") ?? "/tmp/probe";
const BRAND = arg("brand") ?? "Crown U";
const PROMPT =
  arg("prompt") ??
  "The athlete in the reference image, mid-stride on a floodlit stadium field at night, " +
    "shot from a low three-quarter angle, dramatic rim light, shallow depth of field.";

async function main(): Promise<void> {
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.name, BRAND));
  if (!brand) throw new Error(`brand "${BRAND}" not found`);

  // A subject reference specifically: the identity lock copies these exactly, so
  // they are the class where a cheaper model failing would matter most.
  const [subject] = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.brandId, brand.id), ilike(assetsTable.name, `%${SUBJECT}%`)))
    .limit(1);
  if (!subject?.fileUrl) throw new Error(`no asset with a file matching "${SUBJECT}"`);

  const loc = resolveUrl(subject.fileUrl);
  if (!loc) throw new Error(`cannot resolve ${subject.fileUrl}`);
  const buf = await readBuffer(loc);
  if (!buf) throw new Error(`no bytes behind ${subject.fileUrl}`);
  const references: ReferenceImage[] = [
    { imageBuffer: buf, mimeType: subject.mimeType ?? "image/png", role: "subject_reference" },
  ];

  console.log(`\nsubject reference: ${subject.name} (${buf.length} bytes)`);
  console.log(`prompt: ${PROMPT.slice(0, 90)}…\n`);

  let spent = 0;
  for (const pass of ["preview", "full"] as ImagePassType[]) {
    const { model, usdPerImage } = IMAGE_PASSES[pass];
    const started = Date.now();
    try {
      const image = await generateImageFromPrompt(PROMPT, "instagram_feed", references, model);
      const path = `${OUT}-${pass}.png`;
      await writeFile(path, image.imageBuffer);
      spent += usdPerImage;
      console.log(
        `  ${pass.padEnd(8)} ${model.padEnd(30)} OK  ${(image.imageBuffer.length / 1024).toFixed(0)}KB  ` +
          `${((Date.now() - started) / 1000).toFixed(1)}s  $${usdPerImage.toFixed(4)}  -> ${path}`,
      );
    } catch (e) {
      // A failure here is the useful result, not an error to hide: it means the
      // tier cannot take this payload and two-pass does not work as designed.
      console.log(
        `  ${pass.padEnd(8)} ${model.padEnd(30)} FAILED  ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`,
      );
    }
  }
  console.log(`\n  spent ~$${spent.toFixed(4)}\n`);
  console.log("  Look at both files before trusting the saving. The question is not");
  console.log("  'is the preview good', it is 'can you pick the same winner from it'.\n");
}

await main();
process.exit(0);
