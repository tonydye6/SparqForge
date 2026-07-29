import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

import { apiFetch } from "@/lib/utils";

/**
 * The brand contract block.
 *
 * Spec: `20_SPEC_00_PRINCIPLES.md` §1.9, and `22_IMPLEMENTATION_PLAN.md` Phase 4
 * item 8 ("the locked brand contract block, reading the M1 fields").
 *
 * §1.9: the brand is the frame, not a stage and not a setting. It renders as a
 * permanently locked block at the top of the Material rail on every screen, with
 * no remove control, showing palette, voice, sound and narrator. Switching brand
 * is a different post, not a revision, which is why there is nothing to change
 * here: the block is a statement of what is already true.
 *
 * Sound and narrator come from the M1 columns. They are shown as absent rather
 * than hidden when unset, because a brand with no narrator and a brand whose
 * narrator we failed to load are different facts, and only one of them means
 * "go and set one".
 */

interface BrandContractProps {
  brandId: string | null;
}

interface BrandRecord {
  id: string;
  name: string;
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
  voiceDescription: string;
  soundDirection: string | null;
  narratorDescription: string | null;
  narratorVoiceId: string | null;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="border-b border-border/40 py-1.5 last:border-b-0">
    <p className="font-mono text-[7.5px] uppercase tracking-[0.09em] text-dim">{label}</p>
    <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{children}</div>
  </div>
);

/** Absent is a fact, and reads differently from unknown. */
const Unset = ({ what }: { what: string }) => (
  <span className="text-dim">No {what} on the brand record</span>
);

export function BrandContract({ brandId }: BrandContractProps) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!brandId) {
      setBrand(null);
      return;
    }
    void (async () => {
      try {
        const res = await apiFetch(`/api/brands/${brandId}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as BrandRecord;
        if (!cancelled) {
          setBrand(body);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  return (
    <div className="border-b border-border/60 bg-grit-teal/[0.05] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Lock size={9} className="text-cyber-teal" />
        <span className="font-display text-[13px] uppercase tracking-[0.08em] text-foreground">
          {brand?.name ?? "Brand"}
        </span>
        <span className="ml-auto font-mono text-[8px] tracking-[0.07em] text-grit-teal">
          NON-NEGOTIABLE
        </span>
      </div>

      {failed && (
        <p className="mt-1.5 font-mono text-[8px] leading-relaxed tracking-[0.07em] text-rebel-pink">
          THE BRAND RECORD COULD NOT BE READ. WHAT IS BELOW MAY BE INCOMPLETE.
        </p>
      )}

      {brand ? (
        <div className="mt-1.5">
          <Row label="Palette">
            <div className="flex items-center gap-1">
              {[brand.colorPrimary, brand.colorSecondary, brand.colorAccent]
                .filter(Boolean)
                .map((c) => (
                  <span
                    key={c}
                    className="h-3.5 w-3.5 rounded-sm border border-border/60"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              {/* §1.6: client brand colours are content identity, never chrome.
                  They are shown as swatches here, and never applied to the UI. */}
            </div>
          </Row>
          <Row label="Voice">
            {brand.voiceDescription?.trim() ? brand.voiceDescription : <Unset what="voice" />}
          </Row>
          <Row label="Sound">
            {brand.soundDirection?.trim() ? brand.soundDirection : <Unset what="sound direction" />}
          </Row>
          <Row label="Narrator">
            {brand.narratorDescription?.trim() ? (
              brand.narratorDescription
            ) : brand.narratorVoiceId ? (
              <span className="font-mono text-[9.5px]">{brand.narratorVoiceId}</span>
            ) : (
              <Unset what="narrator" />
            )}
          </Row>
          <p className="mt-1.5 font-mono text-[7.5px] leading-relaxed tracking-[0.07em] text-dim">
            CANNOT BE REMOVED HERE · CHANGING BRAND IS A DIFFERENT POST
          </p>
        </div>
      ) : (
        <p className="mt-1.5 font-mono text-[8px] leading-relaxed tracking-[0.07em] text-dim">
          {brandId ? "READING THE BRAND RECORD" : "NO BRAND ON THIS CREATIVE"}
        </p>
      )}
    </div>
  );
}
