import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  /** Carried so local narrowing can use the same predicate the server does. */
  description?: string | null;
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
 * How many candidates one keystroke asks the server for.
 *
 * This is a PAGE of a server-side search, not the index itself — see
 * `assetSearchUrl`. The number only decides how much of a broad match we show
 * before the user narrows it, so it is generous rather than exact.
 */
export const MENTION_FETCH_LIMIT = 50;

/** How long the typing has to settle before the search goes out. */
export const MENTION_SEARCH_DEBOUNCE_MS = 140;

/**
 * How much has to be typed after `@` before there is anything to search for.
 *
 * A bare `@` offers NOTHING. The picker is an answer to what the user is
 * typing, not a browser for the library: Crown U has ~1,300 visual assets, and
 * a list of "the newest fifty of those" is neither what was asked for nor
 * useful — it is just the old bug pointed at the other end of the table.
 */
export const MENTION_MIN_QUERY_CHARS = 1;

/** Beyond this, extra words are noise; mirrors MAX_SEARCH_TOKENS on the server. */
const MAX_SEARCH_TOKENS = 8;

/** Lowercase and strip everything that is not a letter or digit. */
export function compactText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The words in a typed phrase, lowercased and stripped of punctuation. */
export function searchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS);
}

/**
 * Does this asset answer this query?
 *
 * **Mirrors `lib/asset-search.ts` on the server, and must keep mirroring it.**
 * Every typed WORD has to appear somewhere in the name or description, with
 * separators stripped from both sides — so "Crown U logo" finds
 * `crownu_3d_logo`, and "crownu" finds `Crown U Logo`. Order and punctuation do
 * not matter; each extra word narrows.
 *
 * This runs only as a LOCAL narrowing of rows the server already returned,
 * while a fresh search for later keystrokes is still in flight. Matching more
 * loosely than the server would offer rows the server would not; matching more
 * strictly would hide rows it found. Hence one rule, stated twice, tested twice.
 */
export function matchesQuery(asset: Pick<AssetOption, "name" | "description">, query: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return false;
  const haystack = compactText(`${asset.name} ${asset.description ?? ""}`);
  return tokens.every((t) => haystack.includes(t));
}

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

/**
 * The URL that searches this brand's library for what the user is typing.
 *
 * **This is the fix for "new approved assets do not show up in the @ dropdown"
 * (Jeffrey, 14–20 Aug).** The picker used to ask for
 * `/api/assets?brandId=…&type=visual` with no `limit` and no `search`, take
 * whatever page came back, and filter it in memory. That page is the route's
 * default — 50 rows, ordered by `createdAt` ASCENDING. Crown U has ~1,300
 * visual assets, so the picker's entire universe was the 1,300 OLDEST fifty and
 * a just-added asset was ~1,250 rows out of reach. No amount of typing could
 * reach it, and approving it changed nothing because no part of this path has
 * ever looked at `status` — which is why "how do I get an approved asset
 * approved" had no answer.
 *
 * Two things move the search to where the data is:
 *   - `search` hands the query to Postgres, which sees all 1,300 rows.
 *   - `order=recent` makes the un-narrowed list newest-first, so something
 *     added a minute ago is at the top rather than a thousand rows down.
 */
export function assetSearchUrl(brandId: string, query: string, limit: number = MENTION_FETCH_LIMIT): string {
  const params = new URLSearchParams({
    brandId,
    type: "visual",
    limit: String(limit),
    order: "recent",
  });
  const trimmed = query.trim();
  // An empty `search` would be a filter matching nothing rather than no filter.
  if (trimmed) params.set("search", trimmed);
  return `/api/assets?${params.toString()}`;
}

/** Tallest the dropdown may ever be, so it stays a list and not a page. */
export const PICKER_MAX_HEIGHT = 320;

/** Under this much room the list is too stubby to use; flip it instead. */
export const PICKER_MIN_HEIGHT = 132;

const PICKER_GAP = 4;
const VIEWPORT_MARGIN = 8;

export interface PickerPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "below" | "above";
}

/**
 * Where the dropdown goes, in viewport coordinates.
 *
 * **This is the fix for "the dropdown is cutting off at bottom and I cannot
 * scroll down further".** The list used to be an in-flow absolutely-positioned
 * child with `overflow-hidden`, no height bound, and a hard `top-full`. Every
 * composer that hosts it sits inside StudioV2's `min-h-0 flex-1
 * overflow-y-auto` pane, so any row past the pane's bottom edge was clipped by
 * that ancestor — and unreachable, because the list had no scrollbar of its own
 * and scrolling the pane moved the composer and the dropdown together.
 *
 * So the list is measured against the VIEWPORT and rendered into the body (see
 * MentionPickerList): it is bounded, it can always scroll itself, and it opens
 * upward when the composer is near the bottom of the screen.
 */
export function placePicker(
  anchor: { top: number; bottom: number; left: number; width: number },
  viewportHeight: number,
): PickerPlacement {
  const roomBelow = viewportHeight - anchor.bottom - PICKER_GAP - VIEWPORT_MARGIN;
  const roomAbove = anchor.top - PICKER_GAP - VIEWPORT_MARGIN;
  const goAbove = roomBelow < PICKER_MIN_HEIGHT && roomAbove > roomBelow;

  const room = Math.max(goAbove ? roomAbove : roomBelow, 0);
  const maxHeight = Math.min(PICKER_MAX_HEIGHT, room);

  const top = goAbove
    ? Math.max(anchor.top - PICKER_GAP - maxHeight, VIEWPORT_MARGIN)
    : Math.min(anchor.bottom + PICKER_GAP, Math.max(viewportHeight - maxHeight, 0));

  return { top, left: anchor.left, width: anchor.width, maxHeight, placement: goAbove ? "above" : "below" };
}

/** Hold a value still until the typing stops, so one search goes out, not ten. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export interface MentionState {
  mentions: Mention[];
  setMentions: React.Dispatch<React.SetStateAction<Mention[]>>;
  picker: { start: number; query: string } | null;
  setPicker: React.Dispatch<React.SetStateAction<{ start: number; query: string } | null>>;
  highlight: number;
  setHighlight: React.Dispatch<React.SetStateAction<number>>;
  matches: AssetOption[];
  /** True while a search for the CURRENT query is still in flight. */
  loading: boolean;
  /** True when `@` is open but too little has been typed to search yet. */
  needsQuery: boolean;
  /**
   * True when there is no brand to search. Distinct from "no match": the
   * library was never queried, so saying nothing matched would be a definitive
   * answer nobody asked for — and reporting "loading" forever, which is what
   * this used to do, is no better.
   */
  noBrand: boolean;
  /**
   * How many assets the server says match, which can exceed what it returned.
   * Shown to the user, because a silently truncated list is how "my asset is
   * not in there" happens in the first place.
   */
  totalMatching: number;
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
 * Picker state for one textarea. The hook owns mentions/picker/matches and
 * SEARCHES the brand's library on the server as the user types — scoped to the
 * brand in the query, so another brand's character cannot be attached to this
 * post by accident. The caller owns the line itself.
 */
export function useMentions(brandId: string | null): MentionState {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [totalMatching, setTotalMatching] = useState(0);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const open = picker !== null;
  // Case is preserved: the server matches case-insensitively, and sending the
  // user's own text back to them in an error message reads better.
  const live = (picker?.query ?? "").trim();
  const query = useDebounced(live, MENTION_SEARCH_DEBOUNCE_MS);
  const searchable = live.length >= MENTION_MIN_QUERY_CHARS;

  // A brand swap empties the index: mentions are brand-scoped by construction.
  const lastBrand = useRef(brandId);
  useEffect(() => {
    if (lastBrand.current !== brandId) {
      lastBrand.current = brandId;
      setMentions([]);
      setAssets([]);
      setLoadedQuery(null);
      setPicker(null);
    }
  }, [brandId]);

  useEffect(() => {
    // No query, no request. `@` on its own is not a search for everything.
    if (!brandId || !open || query.length < MENTION_MIN_QUERY_CHARS) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(assetSearchUrl(brandId, query));
        if (cancelled) return;
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(body) ? body : (body?.data ?? body?.assets ?? []);
        setAssets(
          (rows as AssetOption[])
            .filter((a) => Boolean(a.fileUrl))
            .map((a) => ({
              id: a.id,
              name: a.name,
              assetClass: a.assetClass ?? null,
              compositingOnly: a.compositingOnly ?? null,
              description: a.description ?? null,
              thumbnailUrl: a.thumbnailUrl ?? null,
              fileUrl: a.fileUrl ?? null,
              generationAllowed: a.generationAllowed ?? null,
              approvedForCompositing: a.approvedForCompositing ?? null,
            })),
        );
        setLoadedQuery(query);
        setTotalMatching(typeof body?.total === "number" ? body.total : 0);
      } catch {
        // A picker that cannot load is a picker that shows nothing, which is
        // visibly empty rather than silently wrong. Typing still works.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [brandId, open, query]);

  /**
   * The rows to offer, which must ALWAYS answer the text on screen right now.
   *
   * The server searched the whole library, but its answer is one debounce plus
   * one round-trip behind the keystrokes. Showing that answer raw meant the list
   * could disagree with the typed text for ~150ms — and since every composer
   * commits `matches[highlight]` on Enter, a fast typist attached an asset they
   * never named. So while the loaded rows answer an older query, they are
   * narrowed locally with the server's own predicate: strictly fewer rows, never
   * a wrong one, and no flicker.
   */
  const matches = useMemo(() => {
    if (!picker || !searchable) return [];
    if (loadedQuery === live) return assets;
    return assets.filter((a) => matchesQuery(a, live));
  }, [picker, searchable, assets, loadedQuery, live]);

  return {
    mentions,
    setMentions,
    picker,
    setPicker,
    highlight,
    setHighlight,
    matches,
    // Still settling counts as loading: the rows on screen answer the previous
    // keystroke, so claiming "nothing matches" here would be a lie.
    // Never "loading" without a brand: that request is not pending, it is
    // never going to be made.
    loading: Boolean(brandId) && searchable && (loading || loadedQuery !== live),
    needsQuery: !searchable,
    noBrand: !brandId,
    totalMatching,
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

/**
 * The dropdown, shared verbatim so every composer offers the same picker.
 *
 * Rendered into `document.body` rather than in place: every host sits inside a
 * scrolling pane, and an in-flow popover is clipped by that pane's
 * `overflow-y-auto` the moment it is longer than the room beneath the composer.
 * Fixed positioning against the viewport is the only placement that cannot be
 * cut off by an ancestor — and it is re-measured on scroll and resize so it
 * stays glued to the composer while the pane moves under it.
 */
export function MentionPickerList({
  m,
  pickerId,
  onChoose,
}: {
  m: MentionState;
  pickerId: string;
  onChoose: (asset: AssetOption) => void;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<PickerPlacement | null>(null);

  const open = m.picker !== null;
  const rowCount = m.matches.length;

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const host = anchorRef.current?.parentElement;
      if (!host) return;
      const r = host.getBoundingClientRect();
      // Scrolled out of the pane: a fixed-position list would otherwise stay
      // pinned to the viewport edge, floating over unrelated content.
      if (r.bottom < 0 || r.top > window.innerHeight) {
        setPlace(null);
        return;
      }
      setPlace(
        placePicker(
          { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
          window.innerHeight,
        ),
      );
    };
    measure();
    // Capture, so the composer's own scrolling ancestor is heard too.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, rowCount]);

  // Arrowing past the fold has to bring the row with it, or the keyboard walks
  // into the part of the list the user just complained they cannot see.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [open, m.highlight]);

  // A zero-size, display:none marker whose only job is to name the element the
  // dropdown is anchored to, so no caller has to pass a ref. It is rendered
  // unconditionally, and always in the same slot, so opening the picker never
  // remounts it and loses the ref the measurement depends on.
  const anchor = <span ref={anchorRef} aria-hidden className="hidden" />;

  const list = !open || !place ? null : (
    <div
      ref={listRef}
      id={pickerId}
      role="listbox"
      data-placement={place.placement}
      style={{
        position: "fixed",
        top: place.top,
        left: place.left,
        width: place.width,
        maxHeight: place.maxHeight,
      }}
      className="z-50 max-w-md overflow-y-auto overscroll-contain rounded-sm border border-border bg-raised shadow-lg"
    >
      {rowCount === 0 ? (
        <p className="px-3 py-2 text-[11px] text-dim">
          {m.noBrand
            ? "Pick a brand before attaching one of its assets."
            : m.needsQuery
              ? "Type a name to search this brand's library."
              : m.loading
                ? "Searching this brand's library..."
                : `Nothing in this brand's library matches "${(m.picker?.query ?? "").trim()}".`}
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
              data-highlighted={i === m.highlight ? "true" : "false"}
              onMouseEnter={() => m.setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (!blocked) onChoose(a); }}
              className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${
                i === m.highlight && !blocked ? "bg-grit-teal/15" : ""
              } ${blocked ? "cursor-not-allowed opacity-55" : ""}`}
            >
              {a.thumbnailUrl || a.fileUrl ? (
                // `thumbnailUrl` is set to the SAME object as `fileUrl` by the
                // uploader, so every row here is a full-size asset file. Only
                // fetch the handful actually scrolled into view.
                <img
                  src={a.thumbnailUrl || a.fileUrl || ""}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-8 w-8 shrink-0 rounded-sm object-cover"
                />
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
      {rowCount > 0 && m.totalMatching > rowCount && (
        <p
          className="border-t border-border/60 px-2.5 py-1.5 text-[10px] text-dim"
          data-testid="mention-truncated"
        >
          Showing {rowCount} of {m.totalMatching} {"\u00b7"} add a word to narrow
        </p>
      )}
    </div>
  );

  return (
    <>
      {anchor}
      {list && createPortal(list, document.body)}
    </>
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
