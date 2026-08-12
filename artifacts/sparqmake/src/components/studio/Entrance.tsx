import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { useCanWrite } from "@/hooks/useAuth";
import { InfoDot } from "./InfoDot";
import { MentionChips, MentionPickerList, reconcile, useMentions, type AssetOption } from "./mentions";
import { SavedRunsPanel } from "./SavedRuns";

/**
 * The entrance. /studio-v2 IS stage 01.
 *
 * Spec: the approved mock (artifact 6056f09f, screens 1-3) and Tony's rules
 * from its review, all of which are structural here rather than copy:
 *
 *   - Typing a line and pressing Start creates the post. No picker screen,
 *     no paragraph explaining the product to the user.
 *   - Improve is an ACTION on the composer: one press, one proposal, the
 *     user's line struck through but intact until they choose Replace.
 *   - "Let a director lead" is a REAL conversation. Chips on the director's
 *     last message are shortcuts, never the only answers, and the
 *     brief-so-far renders whose words are whose.
 *   - Recent posts and saved runs stay reachable on the rail. Nobody is
 *     forced into starting new OR forced into a previous session; both
 *     failure modes have now happened once each.
 *
 * Nothing here writes until Start. Improve and the conversation are stateless
 * server calls; closing the tab mid-conversation loses nothing but words.
 */

interface BrandRow {
  id: string;
  name: string;
  colorPrimary?: string | null;
}

interface Concept {
  title: string;
  angle: string;
  intent: string;
  intentLabel?: string;
}

/** One MOMENT of the post. See BriefStage: a shot is a moment, not a framing. */
interface Shot {
  n: number;
  text: string;
  provenance: "you" | "inferred" | "brand";
}

type PostShape = "single" | "sequence";

/** Mirrors the server's cap. Past this it is a film, not a post. */
const MAX_SHOTS = 6;

/** Contiguous from 1 always — the storyboard's slot families are named off these. */
const renumberShots = (rows: Shot[]): Shot[] =>
  rows.slice(0, MAX_SHOTS).map((s, i) => ({ ...s, n: i + 1 }));

/** Long enough not to bill a model call on every keystroke. Same as stage 01's. */
const INTAKE_DEBOUNCE_MS = 900;
/** Below this there is nothing to read for moments. */
const MIN_WORDS_TO_READ = 5;

interface CollabMsg {
  role: "you" | "director";
  text: string;
  chips?: string[];
  assumption?: string | null;
}

interface RecentRow {
  id: string;
  name: string;
  status: string;
  /** The picked image, when the post has one — the grid is pictures. */
  previewImageUrl?: string | null;
  /** Last touched, so three same-named drafts stop being interchangeable. */
  at?: string | null;
}

const INTENT_LABELS: Record<string, string> = {
  awareness: "Awareness",
  acquisition: "Acquisition",
  community_engagement: "Community engagement",
  recognition_reward: "Recognition",
  announcement_launch: "Announcement / launch",
  education: "Education",
  retention: "Retention",
};

export function Entrance({
  recent,
  onOpen,
}: {
  recent: RecentRow[];
  onOpen: (creativeId: string) => void;
}) {
  const canWrite = useCanWrite();

  // ---- brand ----
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [brandOpen, setBrandOpen] = useState(false);
  const brand = brands.find((b) => b.id === brandId) ?? null;

  // ---- the line ----
  const [line, setLine] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /*
   * `@` mentions, the same machinery as stage 01's composer. This entrance IS
   * stage 01 (doc 38 §3), and it already SAID "@ attaches an asset" while
   * writing takes with no mentions — a brief naming a character shipped
   * without pinning one, and the director guessed a different girl.
   */
  const m = useMentions(brandId);

  function chooseMention(asset: AssetOption) {
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : line.length;
    const r = m.choose(asset, line, caret);
    if (!r) return;
    setLine(r.line);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  }

  // ---- improve ----
  const [improving, setImproving] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);

  // ---- the conversation ----
  const [collab, setCollab] = useState(false);
  const [director, setDirector] = useState<{ id: string; name: string }>({ id: "house", name: "House style" });
  const [directors, setDirectors] = useState<Array<{ id: string; name: string }>>([]);
  const [swapOpen, setSwapOpen] = useState(false);
  const [thread, setThread] = useState<CollabMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [talking, setTalking] = useState(false);
  const [framing, setFraming] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);

  // ---- concepts ----
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [rolling, setRolling] = useState(false);

  /* ---- the story path, step 4a (the mockup's screen 1) ----------------------
   *
   * This screen IS stage 01, so the shot list belongs here: the decision has to
   * be visible BEFORE Start, because Start is what saves the brief and a
   * hand-typed brief locks its own stage.
   *
   * The intake behind it is the SAME call `start()` already makes. It is cached
   * against the exact line it read, and `start()` reuses a fresh cache instead
   * of asking again — so showing the shot list is cost-neutral for anyone who
   * pauses once before starting, rather than a second billed call per post.
   */
  const [shape, setShape] = useState<PostShape>("single");
  const [shots, setShots] = useState<Shot[]>([]);
  const [suggested, setSuggested] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const shapeChosenRef = useRef(false);
  /** The intake result and the exact line it was read from. */
  const intakeRef = useRef<{ line: string; derived: unknown[]; intentId: string | null } | null>(null);
  const intakeAbort = useRef<AbortController | null>(null);
  const intakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void apiFetch("/api/brands")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const rows: BrandRow[] = Array.isArray(d) ? d : (d?.data ?? []);
        setBrands(rows);
        setBrandId((prev) => prev ?? rows[0]?.id ?? null);
      })
      .catch(() => setBrands([]));
    void apiFetch("/api/designer-personas")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const rows = (Array.isArray(d) ? d : (d?.data ?? [])) as Array<{ id: string; name: string }>;
        setDirectors([{ id: "house", name: "House style" }, ...rows.map((p) => ({ id: p.id, name: p.name }))]);
      })
      .catch(() => setDirectors([{ id: "house", name: "House style" }]));
  }, []);

  /*
   * Cached per brand per day. Every entrance visit used to pay a fresh model
   * call and add seconds to first paint, and the ideas a user glanced at were
   * gone on return (doc 40 P2.11). Re-roll is the explicit "pay for fresh
   * ones" — it bypasses the cache and replaces it.
   */
  const conceptCacheKey = (forBrand: string) =>
    `sparqmake.concepts.${forBrand}.${new Date().toISOString().slice(0, 10)}`;

  const rollConcepts = useCallback(async (forBrand: string, force = false) => {
    if (!force) {
      try {
        const cached = localStorage.getItem(conceptCacheKey(forBrand));
        if (cached) {
          setConcepts(JSON.parse(cached) as Concept[]);
          return;
        }
      } catch { /* an unreadable cache is an empty cache */ }
    }
    setRolling(true);
    try {
      const res = await apiFetch("/api/concept-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: forBrand, count: 3 }),
      });
      if (!res.ok) return;
      const body = await res.json();
      const rows = body.concepts ?? body.data ?? [];
      setConcepts(rows);
      try { localStorage.setItem(conceptCacheKey(forBrand), JSON.stringify(rows)); } catch { /* full storage loses only the cache */ }
    } catch {
      // Concepts are an offer, not a dependency; the composer works without them.
    } finally {
      setRolling(false);
    }
  }, []);

  useEffect(() => {
    if (brandId) void rollConcepts(brandId);
  }, [brandId, rollConcepts]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, talking]);

  // ---- improve ----
  async function improve() {
    if (!brandId || !line.trim() || improving) return;
    setImproving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/brief-improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, briefText: line }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The improvement could not be made. Your line is untouched.");
        return;
      }
      setProposal(body.proposal);
    } finally {
      setImproving(false);
    }
  }

  // ---- the conversation ----
  async function send(text: string) {
    if (!brandId || !text.trim() || talking) return;
    const next: CollabMsg[] = [...thread, { role: "you", text: text.trim() }];
    setThread(next);
    setDraft("");
    setTalking(true);
    setError(null);
    try {
      const res = await apiFetch("/api/brief-collab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          personaId: director.id === "house" ? null : director.id,
          messages: next.map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The director could not answer. Nothing was lost.");
        return;
      }
      setThread((prev) => [
        ...prev,
        { role: "director", text: body.reply.message, chips: body.reply.chips, assumption: body.reply.assumption },
      ]);
      setFraming(body.brief.directors ?? "");
    } finally {
      setTalking(false);
    }
  }

  function openCollab() {
    setCollab(true);
    setProposal(null);
    // The typed line opens the conversation, so the director has something to
    // react to; an empty line just opens the room.
    if (line.trim() && thread.length === 0) void send(line);
  }

  // ---- start ----
  const yours = collab
    ? thread.filter((m) => m.role === "you").map((m) => m.text).join(" ") || line
    : line;

  /**
   * Read the line for moments, once it has settled.
   *
   * The result is cached against the exact text it read, which is what lets
   * `start()` reuse it. An abandoned request is aborted rather than left to land
   * late — both because it would overwrite newer rows and because nobody should
   * be billed for an answer to a line they have already replaced.
   */
  const readForShots = useCallback(async (text: string) => {
    intakeAbort.current?.abort();
    const controller = new AbortController();
    intakeAbort.current = controller;
    setReading(true);
    try {
      const res = await apiFetch("/api/brief-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefText: text, ...(brandId ? { brandId } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok || controller.signal.aborted) return;
      const intake = (await res.json()) as {
        derived?: unknown[];
        intent?: { id?: string } | null;
        shots?: Shot[];
        readsAsStory?: boolean;
      };
      if (controller.signal.aborted) return;
      intakeRef.current = {
        line: text,
        derived: intake.derived ?? [],
        intentId: intake.intent?.id ?? null,
      };
      setSuggested(Boolean(intake.readsAsStory));
      // Never overwrite shots somebody has edited, and never override a chosen
      // shape — the same rule stage 01 holds.
      setShots((current) => (current.some((s) => s.provenance === "you") ? current : intake.shots ?? []));
      if (!shapeChosenRef.current) setShape(intake.readsAsStory ? "sequence" : "single");
    } catch {
      // A failed read leaves the entrance exactly as it was. Start still works,
      // and pays for its own intake as it always did.
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (intakeTimer.current) clearTimeout(intakeTimer.current);
    const text = yours.trim();
    if (!canWrite || text.split(/\s+/).filter(Boolean).length < MIN_WORDS_TO_READ) {
      intakeAbort.current?.abort();
      setReading(false);
      return;
    }
    if (intakeRef.current?.line === text) return;
    intakeTimer.current = setTimeout(() => void readForShots(text), INTAKE_DEBOUNCE_MS);
    return () => { if (intakeTimer.current) clearTimeout(intakeTimer.current); };
  }, [yours, canWrite, readForShots]);

  useEffect(() => () => intakeAbort.current?.abort(), []);

  /* ---- shot list edits. All free. ---- */
  function chooseShape(next: PostShape) {
    shapeChosenRef.current = true;
    setShape(next);
  }
  function editShot(n: number, text: string) {
    setShots((rows) => rows.map((s) => (s.n === n ? { ...s, text, provenance: "you" } : s)));
  }
  function addShot() {
    setShots((rows) => (rows.length >= MAX_SHOTS ? rows : renumberShots([...rows, { n: rows.length + 1, text: "", provenance: "you" }])));
  }
  function removeShot(n: number) {
    setShots((rows) => renumberShots(rows.filter((s) => s.n !== n)));
  }
  function dropShot(targetN: number) {
    if (dragging === null || dragging === targetN) return;
    setShots((rows) => {
      const moved = rows.find((s) => s.n === dragging);
      if (!moved) return rows;
      const rest = rows.filter((s) => s.n !== dragging);
      const at = rest.findIndex((s) => s.n === targetN);
      rest.splice(at < 0 ? rest.length : at, 0, moved);
      return renumberShots(rest);
    });
    setDragging(null);
  }
  const usableShots = shots.filter((s) => s.text.trim().length > 0);

  async function start() {
    if (!brandId || !yours.trim() || starting) return;
    setStarting(true);
    setError(null);
    try {
      const createRes = await apiFetch("/api/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId,
          name: yours.trim().slice(0, 80),
          briefText: yours.trim(),
          selectedAssets: [],
          createdBy: "studio-v2",
        }),
      });
      const creative = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !creative.id) {
        setError(creative.error ?? "The post could not be created.");
        return;
      }

      // The spine, then the brief's derivation — the same call stage 01 makes,
      // so a post born here is indistinguishable from one saved there.
      const spineRes = await apiFetch(`/api/creatives/${creative.id}/stages`);
      const spine = await spineRes.json().catch(() => ({ stages: [] }));
      const briefStage = (spine.stages ?? []).find((s: { stageKind: string }) => s.stageKind === "brief");

      let derived: unknown[] = [];
      let intentId: string | null = null;
      /*
       * Reuse the read the shot list already paid for, when it was read from
       * exactly this line. Asking again would bill a second identical Sonnet
       * call and could return a different goal than the one on screen.
       */
      const cached = intakeRef.current;
      if (cached && cached.line === yours.trim()) {
        derived = cached.derived;
        intentId = cached.intentId;
      } else {
        try {
          const intakeRes = await apiFetch("/api/brief-intake", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ briefText: yours.trim(), brandId }),
          });
          if (intakeRes.ok) {
            const intake = await intakeRes.json();
            derived = intake.derived ?? [];
            // The goal, in the same payload field stage 01 writes. Without it a
            // post born here planned its spread on default axes forever.
            intentId = intake.intent?.id ?? null;
          }
        } catch {
          // Derivation degrading never blocks a save; stage 01's own rule.
        }
      }

      if (briefStage) {
        await apiFetch(`/api/creatives/${creative.id}/stages/${briefStage.id}/takes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slotKey: "brief",
            origin: "user_typed",
            payload: {
              line: yours.trim(),
              /*
               * Only the mentions whose `@name` token survives in the line
               * actually being saved: Improve or a director-led rewrite may
               * have dropped the token, and a mention outliving its text
               * would attach a picture the user believes they removed.
               */
              mentions: reconcile(m.mentions, yours.trim()),
              intentId,
              derived,
              answers: [],
              /*
               * The story decision, born with the post (step 4a). Only shots
               * with words are saved, so an abandoned "+ Add a shot" cannot
               * become a beat somebody pays to generate; and a "sequence" of
               * fewer than two moments is saved as what it actually is.
               */
              shape: usableShots.length >= 2 && shape === "sequence" ? "sequence" : "single",
              shots: shape === "sequence"
                ? renumberShots(usableShots).map((s) => ({ n: s.n, text: s.text.trim(), provenance: s.provenance }))
                : [],
              // The director's framing rides beside the line, attributed, so
              // stage 03's planner can read it and stage 01 can render whose
              // words are whose.
              ...(collab && framing ? { collab: { directorId: director.id, name: director.name, framing } } : {}),
            },
            consumedFrom: [],
          }),
        });
      }

      onOpen(creative.id);
    } catch {
      setError("The post could not be created.");
    } finally {
      setStarting(false);
    }
  }

  const startable = Boolean(brandId && yours.trim()) && canWrite;

  return (
    <div className="flex h-full min-h-0">
      {/* ------------------------------------------------ centre */}
      <div className="mx-auto min-w-0 max-w-[820px] flex-1 overflow-y-auto px-10 py-12">
        {/* brand */}
        <div className="relative mb-7 flex items-center gap-2.5">
          <button
            onClick={() => setBrandOpen((v) => !v)}
            className="flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover-elevate"
            data-testid="button-brand"
          >
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: brand?.colorPrimary ?? "#666" }} />
            {brand?.name ?? "Pick a brand"}
            <ChevronDown size={11} className="text-dim" />
          </button>
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-dim">makes this post</span>
          {brandOpen && (
            <div className="absolute left-0 top-9 z-20 w-52 rounded-sm border border-border bg-card py-1 shadow-lg">
              {brands.map((b) => (
                <button
                  key={b.id}
                  onClick={() => { setBrandId(b.id); setBrandOpen(false); setConcepts(null); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-muted/40"
                >
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.colorPrimary ?? "#666" }} />
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* composer */}
        <div className={cn("rounded-[3px] border bg-card transition-colors", collab || line ? "border-grit-teal" : "border-border")}>
          {!collab ? (
            <>
              {proposal ? (
                <>
                  <p className="px-5 pt-4 text-[13px] text-dim line-through decoration-border">{line}</p>
                  <div className="mx-4 mt-2.5 rounded-sm border border-grit-teal bg-background/60 px-4 py-3">
                    <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-grit-teal">
                      Improved
                      <InfoDot text="One proposal per press. Your line stays yours until you choose Replace; Retry proposes again without touching it. Text only, free." />
                    </p>
                    <p className="text-[14.5px] leading-relaxed text-foreground">{proposal}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => { setLine(proposal); setProposal(null); }}
                        className="rounded-sm bg-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate"
                        data-testid="button-replace"
                      >
                        Replace mine
                      </button>
                      <button
                        onClick={() => { setProposal(null); void improve(); }}
                        className="rounded-sm border border-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate"
                        data-testid="button-retry"
                      >
                        Retry
                      </button>
                      <button
                        onClick={() => setProposal(null)}
                        className="px-1 font-mono text-[9px] uppercase tracking-[0.06em] text-dim hover:text-muted-foreground"
                      >
                        Keep mine
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={line}
                    onChange={(e) => { setLine(e.target.value); m.onLineChange(e.target.value, e.target.selectionStart); }}
                    onClick={(e) => m.onCaretMove(line, e.currentTarget.selectionStart)}
                    onBlur={m.onBlur}
                    onKeyDown={(e) => {
                      if (m.picker && m.matches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
                        e.preventDefault();
                        const pick = m.matches[m.highlight];
                        if (pick) chooseMention(pick);
                        return;
                      }
                      if (m.onKeyDown(e)) return;
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void start(); }
                    }}
                    placeholder="What are we making?"
                    rows={3}
                    aria-expanded={m.picker !== null}
                    aria-controls={m.picker ? "entrance-mention-picker" : undefined}
                    className="w-full resize-none bg-transparent px-5 pt-4 text-[17px] leading-relaxed text-foreground outline-none placeholder:text-dim"
                    data-testid="input-line"
                  />
                  <MentionPickerList m={m} pickerId="entrance-mention-picker" onChoose={chooseMention} />
                  <div className="px-5">
                    <MentionChips mentions={m.mentions} />
                  </div>
                </div>
              )}

              {/*
                The story choice and its shot list (step 4a, the mockup's
                screen 1). A shot is a MOMENT, not a framing — the spread
                already handles framings. Every edit here is free.
              */}
              {(suggested || shape === "sequence" || shots.length > 0) && (
                <div className="border-t border-border/60 px-3.5 py-2.5" data-testid="story-shape">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-dim">This post is</span>
                    {([
                      ["single", "One picture"],
                      ["sequence", "A sequence of shots"],
                    ] as Array<[PostShape, string]>).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => chooseShape(key)}
                        aria-pressed={shape === key}
                        className={cn(
                          "rounded-sm border px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.05em] hover-elevate",
                          shape === key
                            ? "border-grit-teal bg-grit-teal/15 text-cyber-teal"
                            : "border-border text-muted-foreground",
                        )}
                        data-testid={`button-shape-${key}`}
                      >
                        {label}
                      </button>
                    ))}
                    <div className="flex-1" />
                    {reading && <Loader2 size={9} className="animate-spin text-cyber-teal" />}
                    {suggested && !reading && (
                      <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
                        suggested {"·"} your line describes more than one moment
                      </span>
                    )}
                  </div>

                  {shape === "sequence" && (
                    <div className="mt-2 space-y-1.5">
                      <p className="font-mono text-[8px] uppercase tracking-[0.09em] text-victory-gold">
                        Shot list {"·"} derived, yours to edit
                      </p>
                      {shots.map((s) => (
                        <div
                          key={s.n}
                          draggable
                          onDragStart={() => setDragging(s.n)}
                          onDragEnd={() => setDragging(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.preventDefault(); dropShot(s.n); }}
                          className={cn(
                            "flex cursor-grab items-center gap-2 rounded-sm border bg-background/50 px-2 py-1.5 active:cursor-grabbing",
                            dragging === s.n ? "border-grit-teal opacity-50" : "border-border",
                          )}
                          data-testid={`row-shot-${s.n}`}
                        >
                          <span className="font-mono text-[8.5px] text-victory-gold" data-numeric>{s.n}</span>
                          <input
                            value={s.text}
                            onChange={(e) => editShot(s.n, e.target.value)}
                            placeholder="what happens at this moment"
                            aria-label={`Shot ${s.n}`}
                            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[11.5px] text-foreground outline-none placeholder:text-dim"
                          />
                          <span
                            className={cn(
                              "whitespace-nowrap rounded-sm border px-1 py-px font-mono text-[7.5px] uppercase tracking-[0.06em]",
                              s.provenance === "you" ? "border-border text-foreground" : "border-grit-teal/40 text-cyber-teal",
                            )}
                          >
                            {s.provenance === "you" ? "You" : "Inferred"}
                          </span>
                          <button
                            onClick={() => removeShot(s.n)}
                            aria-label={`Remove shot ${s.n}`}
                            className="font-mono text-[10px] text-dim hover:text-rebel-pink"
                          >
                            {"×"}
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={addShot}
                          disabled={shots.length >= MAX_SHOTS}
                          className="rounded-sm border border-border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
                          data-testid="button-add-shot"
                        >
                          + Add a shot
                        </button>
                        <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
                          {usableShots.length < 2
                            ? `two moments make a sequence · ${usableShots.length} so far`
                            : `${usableShots.length} moments · each generates and animates on its own`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-1.5 border-t border-border/60 px-3.5 py-2.5">
                <button
                  onClick={() => void improve()}
                  disabled={!line.trim() || improving}
                  className="flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-dim hover:text-cyber-teal disabled:opacity-40"
                  data-testid="button-improve"
                >
                  {improving ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Improve
                </button>
                <button
                  onClick={openCollab}
                  className="rounded-sm px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-dim hover:text-cyber-teal"
                  data-testid="button-collab"
                >
                  ◈ Let a director lead
                </button>
                <span className="ml-1 font-mono text-[9px] text-dim">@ attaches an asset</span>
                <div className="flex-1" />
                <button
                  onClick={() => void start()}
                  disabled={!startable || starting}
                  className="rounded-sm bg-primary px-3.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate disabled:opacity-40"
                  data-testid="button-start"
                >
                  {starting ? "Reading the brief…" : "Start →"}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* who leads */}
              <div className="relative mx-3.5 mt-3.5 flex items-center gap-2.5 rounded-sm border border-border bg-background/50 px-3 py-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-grit-teal font-mono text-[9px] text-cyber-teal">
                  {director.name.split(/[\s-]+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] text-foreground">{director.name} is leading</p>
                </div>
                <button
                  onClick={() => setSwapOpen((v) => !v)}
                  className="ml-auto font-mono text-[9px] uppercase tracking-[0.06em] text-dim hover:text-muted-foreground"
                  data-testid="button-swap-director"
                >
                  Swap ▾
                </button>
                {swapOpen && (
                  <div className="absolute right-0 top-11 z-20 w-56 rounded-sm border border-border bg-card py-1 shadow-lg">
                    {directors.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => { setDirector(d); setSwapOpen(false); }}
                        className={cn("block w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-muted/40", d.id === director.id ? "text-cyber-teal" : "text-foreground")}
                      >
                        {d.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* the thread */}
              <div className="mx-3.5 my-3 flex max-h-[380px] flex-col gap-2.5 overflow-y-auto">
                {thread.map((m, i) => (
                  <div key={i} className={cn("max-w-[86%]", m.role === "you" && "self-end")}>
                    <div
                      className={cn(
                        "rounded-sm px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                        m.role === "you"
                          ? "border border-grit-teal/40 bg-grit-teal/10 text-foreground"
                          : "border border-border border-l-2 border-l-grit-teal bg-background/60 text-foreground",
                      )}
                    >
                      {m.text}
                      {/* Chips are shortcuts on the director's message, never the
                          only answers: the input below always accepts anything. */}
                      {m.role === "director" && i === thread.length - 1 && (m.chips?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.chips!.map((c) => (
                            <button
                              key={c}
                              onClick={() => void send(c)}
                              className="rounded-sm border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-grit-teal hover:text-cyber-teal"
                            >
                              {c}
                            </button>
                          ))}
                        </div>
                      )}
                      {m.role === "director" && i === thread.length - 1 && m.assumption && (
                        <p className="mt-1.5 text-[10.5px] text-dim">Skip and they assume {m.assumption}</p>
                      )}
                    </div>
                  </div>
                ))}
                {talking && <Loader2 size={13} className="animate-spin text-dim" />}
                <div ref={threadEnd} />
              </div>

              {/* whose words are whose */}
              {(yours || framing) && (
                <div className="mx-3.5 mb-3 rounded-sm border border-dashed border-border px-3.5 py-2.5">
                  <p className="mb-1 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-grit-teal">
                    The brief so far
                    <InfoDot text="Yours in white, the director's framing in teal. Your words are never rewritten; Start hands both to stage 01 with the split intact." />
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    <span className="text-foreground">{yours}</span>
                    {framing && <span className="text-cyber-teal"> {framing}</span>}
                  </p>
                </div>
              )}

              <div className="mx-3.5 mb-3 flex items-center gap-2 rounded-sm border border-grit-teal bg-background px-3.5 py-1">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void send(draft); }}
                  placeholder={thread.length === 0 ? "Tell them the idea" : "Say anything"}
                  className="h-9 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-dim"
                  data-testid="input-collab"
                />
                <button
                  onClick={() => void send(draft)}
                  disabled={!draft.trim() || talking}
                  className="rounded-sm bg-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-primary-foreground disabled:opacity-40"
                >
                  Send
                </button>
              </div>

              <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5">
                <button
                  onClick={() => setCollab(false)}
                  className="rounded-sm px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-dim hover:text-muted-foreground"
                >
                  ← Back to the line
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => void start()}
                  disabled={!startable || starting}
                  className="rounded-sm bg-primary px-3.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate disabled:opacity-40"
                  data-testid="button-start-collab"
                >
                  {starting ? "Reading the brief…" : `Start with ${director.name.split(/[\s-]+/)[0]} →`}
                </button>
              </div>
            </>
          )}
        </div>

        {error && <p className="mt-2.5 text-[12px] text-rebel-pink">{error}</p>}

        {/* concepts */}
        <div className="mt-9">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
              Or pick a concept
              <InfoDot text="Three brand-aware starting points, freshly generated. Using one fills the composer; it is yours to edit before anything starts." />
            </span>
            <div className="flex-1" />
            <button
              onClick={() => brandId && void rollConcepts(brandId, true)}
              disabled={rolling}
              className="flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-dim hover:text-muted-foreground disabled:opacity-40"
              data-testid="button-reroll"
            >
              <RefreshCw size={9} className={cn(rolling && "animate-spin")} /> Re-roll
            </button>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {(concepts ?? Array.from({ length: 3 }, () => null)).map((c, i) =>
              c ? (
                <button
                  key={c.title}
                  onClick={() => { setLine(`${c.title} — ${c.angle}`); setProposal(null); textareaRef.current?.focus(); }}
                  className="group rounded-sm border border-border/60 bg-card p-3.5 text-left transition-colors hover:border-grit-teal"
                  data-testid={`concept-${i}`}
                >
                  <p className="text-[13.5px] font-semibold text-foreground">{c.title}</p>
                  <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-dim group-hover:line-clamp-none group-hover:text-muted-foreground">
                    {c.angle}
                  </p>
                  <span className="mt-2.5 inline-block rounded-sm border border-border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.07em] text-muted-foreground">
                    {INTENT_LABELS[c.intent] ?? c.intent}
                  </span>
                </button>
              ) : (
                <div key={i} className="h-28 animate-pulse rounded-sm border border-border/40 bg-card" />
              ),
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ rail */}
      <aside className="w-[252px] shrink-0 overflow-y-auto border-l border-border/60 bg-card px-3.5 py-5">
        <div className="mb-6">
          <p className="mb-2.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-dim">Continue</p>
          {recent.length === 0 && <p className="text-[12px] text-dim">Nothing yet.</p>}
          {recent.slice(0, 8).map((c) => (
            <button
              key={c.id}
              onClick={() => onOpen(c.id)}
              className="flex w-full items-center gap-2.5 rounded-sm border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-muted/30"
              data-testid={`recent-${c.id}`}
            >
              {c.previewImageUrl ? (
                <img src={c.previewImageUrl} alt="" className="h-8 w-8 shrink-0 rounded-sm border border-border object-cover" />
              ) : (
                <span className="h-8 w-8 shrink-0 rounded-sm border border-border bg-gradient-to-br from-muted/50 to-background" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-foreground">{c.name}</span>
                <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-dim">
                  {c.status}
                  {c.at ? ` ${"·"} ${new Date(c.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
        <SavedRunsPanel onOpenCreative={onOpen} />
      </aside>
    </div>
  );
}
