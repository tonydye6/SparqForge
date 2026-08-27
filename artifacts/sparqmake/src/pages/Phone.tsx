import { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { ChevronLeft, Loader2 } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";

/**
 * Phase 10 item 5 · the phone.
 *
 * Principle 1.15, quoted in full because it is the whole specification:
 *
 *   "Mobile is a deliberate refusal. The phone gets three capabilities: see the
 *   artifact per channel, approve or send back with a reason, comment anchored
 *   to a stage. Generating on a phone is not built."
 *
 * So this is a SEPARATE SURFACE at its own route, not the Studio reflowed. That
 * is the honest reading of "nothing else responsive": making the Studio squeeze
 * onto a phone would be claiming a capability that is not there, and doc 24 §4
 * is clear that a thing half-built and pretending to work is worse than one
 * that is honestly absent. The screen says out loud what it does not do.
 *
 * Everything it needs already exists: `/creatives/:id/variants` for the
 * artifact per channel, and the Phase 6 team endpoints for the decision, the
 * seven categories, and stage-anchored notes. Nothing new was added on the
 * server for this.
 *
 * It lives outside AppLayout on purpose. AppLayout is the desktop sidebar, and
 * a 240px rail on a 390px screen is most of the screen.
 */

interface Variant {
  id: string;
  platform: string;
  compositedImageUrl: string | null;
  videoUrl: string | null;
  caption: string;
  headlineText: string | null;
}

interface Category {
  slug: string;
  label: string;
  description: string;
  suggests: string | null;
}

interface StageOption {
  id: string;
  stageNumber: number;
  stageKind: string;
  label: string;
}

interface Note {
  id: string;
  stageStateId: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface TeamState {
  creativeStatus: string;
  approval: {
    state: "none" | "awaiting" | "approved" | "needs_work";
    needsYou: boolean;
    summary: string;
    latest: { id: string; rejectStageStateId: string | null } | null;
  };
  comments: Note[];
  stages: StageOption[];
  taxonomy: Category[];
  you: { id: string; role: string; canDecide: boolean; canComment: boolean; explanation: string };
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  instagram_feed: "Instagram",
  instagram_story: "IG Story",
  twitter: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
};

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] ?? p;
}

// ── the queue ────────────────────────────────────────────────────────────────

interface Awaiting {
  creativeId: string;
  requestedByName: string | null;
  requestedAt: string;
  needsYou: boolean;
}

export function PhoneQueue() {
  const [rows, setRows] = useState<Awaiting[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    void apiFetch("/api/approvals/awaiting")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then(async (d) => {
        const list: Awaiting[] = d.data ?? [];
        setRows(list);
        // One request per row is acceptable here and nowhere else: the queue is
        // what somebody has actually been asked to decide, so it is small by
        // construction, and a list of ids would be useless on a phone.
        const entries = await Promise.all(
          list.map(async (r) => {
            const res = await apiFetch(`/api/creatives/${r.creativeId}`);
            if (!res.ok) return [r.creativeId, "Untitled"] as const;
            const c = await res.json();
            return [r.creativeId, c.name ?? "Untitled"] as const;
          }),
        );
        setNames(Object.fromEntries(entries));
      })
      .catch(() => setRows([]));
  }, []);

  return (
    <div className="min-h-screen bg-background px-4 py-5">
      <p className="ui-label text-grit-teal">SparqMake</p>
      <h1 className="mt-1 font-display text-xl tracking-wide text-foreground">Waiting on a decision</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
        The phone does three things: look at a post channel by channel, approve it or send it back with
        a reason, and leave a note on the stage that caused it. Making the work happens at a desk.
      </p>

      <div className="mt-4 space-y-2">
        {rows === null && <p className="text-[13px] text-dim">Reading the queue...</p>}
        {rows?.length === 0 && (
          <p className="text-[13px] text-dim">Nothing is waiting on a decision.</p>
        )}
        {rows?.map((r) => (
          <Link key={r.creativeId} href={`/m/${r.creativeId}`}>
            <a
              className="block rounded-sm border border-border/60 bg-card px-3 py-3 active:border-grit-teal"
              data-testid={`link-phone-creative-${r.creativeId}`}
            >
              <p className="truncate text-[15px] text-foreground">{names[r.creativeId] ?? "Loading..."}</p>
              <p className="mt-0.5 ui-label text-dim">
                {r.needsYou ? "needs you" : "asked for"} ·{" "}
                {r.requestedByName ?? "someone"} · {new Date(r.requestedAt).toLocaleDateString()}
              </p>
            </a>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── one post ─────────────────────────────────────────────────────────────────

export function PhoneCreative() {
  const [, params] = useRoute("/m/:creativeId");
  const creativeId = params?.creativeId ?? "";

  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [team, setTeam] = useState<TeamState | null>(null);
  const [name, setName] = useState<string>("");
  const [channel, setChannel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sending back
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [reasonStage, setReasonStage] = useState<string | null>(null);
  /**
   * The server's own sentence about the suggestion, rendered verbatim.
   *
   * WHY VERBATIM. A null stage has four different causes: the category
   * genuinely spans stages, the creative has no such stage, that stage has not
   * run, or the reason was not recognised. The first version of this screen
   * printed one sentence for all four and so told a post with no spine at all
   * that its reason "can come from more than one stage", which was simply not
   * what had happened. The endpoint already distinguishes them.
   */
  const [reasonWhy, setReasonWhy] = useState<string | null>(null);
  const [reasonNote, setReasonNote] = useState("");

  // A note on a stage
  const [noteStage, setNoteStage] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");

  const load = useCallback(async () => {
    if (!creativeId) return;
    setError(null);
    try {
      const [v, t, c] = await Promise.all([
        apiFetch(`/api/creatives/${creativeId}/variants`).then((r) => (r.ok ? r.json() : [])),
        apiFetch(`/api/creatives/${creativeId}/team`).then((r) => (r.ok ? r.json() : null)),
        apiFetch(`/api/creatives/${creativeId}`).then((r) => (r.ok ? r.json() : null)),
      ]);
      setVariants(Array.isArray(v) ? v : []);
      setTeam(t);
      setName(c?.name ?? "");
      setChannel((prev) => prev ?? (Array.isArray(v) && v[0] ? v[0].platform : null));
    } catch {
      setError("This post could not be loaded.");
    }
  }, [creativeId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * The stage a reason points at, suggested by the server.
   *
   * Fetched rather than guessed so the phone and the desk agree about which
   * stage caused what. It is always changeable, and two categories deliberately
   * suggest nothing because they genuinely come from more than one place.
   */
  useEffect(() => {
    if (!reason || !creativeId) return;
    void apiFetch(`/api/creatives/${creativeId}/team/suggest?reason=${encodeURIComponent(reason)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setReasonStage(d?.stageStateId ?? null); setReasonWhy(d?.why ?? null); })
      .catch(() => { setReasonStage(null); setReasonWhy(null); });
  }, [reason, creativeId]);

  async function decide(decision: "approved" | "needs_work") {
    if (!team?.approval.latest?.id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/creatives/${creativeId}/approvals/${team.approval.latest.id}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            decision === "approved"
              ? { decision }
              : { decision, reason, stageStateId: reasonStage, note: reasonNote.trim() || null },
          ),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The decision could not be recorded.");
        return;
      }
      setSendingBack(false);
      setReason(null);
      setReasonWhy(null);
      setReasonNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!noteBody.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteBody.trim(), stageStateId: noteStage }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The note could not be saved.");
        return;
      }
      setNoteBody("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const current = variants?.find((v) => v.platform === channel) ?? variants?.[0] ?? null;
  const openNotes = (team?.comments ?? []).filter((c) => !c.resolvedAt);

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/60 bg-background px-3 py-2.5">
        <Link href="/m">
          <a className="text-muted-foreground" aria-label="Back to the queue">
            <ChevronLeft size={18} />
          </a>
        </Link>
        <p className="min-w-0 flex-1 truncate text-[15px] text-foreground">{name || "Post"}</p>
      </div>

      {error && <p className="px-4 pt-3 text-[13px] text-rebel-pink">{error}</p>}

      {/* 1 · the artifact, per channel */}
      <div className="px-3 pt-3">
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {(variants ?? []).map((v) => (
            <button
              key={v.id}
              onClick={() => setChannel(v.platform)}
              className={cn(
                "shrink-0 rounded-sm border px-2.5 py-1.5 ui-label",
                v.platform === current?.platform
                  ? "border-grit-teal text-cyber-teal"
                  : "border-border text-muted-foreground",
              )}
              data-testid={`tab-channel-${v.platform}`}
            >
              {platformLabel(v.platform)}
            </button>
          ))}
        </div>

        {variants === null && <p className="text-[13px] text-dim">Loading the post...</p>}
        {variants?.length === 0 && (
          <p className="text-[13px] text-dim">This post has nothing to look at yet.</p>
        )}

        {current && (
          <div className="space-y-2" data-testid="panel-artifact">
            {current.videoUrl ? (
              <video src={current.videoUrl} controls playsInline className="w-full rounded-sm border border-border/60" />
            ) : current.compositedImageUrl ? (
              <img
                src={current.compositedImageUrl}
                alt={current.headlineText ?? "The post"}
                className="w-full rounded-sm border border-border/60"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-sm border border-dashed border-border/60">
                <p className="text-[13px] text-dim">No picture on this channel yet</p>
              </div>
            )}
            {current.headlineText && (
              <p className="text-[15px] leading-snug text-foreground">{current.headlineText}</p>
            )}
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted-foreground">
              {current.caption || "No caption on this channel yet"}
            </p>
          </div>
        )}
      </div>

      {/* 3 · notes, anchored to a stage */}
      <div className="mt-5 space-y-2 border-t border-border/60 px-3 pt-4">
        <p className="ui-label text-grit-teal">Notes</p>
        {openNotes.length === 0 && <p className="text-[13px] text-dim">No open notes.</p>}
        {openNotes.map((n) => (
          <div key={n.id} className="rounded-sm border border-border/60 bg-card px-3 py-2">
            <p className="text-[13.5px] leading-relaxed text-foreground">{n.body}</p>
            <p className="mt-1 ui-label text-dim">
              {n.authorName ?? "someone"}
              {n.stageStateId && (
                <> · on {team?.stages.find((s) => s.id === n.stageStateId)?.label ?? "a stage"}</>
              )}
            </p>
          </div>
        ))}

        {team?.you.canComment && (
          <div className="space-y-1.5 pt-1">
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setNoteStage(null)}
                className={cn(
                  "shrink-0 rounded-sm border px-2 py-1 ui-label",
                  noteStage === null ? "border-grit-teal text-cyber-teal" : "border-border text-muted-foreground",
                )}
              >
                Whole post
              </button>
              {(team?.stages ?? []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setNoteStage(s.id)}
                  className={cn(
                    "shrink-0 rounded-sm border px-2 py-1 ui-label",
                    noteStage === s.id ? "border-grit-teal text-cyber-teal" : "border-border text-muted-foreground",
                  )}
                  data-testid={`chip-note-stage-${s.stageKind}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              rows={2}
              placeholder="Leave a note"
              className="w-full rounded-sm border border-border bg-card px-2.5 py-2 text-[14px] text-foreground outline-none focus:border-grit-teal"
              data-testid="input-phone-note"
            />
            <button
              onClick={() => void addNote()}
              disabled={busy || !noteBody.trim()}
              className="rounded-sm border border-border px-3 py-1.5 ui-label text-muted-foreground disabled:opacity-40"
              data-testid="button-phone-add-note"
            >
              {noteStage
                ? `Leave it on ${team?.stages.find((s) => s.id === noteStage)?.label ?? "the stage"}`
                : "Leave it on the post"}
            </button>
          </div>
        )}
      </div>

      {/* What the phone does not do. Said plainly rather than discovered. */}
      <p className="px-3 pt-5 text-[12px] leading-relaxed text-dim">
        Making and changing the work is not built for the phone. Open this post at a desk to change the
        picture or the words.
      </p>

      {/* 2 · the decision, pinned where a thumb reaches */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border/60 bg-background px-3 py-2.5">
        {!team ? null : !team.you.canDecide ? (
          <p className="text-[12.5px] text-muted-foreground">{team.you.explanation}</p>
        ) : team.approval.state !== "awaiting" ? (
          <p className="text-[12.5px] text-muted-foreground">{team.approval.summary}</p>
        ) : sendingBack ? (
          <div className="space-y-2">
            <p className="ui-label text-dim">Why is it going back</p>
            <div className="flex flex-wrap gap-1.5">
              {team.taxonomy.map((c) => (
                <button
                  key={c.slug}
                  onClick={() => setReason(c.slug)}
                  className={cn(
                    "rounded-sm border px-2 py-1 text-[12px]",
                    reason === c.slug ? "border-grit-teal text-cyber-teal" : "border-border text-muted-foreground",
                  )}
                  data-testid={`chip-reason-${c.slug}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {reason && reasonWhy && (
              <p className="text-[11.5px] leading-relaxed text-dim">
                {reasonWhy}
                {reasonStage && " It will be waiting there when that stage is reopened."}
              </p>
            )}
            <textarea
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              rows={2}
              placeholder="Say what to change"
              className="w-full rounded-sm border border-border bg-card px-2.5 py-2 text-[14px] text-foreground outline-none focus:border-grit-teal"
              data-testid="input-send-back-note"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void decide("needs_work")}
                disabled={busy || !reason}
                className="flex-1 rounded-sm border border-rebel-pink px-3 py-2.5 ui-label text-rebel-pink disabled:opacity-40"
                data-testid="button-confirm-send-back"
              >
                {busy ? <Loader2 size={12} className="mx-auto animate-spin" /> : "Send it back"}
              </button>
              <button
                onClick={() => { setSendingBack(false); setReason(null); setReasonWhy(null); }}
                className="rounded-sm border border-border px-3 py-2.5 ui-label text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => void decide("approved")}
              disabled={busy}
              className="flex-1 rounded-sm border border-grit-teal px-3 py-3 ui-label text-cyber-teal disabled:opacity-40"
              data-testid="button-phone-approve"
            >
              {busy ? <Loader2 size={12} className="mx-auto animate-spin" /> : "Approve"}
            </button>
            <button
              onClick={() => setSendingBack(true)}
              className="flex-1 rounded-sm border border-border px-3 py-3 ui-label text-muted-foreground"
              data-testid="button-phone-send-back"
            >
              Send it back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
