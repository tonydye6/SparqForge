import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch, cn } from "@/lib/utils";
import { InfoDot } from "./InfoDot";

/**
 * Stage 01 · Brief.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.11, §1.12, §1.17
 * and the Studio artifact, screens 07 and 08.
 *
 * The only stage that is AUTHORED rather than generated, which is why it has no
 * Explore spread. Four rules run it, and each one is a deliberate rejection of
 * how a form would behave:
 *
 *   1. ONE LINE IS ALWAYS ENOUGH. Nothing gates you. You type six words and
 *      proceed. The derivation below is advisory: it can be mid-flight, stale or
 *      failed and Save still works.
 *   2. YOUR LINE IS NEVER REWRITTEN. It sits verbatim at the top. Everything
 *      else is derived from it and labelled with who decided it.
 *   3. IT ASKS ONLY WHAT CHANGES THE OUTPUT, and every question shows the
 *      assumption it will make if ignored. So the questions are informative even
 *      when you skip them, which is the difference between an interview and a
 *      form.
 *   4. THE GAP IS VISIBLE. Six words in, N words out, because the place to show
 *      what the model actually hears is the place where the words get invented.
 *
 * Text is the closest thing in this product to something you could make by
 * hand, so per §1.12 direct typing is primary here and instruction is
 * secondary: the composer handles "shorter" and "less formal", this handles
 * knowing exactly what you want to say.
 *
 * The derived rows and the interview come from POST /api/brief-intake. Editing
 * any derived row flips its label to yours and that row is then sent as authored
 * rather than inferred, which is the entire point of showing provenance.
 */

interface BriefStageProps {
  creativeId: string;
  /** Needed for the brand-sourced rows. Null is handled, not assumed away. */
  brandId: string | null;
  stageId: string;
  locked: boolean;
  onSaved: () => void;
}

/** Who decided a line. Shown on every derived row, per §1.17. */
type Provenance = "you" | "inferred" | "brand";

const PROVENANCE_STYLES: Record<Provenance, { label: string; cls: string }> = {
  you: { label: "You", cls: "text-foreground border-border" },
  inferred: { label: "Inferred", cls: "text-cyber-teal border-grit-teal/40" },
  brand: { label: "Brand record", cls: "text-victory-gold border-victory-gold/40" },
};

interface DerivedRow {
  key: string;
  label: string;
  value: string;
  provenance: Provenance;
  note?: string;
}

/**
 * A question worth asking, with the assumption it falls back to.
 *
 * `assumption` is not optional. A question with no stated default is a gate,
 * and gates are what make people abandon a brief. The server drops any question
 * that arrives without one.
 */
interface OpenQuestion {
  id: string;
  question: string;
  options: string[];
  assumption: string;
}

interface IntakeResponse {
  intent: { id: string; label: string; confidence: number; reasoning: string | null } | null;
  derived: DerivedRow[];
  questions: OpenQuestion[];
  degraded: boolean;
  degradedReason?: string;
}

/**
 * An asset the user attached by typing `@` in their own sentence.
 *
 * The line is the artifact and this list is an index onto it: every keystroke
 * reconciles the two, so deleting the text deletes the attachment. A mention
 * that outlived its text would attach a picture to generation that the user
 * believes they removed, in a product whose whole argument is that you can see
 * what the model is using.
 */
interface Mention {
  assetId: string;
  name: string;
  role: "subject" | "style" | "object";
}

interface AssetOption {
  id: string;
  name: string;
  assetClass: string | null;
  compositingOnly: boolean | null;
  thumbnailUrl: string | null;
  fileUrl: string | null;
}

/** Mirrors roleForAssetClass on the server, so both ends agree what a pick is. */
function roleFor(assetClass: string | null, compositingOnly: boolean | null): Mention["role"] {
  if (compositingOnly || assetClass === "compositing") return "object";
  if (assetClass === "style_reference") return "style";
  if (assetClass === "subject_reference") return "subject";
  return "object";
}

const ROLE_LABEL: Record<Mention["role"], string> = {
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
function activeQuery(line: string, caret: number): { start: number; query: string } | null {
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

/** Below this there is not enough to infer anything worth showing. */
const MIN_WORDS_TO_DERIVE = 3;
/** Long enough that we are not billing a model call on every keystroke. */
const DEBOUNCE_MS = 800;

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function BriefStage({ creativeId, brandId, stageId, locked, onSaved }: BriefStageProps) {
  const [line, setLine] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [derived, setDerived] = useState<DerivedRow[]>([]);
  const [questions, setQuestions] = useState<OpenQuestion[]>([]);
  const [degraded, setDegraded] = useState<string | null>(null);
  // Kept so stage 03 can plan its axes without paying to infer the goal again.
  const [intentId, setIntentId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  /** The line the rows on screen were derived from, so we can say when they lag. */
  const [derivedFrom, setDerivedFrom] = useState("");

  const [editingKey, setEditingKey] = useState<string | null>(null);

  // ---- @ mentions -------------------------------------------------------
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [picker, setPicker] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // One in-flight derivation at a time. An abandoned request is cancelled rather
  // than left to land late and overwrite newer rows (and, on a metered model, to
  // be billed for an answer nobody will see).
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const derive = useCallback(
    async (text: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setThinking(true);
      try {
        const res = await apiFetch(`/api/brief-intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ briefText: text, ...(brandId ? { brandId } : {}) }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as IntakeResponse;
        if (controller.signal.aborted) return;
        setDerived(data.derived ?? []);
        setQuestions(data.questions ?? []);
        setIntentId(data.intent?.id ?? null);
        setDegraded(data.degraded ? (data.degradedReason ?? "Only the brand record is shown.") : null);
        setDerivedFrom(text);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        // Rule 1: a failed derivation is not allowed to become a blocked brief.
        setDegraded("The derivation could not be reached, so nothing below is filled in. Your line still saves.");
        setDerived([]);
        setQuestions([]);
        setDerivedFrom(text);
      } finally {
        if (!controller.signal.aborted) setThinking(false);
      }
    },
    [brandId],
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const text = line.trim();
    if (locked || wordCount(text) < MIN_WORDS_TO_DERIVE) {
      abortRef.current?.abort();
      setThinking(false);
      return;
    }
    timerRef.current = setTimeout(() => void derive(text), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [line, locked, derive]);

  // Cancel anything in flight when the stage unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  /*
   * Restore the saved brief when the stage is reopened.
   *
   * This was missing entirely: the textarea started empty every time, so
   * reopening stage 01 showed a blank box even though a brief was saved and
   * stage 03 was generating from it. That was survivable while the brief was
   * only prose, because the DB still had it. It stops being survivable with `@`
   * mentions, since a user who reopens, retypes and saves would silently drop
   * attachments they can no longer see. The spine's whole promise is that you
   * can click back into a stage and find what it decided.
   *
   * Runs once per stage. A failure leaves the form empty rather than blocking,
   * which is the same call the derivation path makes.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/creatives/${creativeId}/stages`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const brief = (body?.stages ?? []).find(
          (st: { id: string; stageKind: string }) => st.stageKind === "brief",
        );
        if (!brief) return;
        const takes = body?.takes?.[brief.id] ?? [];
        const current = takes.find(
          (t: { slotKey: string; isCurrent: boolean }) => t.slotKey === "brief" && t.isCurrent,
        );
        const payload = current?.payload;
        if (!payload || typeof payload !== "object" || cancelled) return;

        if (typeof payload.line === "string" && payload.line.trim()) {
          setLine(payload.line);
          // Marked as already-derived-from, so restoring a brief does not
          // immediately accuse its own rows of being out of date.
          setDerivedFrom(payload.line.trim());
        }
        if (typeof payload.intentId === "string") setIntentId(payload.intentId);
        if (Array.isArray(payload.derived)) setDerived(payload.derived as DerivedRow[]);
        if (Array.isArray(payload.mentions)) {
          setMentions(
            (payload.mentions as Mention[]).filter(
              (mn) => mn && typeof mn.assetId === "string" && typeof mn.name === "string",
            ),
          );
        }
        if (Array.isArray(payload.answers)) {
          const restored: Record<string, string> = {};
          for (const a of payload.answers as Array<{ id?: unknown; answer?: unknown }>) {
            if (typeof a?.id === "string" && typeof a?.answer === "string") restored[a.id] = a.answer;
          }
          setAnswers(restored);
        }
        setSaved(true);
      } catch {
        // Leave the form empty rather than blocking on a read.
      }
    })();
    return () => { cancelled = true; };
  }, [creativeId, stageId]);

  /** Editing a row makes it yours. That is the whole contract of the badge. */
  function editRow(key: string, value: string) {
    setDerived((rows) =>
      rows.map((r) =>
        r.key === key ? { ...r, value, provenance: "you", note: undefined } : r,
      ),
    );
    setSaved(false);
  }

  const yourWords = wordCount(line);
  // The gap the user is entitled to see: their words versus everything the
  // model will actually receive. Counted off what is really on screen, so it
  // cannot drift from the panel above it.
  const derivedWords = derived.reduce((n, d) => n + wordCount(d.value), 0);
  const answerWords = Object.values(answers).reduce((n, a) => n + wordCount(a), 0);
  const totalWords = yourWords + derivedWords + answerWords;

  const stale = derivedFrom !== "" && derivedFrom !== line.trim();

  /*
   * The brand's assets, loaded once when the picker is first needed.
   *
   * Scoped to the brand in the QUERY, not filtered afterwards, which is the same
   * containment rule generation uses: another brand's character cannot be
   * attached to this post by accident.
   */
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
    const pool = q
      ? assets.filter((a) => a.name.toLowerCase().includes(q))
      : assets;
    return pool.slice(0, 8);
  }, [picker, assets]);

  /**
   * Reconcile on every change: a mention whose text is gone is gone.
   * Mirrors reconcileMentions on the server.
   */
  function updateLine(next: string, caret: number) {
    setLine(next);
    setSaved(false);
    setMentions((prev) => {
      const seen = new Set<string>();
      return prev.filter((mn) => {
        if (seen.has(mn.assetId)) return false;
        if (!next.includes(`@${mn.name}`)) return false;
        seen.add(mn.assetId);
        return true;
      });
    });
    const q = activeQuery(next, caret);
    setPicker(q);
    setHighlight(0);
  }

  function choose(asset: AssetOption) {
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : line.length;
    const active = picker ?? activeQuery(line, caret);
    if (!active) return;
    const token = `@${asset.name} `;
    const next = line.slice(0, active.start) + token + line.slice(caret);
    const nextCaret = active.start + token.length;
    setLine(next);
    setSaved(false);
    setMentions((prev) =>
      prev.some((mn) => mn.assetId === asset.id)
        ? prev
        : [...prev, { assetId: asset.id, name: asset.name, role: roleFor(asset.assetClass, asset.compositingOnly) }],
    );
    setPicker(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function save() {
    if (!line.trim() || locked) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/takes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotKey: "brief",
          // Typed by hand, so the engine auto-locks this stage and no upstream
          // re-run can overwrite the words someone chose.
          origin: "user_typed",
          // Everything on screen, and nothing that is not. The rows carry their
          // provenance so a downstream stage can tell an authored constraint
          // from an inferred one instead of flattening both into prose.
          payload: {
            line: line.trim(),
            /*
             * The explicit ids behind the `@` tokens in the line above.
             * Stage 03 consumes these as attachments, which outrank the
             * Creative Director's own selection: the director can choose a
             * subject well but cannot know which character a name refers to
             * when no asset carries that name.
             */
            mentions,
            // Recorded, not re-derived. Stage 03 plans its axes off the goal, and
            // paying a second inference for a value we already have would also
            // risk the two stages disagreeing about what this post is for.
            intentId,
            derived: derived.map((d) => ({
              key: d.key,
              label: d.label,
              value: d.value,
              provenance: d.provenance,
            })),
            answers: questions
              .filter((q) => answers[q.id])
              .map((q) => ({ id: q.id, question: q.question, answer: answers[q.id] })),
          },
          // The brief consumes nothing. Recording that truthfully is what makes
          // it unstaleable, which is the whole copy-led mechanism.
          consumedFrom: [],
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      {/* Your words, verbatim and never rewritten. */}
      <div className="rounded-sm border border-l-2 border-border/60 border-l-grit-teal bg-card px-3.5 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-grit-teal">What you typed</p>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={line}
            onChange={(e) => updateLine(e.target.value, e.target.selectionStart)}
            onClick={(e) => setPicker(activeQuery(line, e.currentTarget.selectionStart))}
            onBlur={() => {
              // Delayed so a click on a picker row lands before the list unmounts.
              window.setTimeout(() => setPicker(null), 120);
            }}
            onKeyDown={(e) => {
              if (!picker || matches.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => (h + 1) % matches.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => (h - 1 + matches.length) % matches.length);
              } else if (e.key === "Enter" || e.key === "Tab") {
                // Only while the picker is open, so Enter still writes a newline
                // in ordinary typing.
                e.preventDefault();
                const pick = matches[highlight];
                if (pick) choose(pick);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setPicker(null);
              }
            }}
            disabled={locked}
            rows={2}
            placeholder="new map release for Crown U"
            aria-label="Your brief, in one line. Type @ to attach an asset."
            aria-expanded={picker !== null}
            aria-controls={picker ? "brief-mention-picker" : undefined}
            className="mt-1.5 w-full resize-none border-0 bg-transparent p-0 text-[17px] leading-snug text-foreground outline-none placeholder:text-dim disabled:opacity-70"
          />

          {picker && !locked && (
            <div
              id="brief-mention-picker"
              role="listbox"
              className="absolute left-0 top-full z-20 mt-1 w-full max-w-md overflow-hidden rounded-sm border border-border bg-raised shadow-lg"
            >
              {matches.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-dim">
                  {assets.length === 0
                    ? "Loading this brand's assets..."
                    : `Nothing in this brand's library matches "${picker.query}".`}
                </p>
              ) : (
                matches.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(a)}
                    className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${
                      i === highlight ? "bg-grit-teal/15" : ""
                    }`}
                  >
                    {a.thumbnailUrl || a.fileUrl ? (
                      <img
                        src={a.thumbnailUrl || a.fileUrl || ""}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <span className="h-8 w-8 shrink-0 rounded-sm border border-border" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{a.name}</span>
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.09em] text-dim">
                      {ROLE_LABEL[roleFor(a.assetClass, a.compositingOnly)]}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/*
          What is attached, stated rather than implied. The picker is transient;
          this is the standing record, and it is the §1.17 disclosure for the one
          decision the user makes by hand at this stage.
        */}
        {mentions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mentions.map((mn) => (
              <span
                key={mn.assetId}
                className="inline-flex items-center gap-1.5 rounded-sm border border-grit-teal/40 px-1.5 py-0.5 text-[10.5px] text-foreground"
              >
                <span className="truncate max-w-[220px]">{mn.name}</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-grit-teal">
                  {ROLE_LABEL[mn.role]}
                </span>
              </span>
            ))}
          </div>
        )}
        <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-dim">
          {yourWords > 0 ? (
            <>
              <span data-numeric className="font-mono">{yourWords}</span> {yourWords === 1 ? "word" : "words"} \u00b7 never rewritten
            </>
          ) : (
            <>One line is enough {"\u00b7"} @ attaches an asset</>
          )}
          <InfoDot text="Your line is the only part that is yours by default, and no model ever rewrites it. Type @ to attach a character or logo from this brand's library. Everything derived below is labelled with who decided it." />
        </p>
      </div>

      {degraded && (
        <p className="rounded-sm border border-victory-gold/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-victory-gold">
          {degraded}
        </p>
      )}

      {(derived.length > 0 || thinking) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-sm border border-border/60 bg-card p-3.5">
            <p className="mb-2 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.11em] text-dim">
              What I derived from that
              {thinking && <span className="text-cyber-teal">reading</span>}
              {!thinking && stale && <span className="text-victory-gold">from your previous line</span>}
            </p>

            {derived.length === 0 && thinking && (
              <p className="py-1.5 text-[11.5px] text-dim">Working out what this implies.</p>
            )}

            {derived.map((d) => (
              <div
                key={d.key}
                className="grid grid-cols-[70px_1fr] gap-2 border-b border-border/40 py-1.5 last:border-b-0"
              >
                <span className="pt-0.5 font-mono text-[8.5px] uppercase tracking-[0.09em] text-dim">
                  {d.label}
                </span>
                <span className="text-[11.5px] leading-snug text-foreground">
                  {editingKey === d.key ? (
                    <input
                      autoFocus
                      value={d.value}
                      onChange={(e) => editRow(d.key, e.target.value)}
                      onBlur={() => setEditingKey(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") setEditingKey(null);
                      }}
                      aria-label={`${d.label}, editable`}
                      className="w-full rounded-sm border border-grit-teal bg-raised px-1 py-0.5 text-[11.5px] text-foreground outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => !locked && setEditingKey(d.key)}
                      disabled={locked}
                      className="text-left hover:text-cyber-teal disabled:hover:text-foreground"
                      title={locked ? undefined : "Edit this line"}
                    >
                      {d.value}
                    </button>
                  )}
                  <span
                    className={cn(
                      "ml-1.5 whitespace-nowrap rounded-sm border px-1 py-px font-mono text-[7.5px] uppercase tracking-[0.06em]",
                      PROVENANCE_STYLES[d.provenance].cls,
                    )}
                  >
                    {PROVENANCE_STYLES[d.provenance].label}
                  </span>
                  {d.note && (
                    <span className="ml-1.5 font-mono text-[7.5px] uppercase tracking-[0.06em] text-dim">
                      {d.note}
                    </span>
                  )}
                </span>
              </div>
            ))}

            {derived.length > 0 && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
                Every line is editable and any edit flips its label to yours. Nothing is sent that is not here.
              </p>
            )}
          </div>

          <div className="rounded-sm border border-border/60 bg-card p-3.5">
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.11em] text-dim">
              What I actually need from you · {questions.length}
            </p>

            {questions.length === 0 && !thinking && (
              <p className="text-[11.5px] leading-relaxed text-dim">
                Nothing. Your line already says enough to start, so there is no question worth spending your
                attention on.
              </p>
            )}

            {questions.map((q) => (
              <div key={q.id} className="mb-2 rounded-sm border border-border bg-raised px-2.5 py-2 last:mb-0">
                <p className="text-[12px] leading-snug text-foreground">{q.question}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() =>
                        setAnswers((a) => {
                          // Tapping the chosen option again clears it, so an
                          // accidental answer can go back to the assumption.
                          const next = { ...a };
                          if (next[q.id] === opt) delete next[q.id];
                          else next[q.id] = opt;
                          return next;
                        })
                      }
                      aria-pressed={answers[q.id] === opt}
                      className={cn(
                        "rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.05em] hover-elevate",
                        answers[q.id] === opt
                          ? "border-grit-teal bg-grit-teal/15 text-cyber-teal"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-dim">
                  {answers[q.id] ? (
                    <>
                      You chose <span className="text-muted-foreground">{answers[q.id]}</span>. Tap it again to go
                      back to the assumption.
                    </>
                  ) : (
                    <>
                      Skip and I assume <span className="text-muted-foreground">{q.assumption}</span>.
                    </>
                  )}
                </p>
              </div>
            ))}

            {questions.length > 0 && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
                Only questions that change the output get asked, and each shows the assumption it will make if you
                ignore it. This is an interview, not a form.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border/60 bg-card px-3.5 py-2.5">
        {yourWords > 0 && (
          <p className="text-[11.5px] text-muted-foreground">
            You wrote <span className="font-medium text-foreground" data-numeric>{yourWords}</span>{" "}
            {yourWords === 1 ? "word" : "words"}. The brief reaching the model is{" "}
            <span className="font-medium text-foreground" data-numeric>{totalWords}</span>.
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {saved && (
            <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-cyber-teal">
              Saved · stage locked
            </span>
          )}
          <button
            onClick={() => void save()}
            disabled={!line.trim() || saving || locked}
            className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate disabled:opacity-40"
          >
            {locked ? "Locked" : saving ? "Saving" : "Save the brief"}
          </button>
        </div>
      </div>

      {locked && (
        <p className="flex items-center gap-1.5 text-[11px] text-dim">
          Locked · your words cannot be overwritten
          <InfoDot text="A hand-typed brief locks itself, which is what stops an upstream re-run from rewriting your words. Unlock it above if you want it to rejoin the generated flow." />
        </p>
      )}
    </div>
  );
}
