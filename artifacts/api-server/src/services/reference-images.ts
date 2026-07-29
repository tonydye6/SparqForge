import { type DesignerPersona, type PersonaReferenceImage } from "@workspace/db";
import { resolveUrl, readBuffer, contentTypeFor } from "./storage.js";
import { MAX_IMAGE_REFERENCES } from "./packet-assembly.js";
import type { ReferenceImage } from "./imagen.js";

/**
 * Loading reference imagery for a generation.
 *
 * Extracted from routes/generate.ts so there is exactly ONE implementation. This
 * project already paid for having two generation stacks once: the legacy path
 * injected every steering engine while the co-pilot path silently injected none,
 * and the symptom was Tony reporting that generation ignored his asset library.
 * A second copy of the reference loader would be the same mistake in miniature,
 * so stage 03 Explore shares this rather than growing its own.
 *
 * Everything here degrades rather than throws. A reference that cannot be read is
 * skipped, because losing one work sample is a worse-looking image, while
 * throwing would lose the whole spread the user has already paid for.
 */

/**
 * Reference slots reserved for a persona when one is selected.
 *
 * Guaranteed rather than best-effort: a designer that loses its samples to a
 * full packet is a designer that silently stops directing.
 */
export const MAX_PERSONA_REFERENCES = 3;

/** Read a stored file by its `/api/files/...` URL. Null when unreadable. */
export async function readFileByUrl(fileUrl: string | null | undefined): Promise<Buffer | null> {
  const loc = resolveUrl(fileUrl);
  return loc ? readBuffer(loc) : null;
}

/**
 * A persona's work samples, as style references.
 *
 * Persona images are plain file URLs on the persona row (account-scoped, not
 * brand assets), so they are loaded into buffers at generation time.
 */
export async function loadPersonaReferenceImages(persona: DesignerPersona | null): Promise<ReferenceImage[]> {
  if (!persona) return [];
  const refs = (persona.referenceImages || []) as PersonaReferenceImage[];
  const out: ReferenceImage[] = [];
  for (const ref of refs) {
    if (out.length >= MAX_PERSONA_REFERENCES) break;
    const loc = resolveUrl(ref.url);
    if (!loc) continue;
    const buf = await readBuffer(loc);
    if (!buf) continue;
    out.push({
      imageBuffer: buf,
      mimeType: contentTypeFor(loc.filename),
      role: "style_reference",
      source: "persona",
      description: `Work sample by "${persona.name}"${ref.label ? ` (${ref.label})` : ""}.`,
    });
  }
  return out;
}

/** The shape buildReferenceImages needs from a generation packet. */
export interface PacketLike {
  generationAssets: Array<{
    role: string;
    asset: {
      id: string;
      fileUrl: string | null;
      mimeType?: string | null;
      description?: string | null;
      name?: string | null;
      characterIdentityNote?: string | null;
    };
  }>;
}

/** Brand-asset references from an assembled packet. */
export async function buildReferenceImages(packet: PacketLike): Promise<ReferenceImage[]> {
  const refs: ReferenceImage[] = [];

  for (const entry of packet.generationAssets.slice(0, MAX_IMAGE_REFERENCES)) {
    if (!entry.asset.fileUrl) continue;
    try {
      const buffer = await readFileByUrl(entry.asset.fileUrl);
      if (buffer) {
        refs.push({
          imageBuffer: buffer,
          mimeType: entry.asset.mimeType || "image/png",
          role: entry.role === "style_reference" ? "style_reference" : "subject_reference",
          source: "packet",
          assetId: entry.asset.id,
          description:
            entry.role !== "style_reference" && entry.asset.characterIdentityNote
              ? entry.asset.characterIdentityNote
              : entry.asset.description || entry.asset.name || undefined,
        });
      }
    } catch (err) {
      console.error(
        `Failed to load reference image for asset ${entry.asset.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return refs;
}

/**
 * Merge persona samples into the packet references.
 *
 * Persona refs get GUARANTEED slots: when a persona is selected its samples (up
 * to MAX_PERSONA_REFERENCES) are always attached, and the remaining budget goes
 * to packet subjects first, then packet style refs. Final order stays
 * subjects then persona then styles, so the prompt's numbered descriptions match
 * the attach order.
 */
export function mergePersonaReferences(
  base: ReferenceImage[],
  personaRefs: ReferenceImage[],
): ReferenceImage[] {
  if (personaRefs.length === 0) return base.slice(0, MAX_IMAGE_REFERENCES);
  const guaranteed = personaRefs.slice(0, MAX_PERSONA_REFERENCES);
  const remaining = Math.max(0, MAX_IMAGE_REFERENCES - guaranteed.length);
  const subjects = base.filter(r => r.role === "subject_reference");
  const styles = base.filter(r => r.role === "style_reference");
  const keptBase = [...subjects, ...styles].slice(0, remaining);
  return [
    ...keptBase.filter(r => r.role === "subject_reference"),
    ...guaranteed,
    ...keptBase.filter(r => r.role === "style_reference"),
  ];
}

/**
 * One-line summary of what was actually attached.
 *
 * Feeds the reasoning log and the Material rail, so the Influences trail can show
 * the designer was used rather than leaving the user to assume it.
 */
export function personaNoteFor(
  persona: DesignerPersona | null,
  personaRefs: ReferenceImage[],
): string | null {
  if (!persona) return null;
  return personaRefs.length > 0
    ? `Designer persona "${persona.name}": ${personaRefs.length} work-sample reference(s) attached with guaranteed slots`
    : `Designer persona "${persona.name}" applied via style fingerprint (no reference images available)`;
}
