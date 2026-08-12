/**
 * Can one vision pass find and NAME the layers of a stage-03 take?
 *
 * WHY THIS EXISTS. Layer decomposition's first increment ships the CAST — who
 * is in a picture and from which real file — but not WHERE anything is, and
 * "where" is the whole of the next increment: Tony's ask is "change just that
 * one thing", which needs geometry tight enough to scope an edit to. A JSON
 * list of plausible boxes is exactly the kind of result that looks right and is
 * not, so this probe DRAWS what came back onto the real image. The boxes get
 * judged by eye, not by their existence.
 *
 * It also reports token usage, so the price this costs is measured before it is
 * quoted to anybody — the run endpoint should not be built around a guess.
 *
 * Two things are being tested, not one:
 *   1. does cast-steered naming beat blind naming (does it say "Crown U Mark"
 *      rather than "logo"), and
 *   2. are the boxes actually on the elements.
 * Pass --blind to run without the cast hint and compare.
 *
 * Run from artifacts/api-server, on a host that holds the key (the Mac's .env
 * carries a 21-character stub, so this means the container):
 *   pnpm exec tsx scripts/probe-layer-detection.ts \
 *     --creative 44f26524-53ef-4a6c-9859-1fb8846bc654 --slot as_briefed__sharp --out /tmp/layers
 */
import { writeFile, mkdir } from "node:fs/promises";
import sharp from "sharp";
import { and, eq, inArray } from "drizzle-orm";
import { ai } from "@workspace/integrations-gemini-ai";
import { db, assetsTable, brandsTable, creativesTable, stageStatesTable, stageTakesTable } from "@workspace/db";
import { AI_MODELS } from "../src/lib/ai-config.js";
import { extractJSON } from "../src/lib/extract-json.js";
import { readFileByUrl } from "../src/services/reference-images.js";
import { writeBuffer } from "../src/services/storage.js";
import {
  castLayers,
  castOfLineage,
  lineagePayloads,
  type CastAsset,
} from "../src/services/take-layers.js";

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) return process.argv[i + 1]!;
  return process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
};
const flag = (n: string): boolean => process.argv.includes(`--${n}`);

const CREATIVE = arg("creative") ?? "44f26524-53ef-4a6c-9859-1fb8846bc654";
const SLOT = arg("slot") ?? "as_briefed__sharp";
const OUT = arg("out") ?? "/tmp/layers";
const BLIND = flag("blind");

interface Detected {
  name: string;
  role: string;
  /** Gemini's own convention: [ymin, xmin, ymax, xmax], 0..1000. */
  box_2d: [number, number, number, number];
  occluded_by?: string[];
}

/** Gemini's documented normalised box order, converted to our 0..1 fractions. */
function toFraction(box: [number, number, number, number]) {
  const [ymin, xmin, ymax, xmax] = box.map(n => Math.min(1000, Math.max(0, Number(n))));
  return {
    x: xmin / 1000,
    y: ymin / 1000,
    w: Math.max(0, xmax - xmin) / 1000,
    h: Math.max(0, ymax - ymin) / 1000,
  };
}

function buildPrompt(castHint: string): string {
  return `You are decomposing a marketing key art image into EDITABLE LAYERS, the way a designer
would rebuild it in Photoshop so that ONE element can be restyled without touching the others.

Return ONLY a JSON array, ordered BACK TO FRONT (the background field first, the frontmost element last):
[{"name": "...", "role": "background|character|mark|typography|device|object",
  "box_2d": [ymin, xmin, ymax, xmax], "occluded_by": ["name of a layer in front of this one"]}]

Rules that matter:
- "name" must be a HUMAN-READABLE SEMANTIC NAME describing the element's ROLE in the composition
  ("Crown U Mark", "Left Female Athlete", "Diagonal Slash Device", "Main Headline"). Never "layer 1",
  never "object", never a colour on its own. This naming is the point of the whole feature.
- Separate characters from EACH OTHER. Separate graphic and typographic furniture from the art.
- box_2d is [ymin, xmin, ymax, xmax], each 0-1000, normalised to the image.
- Boxes must be TIGHT. This box will scope a generative edit, so a box that includes a neighbour
  means somebody's edit changes the wrong thing.
- Do NOT invent elements that are not visible. Do not include a whole-image "Base" row; the base is
  already known.
- Between 2 and 9 layers.
${castHint}`;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const [creative] = await db
    .select({ id: creativesTable.id, brandId: creativesTable.brandId })
    .from(creativesTable)
    .where(eq(creativesTable.id, CREATIVE));
  if (!creative) throw new Error(`creative ${CREATIVE} not found`);

  const [stage] = await db
    .select({ id: stageStatesTable.id })
    .from(stageStatesTable)
    .where(and(eq(stageStatesTable.creativeId, CREATIVE), eq(stageStatesTable.stageKind, "asset")));
  if (!stage) throw new Error("no Media stage on that creative");

  const slotTakes = await db
    .select({
      id: stageTakesTable.id,
      takeIndex: stageTakesTable.takeIndex,
      payload: stageTakesTable.payload,
      isCurrent: stageTakesTable.isCurrent,
    })
    .from(stageTakesTable)
    .where(and(eq(stageTakesTable.stageStateId, stage.id), eq(stageTakesTable.slotKey, SLOT)));
  const take = slotTakes.find(t => t.isCurrent);
  if (!take) throw new Error(`slot ${SLOT} has no current take`);

  const imageUrl = (take.payload as { imageUrl?: string }).imageUrl;
  if (!imageUrl) throw new Error("that take has no image");
  const buffer = await readFileByUrl(imageUrl);
  if (!buffer) throw new Error(`could not read ${imageUrl}`);
  const meta = await sharp(buffer).metadata();
  console.log(`take ${take.id} · ${imageUrl} · ${meta.width}x${meta.height}`);

  // The cast, exactly as the shipped read model computes it.
  const cast = castOfLineage(lineagePayloads(slotTakes, take.id));
  const assets = cast.length
    ? await db
        .select({
          id: assetsTable.id,
          name: assetsTable.name,
          assetClass: assetsTable.assetClass,
          generationRole: assetsTable.generationRole,
          brandLayer: assetsTable.brandLayer,
          franchise: assetsTable.franchise,
          depictedEntities: assetsTable.depictedEntities,
          fileUrl: assetsTable.fileUrl,
          thumbnailUrl: assetsTable.thumbnailUrl,
        })
        .from(assetsTable)
        .where(and(eq(assetsTable.brandId, creative.brandId), inArray(assetsTable.id, cast.map(c => c.assetId))))
    : [];
  const [brand] = await db.select({ name: brandsTable.name }).from(brandsTable).where(eq(brandsTable.id, creative.brandId));
  const known = castLayers({ cast, assets: assets as CastAsset[], brandName: brand?.name ?? null });

  const castHint = BLIND || known.length <= 1
    ? ""
    : `\nWHAT IS ALREADY KNOWN ABOUT THIS PICTURE. These files were fed to the model that drew it.
Use these EXACT names for them when you find them, and say so in "role":
${known.filter(l => l.kind !== "base").map(l => `- "${l.name}" (${l.kind})`).join("\n")}
Anything else you find gets a name of your own.`;

  console.log(`\ncast steering: ${castHint ? "ON" : "OFF (blind)"}`);
  if (castHint) console.log(castHint);

  const started = Date.now();
  const response = await ai.models.generateContent({
    model: AI_MODELS.GEMINI_FLASH_TEXT,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { data: buffer.toString("base64"), mimeType: "image/png" } },
        { text: buildPrompt(castHint) },
      ],
    }],
  });
  const elapsed = Date.now() - started;

  const usage = response.usageMetadata;
  console.log(`\nusage: ${JSON.stringify(usage)}  ·  ${(elapsed / 1000).toFixed(1)}s`);

  const text = (response.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  let detected: Detected[];
  try {
    const parsed = extractJSON<unknown>(text);
    detected = (Array.isArray(parsed) ? parsed : (parsed as { layers?: Detected[] })?.layers ?? []) as Detected[];
  } catch (err) {
    console.log("\nRAW (unparseable):\n", text.slice(0, 4000));
    throw err;
  }

  console.log(`\n${detected.length} layers detected, back to front:`);
  for (const d of detected) {
    const f = toFraction(d.box_2d);
    console.log(
      `  ${String(d.role ?? "?").padEnd(11)} ${d.name.padEnd(34)} ` +
      `x=${f.x.toFixed(3)} y=${f.y.toFixed(3)} w=${f.w.toFixed(3)} h=${f.h.toFixed(3)}` +
      (d.occluded_by?.length ? `  behind: ${d.occluded_by.join(", ")}` : ""),
    );
  }

  /*
   * The point of the probe: draw the boxes. A list of numbers cannot tell you
   * whether the box is on the mark or on the shoulder next to it.
   */
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const rects = detected.map((d, i) => {
    const f = toFraction(d.box_2d);
    const x = f.x * W, y = f.y * H, w = f.w * W, h = f.h * H;
    const hue = Math.round((i * 360) / Math.max(1, detected.length));
    const colour = `hsl(${hue} 90% 55%)`;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `fill="none" stroke="${colour}" stroke-width="${Math.max(2, Math.round(W / 320))}"/>` +
      `<text x="${(x + 6).toFixed(1)}" y="${(y + 26).toFixed(1)}" font-family="monospace" ` +
      `font-size="${Math.max(12, Math.round(W / 48))}" fill="${colour}">${i + 1} ${d.name.replace(/[<&]/g, "")}</text>`;
  }).join("");
  const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`);
  const drawn = await sharp(buffer).composite([{ input: overlay }]).png().toBuffer();

  const stem = `${OUT}/${SLOT}${BLIND ? "-blind" : "-steered"}`;
  await writeFile(`${stem}.png`, drawn);
  await writeFile(`${stem}.json`, JSON.stringify({ usage, elapsedMs: elapsed, detected }, null, 2));
  console.log(`\nwrote ${stem}.png and ${stem}.json`);

  /*
   * Also written through the app's own storage, so the drawn boxes can be
   * LOOKED AT over http from anywhere. The whole value of this probe is in
   * seeing whether the box is on the mark or on the shoulder beside it, and a
   * file on the container that nobody opens proves nothing.
   */
  const published = `probe-layers-${SLOT}${BLIND ? "-blind" : "-steered"}.png`;
  await writeBuffer("generated", published, drawn);
  console.log(`look at it: /api/files/generated/${published}`);
}

await main().catch(err => {
  console.error(err);
  process.exit(1);
});
process.exit(0);
