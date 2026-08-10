import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { useCanWrite } from "@/hooks/useAuth";
import { InfoDot } from "./InfoDot";
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

  const rollConcepts = useCallback(async (forBrand: string) => {
    setRolling(true);
    try {
      const res = await apiFetch("/api/concept-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: forBrand, count: 3 }),
      });
      if (!res.ok) return;
      const body = await res.json();
      setConcepts(body.concepts ?? body.data ?? []);
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

      if (briefStage) {
        await apiFetch(`/api/creatives/${creative.id}/stages/${briefStage.id}/takes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slotKey: "brief",
            origin: "user_typed",
            payload: {
              line: yours.trim(),
              intentId,
              derived,
              answers: [],
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
                <textarea
                  ref={textareaRef}
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void start(); }
                  }}
                  placeholder="What are we making?"
                  rows={3}
                  className="w-full resize-none bg-transparent px-5 pt-4 text-[17px] leading-relaxed text-foreground outline-none placeholder:text-dim"
                  data-testid="input-line"
                />
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
              onClick={() => brandId && void rollConcepts(brandId)}
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
              <span className="h-8 w-8 shrink-0 rounded-sm border border-border bg-gradient-to-br from-muted/50 to-background" />
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-foreground">{c.name}</span>
                <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-dim">{c.status}</span>
              </span>
            </button>
          ))}
        </div>
        <SavedRunsPanel onOpenCreative={onOpen} />
      </aside>
    </div>
  );
}
