import { useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "@/lib/utils";

/**
 * The `@` mention machinery, shared by every surface that takes a brief line.
 *
 * This existed only inside BriefStage, which stopped being the only composer
 * the moment the entrance became stage 01 (doc 38 §3): the entrance advertised
 * "@ attaches an asset" in its own hint row while writing a take with no
 * mentions at all, so a brief that named a character shipped without pinning
 * one — found because a comparison run's spread came back with the wrong girl.
 * One module, two consumers, no second copy to drift.
 */

/**
 * An asset the user attached by typing `@` in their own sentence.
 *
 * The line is the artifact and this list is an index onto it: every keystroke
 * reconciles the two, so deleting the text deletes the attachment. A mention
 * that outlived its text would attach a picture to generation that the user
 * believes they removed, in a product whose whole argument is that you can see
 * what the model is using.
 */
export interface Mention {
  assetId: string;
  name: string;
  role: "subject" | "style" | "object";
}

export interface AssetOption {
  id: string;
  name: string;
  assetClass: string | null;
  compositingOnly: boolean | null;
  thumbnailUrl: string | null;
  fileUrl: string | null;
  generationAllowed?: boolean | null;
  approvedForCompositing?: boolean | null;
}

/**
 * Why this asset cannot be attached, or undefined when it can.
 *
 * Mirrors the Co-pilot picker's rule (SessionView.tsx) and, through it,
 * checkGenerationEligibility on the server — which explore now enforces on
 * every mention regardless of what a client showed. Found the hard way: this
 * picker offered crownu_char_female_blue_tennis while the legacy picker
 * refused her ("Not approved for AI generation" — the Nike swoosh on her
 * chest), and a spread rendered from an owner-blocked asset.
 */
export function ineligibleReasonFor(a: AssetOption): string | undefined {
  const isMark = Boolean(a.compositingOnly || a.assetClass === "compositing");
  if (isMark) {
    if (a.assetClass === "compositing" && a.approvedForCompositing === false) {
      return "Not approved for logo use";
    }
    return undefined;
  }
  if (a.generationAllowed === false) return "Not approved for AI generation";
  return undefined;
}

/** Mirrors roleForAssetClass on the server, so both ends agree what a pick is. */
export function roleFor(assetClass: string | null, compositingOnly: boolean | null): Mention["role"] {
  if (compositingOnly || assetClass === "compositing") return "object";
  if (assetClass === "style_reference") return "style";
  if (assetClass === "subject_reference") return "subject";
  return "object";
}

export const ROLE_LABEL: Record<Mention["role"], string> = {
  subject: "subject",
  style: "style",
  object: "mark",
};

/** How far back from the caret an unterminated `@` can still be live. */
const MAX_QUERY_CHARS = 48;

/**
 * The mention being typed at the caret, if any. Mirrors activeMentionQuery on
 * the server; spaces are allowed because real asset names have them.
 */
export function activeQuery(line: string, caret: number): { start: number; query: string } | null {
  if (caret < 1 || caret > line.length) return null;
  for (let i = caret - 1; i >= 0 && caret - i <= MAX_QUERY_CHARS; i--) {
    const ch = line[i];
    if (ch === "\n") return null;
    if (ch !== "@") continue;
    const prev = i > 0 ? line[i - 1] : null;
    if (prev !== null && !/\s/.test(prev)) return null;
    return { start: i, query: line.slice(i + 1, caret) };
  }
  return null;
}

/** Drop every mention whose `@name` token no longer appears in the line. */
export function reconcile(mentions: Mention[], line: string): Mention[] {
  const seen = new Set<string>();
  return mentions.filter((mn) => {
    if (seen.has(mn.assetId)) return false;
    if (!line.includes(`@${mn.name}`)) return false;
    seen.add(mn.assetId);
    return true;
  });
}

export interface MentionState {
  mentions: Mention[];
  setMentions: React.Dispatch<React.SetStateAction<Mention[]>>;
  picker: { start: number; query: string } | null;
  setPicker: React.Dispatch<React.SetStateAction<{ start: number; query: string } | null>>;
  highlight: number;
  setHighlight: React.Dispatch<React.SetStateAction<number>>;
  matches: AssetOption[];
  assetsLoaded: boolean;
  /** Call from onChange: reconciles mentions and re-derives the picker. */
  onLineChange: (next: string, caret: number) => void;
  /** Call from onClick with the caret so a click inside `@…` reopens the picker. */
  onCaretMove: (line: string, caret: number) => void;
  /** Call from onBlur; delayed so a click on a picker row lands first. */
  onBlur: () => void;
  /**
   * Call FIRST in onKeyDown. Handles the arrows and Escape; returns true when
   * the key drove the picker and the caller must not also act on it. Enter and
   * Tab stay with the CALLER (each composer decides what a bare Enter means —
   * newline in stage 01, submit on the entrance): when the picker is open with
   * matches, choose `matches[highlight]` and preventDefault.
   */
  onKeyDown: (e: React.KeyboardEvent) => boolean;
  /** Insert the chosen asset at the active query. Returns the updated line. */
  choose: (asset: AssetOption, line: string, caret: number) => { line: string; caret: number } | null;
}

/**
 * Picker state for one textarea. The hook owns mentions/picker/matches and the
 * brand's asset list (loaded once, on first `@`, scoped to the brand in the
 * QUERY — another brand's character cannot be attached to this post by
 * accident). The caller owns the line itself.
 */
export function useMentions(brandId: string | null): MentionState {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [picker, setPicker] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  // A brand swap empties the index: mentions are brand-scoped by construction.
  const lastBrand = useRef(brandId);
  useEffect(() => {
    if (lastBrand.current !== brandId) {
      lastBrand.current = brandId;
      setMentions([]);
      setAssets([]);
      setPicker(null);
    }
  }, [brandId]);

  useEffect(() => {
    if (!brandId || picker === null || assets.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/assets?brandId=${encodeURIComponent(brandId)}&type=visual`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const rows = Array.isArray(body) ? body : (body?.assets ?? body?.data ?? []);
        if (cancelled) return;
        setAssets(
          rows
            .filter((a: AssetOption) => Boolean(a.fileUrl))
            .map((a: AssetOption) => ({
              id: a.id,
              name: a.name,
              assetClass: a.assetClass ?? null,
              compositingOnly: a.compositingOnly ?? null,
              thumbnailUrl: a.thumbnailUrl ?? null,
              fileUrl: a.fileUrl ?? null,
              generationAllowed: a.generationAllowed ?? null,
              approvedForCompositing: a.approvedForCompositing ?? null,
            })),
        );
      } catch {
        // A picker that cannot load is a picker that shows nothing, which is
        // visibly empty rather than silently wrong. Typing still works.
      }
    })();
    return () => { cancelled = true; };
  }, [brandId, picker, assets.length]);

  /** Matches on the query, capped so the list stays scannable. */
  const matches = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.trim().toLowerCase();
    const pool = q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets;
    return pool.slice(0, 8);
  }, [picker, assets]);

  return {
    mentions,
    setMentions,
    picker,
    setPicker,
    highlight,
    setHighlight,
    matches,
    assetsLoaded: assets.length > 0,
    onLineChange: (next, caret) => {
      setMentions((prev) => reconcile(prev, next));
      setPicker(activeQuery(next, caret));
      setHighlight(0);
    },
    onCaretMove: (line, caret) => {
      setPicker(activeQuery(line, caret));
    },
    onBlur: () => {
      window.setTimeout(() => setPicker(null), 120);
    },
    onKeyDown: (e) => {
      if (!picker || matches.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % matches.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPicker(null);
        return true;
      }
      return false;
    },
    choose: (asset, line, caret) => {
      // The picker row already says why; refusing here keeps keyboard Enter
      // honest too. The server gate in explore is the real fence.
      if (ineligibleReasonFor(asset)) return null;
      const active = picker ?? activeQuery(line, caret);
      if (!active) return null;
      const token = `@${asset.name} `;
      const next = line.slice(0, active.start) + token + line.slice(caret);
      setMentions((prev) =>
        prev.some((mn) => mn.assetId === asset.id)
          ? prev
          : [...prev, { assetId: asset.id, name: asset.name, role: roleFor(asset.assetClass, asset.compositingOnly) }],
      );
      setPicker(null);
      return { line: next, caret: active.start + token.length };
    },
  };
}

/** The dropdown, shared verbatim so both composers offer the same picker. */
export function MentionPickerList({
  m,
  pickerId,
  onChoose,
}: {
  m: MentionState;
  pickerId: string;
  onChoose: (asset: AssetOption) => void;
}) {
  if (!m.picker) return null;
  return (
    <div
      id={pickerId}
      role="listbox"
      className="absolute left-0 top-full z-20 mt-1 w-full max-w-md overflow-hidden rounded-sm border border-border bg-raised shadow-lg"
    >
      {m.matches.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-dim">
          {!m.assetsLoaded
            ? "Loading this brand's assets..."
            : `Nothing in this brand's library matches "${m.picker.query}".`}
        </p>
      ) : (
        m.matches.map((a, i) => {
          const blocked = ineligibleReasonFor(a);
          return (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={i === m.highlight}
              aria-disabled={Boolean(blocked)}
              onMouseEnter={() => m.setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (!blocked) onChoose(a); }}
              className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${
                i === m.highlight && !blocked ? "bg-grit-teal/15" : ""
              } ${blocked ? "cursor-not-allowed opacity-55" : ""}`}
            >
              {a.thumbnailUrl || a.fileUrl ? (
                <img src={a.thumbnailUrl || a.fileUrl || ""} alt="" className="h-8 w-8 shrink-0 rounded-sm object-cover" />
              ) : (
                <span className="h-8 w-8 shrink-0 rounded-sm border border-border" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{a.name}</span>
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.09em] text-dim">
                {blocked ?? ROLE_LABEL[roleFor(a.assetClass, a.compositingOnly)]}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

/** The standing record of what is attached; the picker itself is transient. */
export function MentionChips({ mentions }: { mentions: Mention[] }) {
  if (mentions.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {mentions.map((mn) => (
        <span
          key={mn.assetId}
          className="inline-flex items-center gap-1.5 rounded-sm border border-grit-teal/40 px-1.5 py-0.5 text-[10.5px] text-foreground"
        >
          <span className="truncate max-w-[220px]">{mn.name}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-grit-teal">{ROLE_LABEL[mn.role]}</span>
        </span>
      ))}
    </div>
  );
}
