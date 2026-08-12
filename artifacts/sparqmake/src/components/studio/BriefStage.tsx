import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, cn } from "@/lib/utils";
import { InfoDot } from "./InfoDot";
import { MentionChips, MentionPickerList, useMentions, type AssetOption, type Mention } from "./mentions";

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

/**
 * One MOMENT of the post, not one framing of it (the story path, step 4a).
 *
 * Tony's race example is the distinction: a spread is variations of one moment,
 * a story is different moments. The rows are derived and then yours — editing
 * one flips its label exactly as it does for every other derived row.
 */
interface Shot {
  n: number;
  text: string;
  provenance: Provenance;
}

/** One picture, or several. The brief suggests; the person decides. */
type PostShape = "single" | "sequence";

interface IntakeResponse {
  intent: { id: string; label: string; confidence: number; reasoning: string | null } | null;
  derived: DerivedRow[];
  questions: OpenQuestion[];
  shots?: Shot[];
  readsAsStory?: boolean;
  degraded: boolean;
  degradedReason?: string;
}

/*
 * The `@` mention machinery lives in ./mentions now, shared with the entrance
 * — which is also stage 01, and which shipped a hint promising `@` while this
 * file kept the only working copy.
 */

/** Below this there is not enough to infer anything worth showing. */
const MIN_WORDS_TO_DERIVE = 3;
/** Long enough that we are not billing a model call on every keystroke. */
const DEBOUNCE_MS = 800;

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Mirrors the server's cap. Past this it is a film, not a post. */
const MAX_SHOTS = 6;

/** Contiguous from 1, always — the storyboard's slot families are named off these. */
const renumber = (shots: Shot[]): Shot[] =>
  shots.filter((s) => s.text.trim() || s.provenance === "you").slice(0, MAX_SHOTS).map((s, i) => ({ ...s, n: i + 1 }));

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

  /*
   * The story path (step 4a). `shape` is the DECISION and `suggested` is only
   * what the brief was read as — kept apart so a re-derivation can update the
   * suggestion without ever overriding a choice somebody made.
   */
  const [shape, setShape] = useState<PostShape>("single");
  const [shots, setShots] = useState<Shot[]>([]);
  const [suggested, setSuggested] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  /*
   * A REF, not state, and the reason is money: `derive` closes over this, so as
   * state it would land in the callback's deps, rebuild the callback, re-run the
   * debounce effect and fire a fresh billed Sonnet call every time somebody
   * pressed the toggle. Nothing about choosing a shape should cost anything.
   */
  const shapeChosenRef = useRef(false);

  // ---- @ mentions (shared machinery; see ./mentions) ---------------------
  const m = useMentions(brandId);
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
        /*
         * A derived shot list never overwrites shots somebody has edited, and
         * the suggestion never overrides a chosen shape. Re-deriving after a
         * typo must not silently rewrite the story a person just authored.
         */
        const derivedShots = data.shots ?? [];
        setSuggested(Boolean(data.readsAsStory));
        setShots((current) => (current.some((s) => s.provenance === "you") ? current : derivedShots));
        if (!shapeChosenRef.current) setShape(data.readsAsStory ? "sequence" : "single");
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
        /*
         * A saved shape is a decision, so restoring it marks the choice as made
         * — otherwise the next derivation would quietly move a post somebody
         * had already decided was one picture.
         */
        if (payload.shape === "sequence" || payload.shape === "single") {
          setShape(payload.shape);
          shapeChosenRef.current = true;
        }
        if (Array.isArray(payload.shots)) setShots(renumber(payload.shots as Shot[]));
        if (Array.isArray(payload.mentions)) {
          m.setMentions(
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

  /* ---- the shot list's edits. Every one of them is free. ---- */

  function chooseShape(next: PostShape) {
    if (locked) return;
    shapeChosenRef.current = true;
    setShape(next);
    setSaved(false);
  }

  function editShot(n: number, text: string) {
    setShots((rows) => rows.map((s) => (s.n === n ? { ...s, text, provenance: "you" } : s)));
    setSaved(false);
  }

  function addShot() {
    setShots((rows) => (rows.length >= MAX_SHOTS ? rows : renumber([...rows, { n: rows.length + 1, text: "", provenance: "you" }])));
    setSaved(false);
  }

  function removeShot(n: number) {
    setShots((rows) => renumber(rows.filter((s) => s.n !== n)));
    setSaved(false);
  }

  /** Drop `dragging` in front of `targetN`. The whole order is rewritten. */
  function dropShot(targetN: number) {
    if (dragging === null || dragging === targetN) return;
    setShots((rows) => {
      const moved = rows.find((s) => s.n === dragging);
      if (!moved) return rows;
      const rest = rows.filter((s) => s.n !== dragging);
      const at = rest.findIndex((s) => s.n === targetN);
      rest.splice(at < 0 ? rest.length : at, 0, moved);
      return renumber(rest);
    });
    setDragging(null);
    setSaved(false);
  }

  const usableShots = shots.filter((s) => s.text.trim().length > 0);

  const yourWords = wordCount(line);
  // The gap the user is entitled to see: their words versus everything the
  // model will actually receive. Counted off what is really on screen, so it
  // cannot drift from the panel above it.
  const derivedWords = derived.reduce((n, d) => n + wordCount(d.value), 0);
  const answerWords = Object.values(answers).reduce((n, a) => n + wordCount(a), 0);
  const totalWords = yourWords + derivedWords + answerWords;

  const stale = derivedFrom !== "" && derivedFrom !== line.trim();

  function updateLine(next: string, caret: number) {
    setLine(next);
    setSaved(false);
    m.onLineChange(next, caret);
  }

  function choose(asset: AssetOption) {
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : line.length;
    const r = m.choose(asset, line, caret);
    if (!r) return;
    setLine(r.line);
    setSaved(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
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
            mentions: m.mentions,
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
            /*
             * The story path's decision and its shots. `shape` is what stage 03
             * reads to know whether to plan a spread of one moment or a
             * storyboard of several; empty rows are never saved, so an
             * abandoned "+ Add a shot" cannot become a beat somebody pays for.
             */
            shape: usableShots.length >= 2 ? shape : "single",
            shots: shape === "sequence"
              ? renumber(usableShots).map((s) => ({ n: s.n, text: s.text.trim(), provenance: s.provenance }))
              : [],
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
            onClick={(e) => m.onCaretMove(line, e.currentTarget.selectionStart)}
            onBlur={m.onBlur}
            onKeyDown={(e) => {
              if (m.picker && m.matches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
                // Only while the picker is open, so Enter still writes a newline
                // in ordinary typing.
                e.preventDefault();
                const pick = m.matches[m.highlight];
                if (pick) choose(pick);
                return;
              }
              m.onKeyDown(e);
            }}
            disabled={locked}
            rows={2}
            placeholder="new map release for Crown U"
            aria-label="Your brief, in one line. Type @ to attach an asset."
            aria-expanded={m.picker !== null}
            aria-controls={m.picker ? "brief-mention-picker" : undefined}
            className="mt-1.5 w-full resize-none border-0 bg-transparent p-0 text-[17px] leading-snug text-foreground outline-none placeholder:text-dim disabled:opacity-70"
          />

          {!locked && <MentionPickerList m={m} pickerId="brief-mention-picker" onChoose={choose} />}
        </div>

        {/*
          What is attached, stated rather than implied. The picker is transient;
          this is the standing record, and it is the §1.17 disclosure for the one
          decision the user makes by hand at this stage.
        */}
        <MentionChips mentions={m.mentions} />
        <p className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-dim">
          {yourWords > 0 ? (
            <>
              <span data-numeric className="font-mono">{yourWords}</span> {yourWords === 1 ? "word" : "words"} {"\u00b7"} never rewritten
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

      {/*
        The story choice, and the shot list behind it (step 4a).
        A shot is a MOMENT, not a framing — the spread already handles framings.
        Every edit here is free; nothing runs until stage 03.
      */}
      {(derived.length > 0 || shots.length > 0) && (
        <div className="rounded-sm border border-border/60 bg-card px-3.5 py-3" data-testid="story-shape">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.11em] text-dim">This post is</span>
            {([
              ["single", "One picture"],
              ["sequence", "A sequence of shots"],
            ] as Array<[PostShape, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => chooseShape(key)}
                disabled={locked}
                aria-pressed={shape === key}
                className={cn(
                  "rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.05em] hover-elevate disabled:opacity-50",
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
            {suggested && (
              <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-dim">
                suggested {"·"} your line describes more than one moment
              </span>
            )}
          </div>

          {shape === "sequence" && (
            <div className="mt-2.5 space-y-1.5">
              <p className="font-mono text-[8.5px] uppercase tracking-[0.09em] text-victory-gold">
                Shot list {"·"} derived, yours to edit
              </p>

              {shots.length === 0 && (
                <p className="text-[11.5px] leading-relaxed text-dim">
                  Your line reads as one moment, so there is nothing to sequence yet. Add the shots by hand,
                  or say more about what happens.
                </p>
              )}

              {shots.map((s) => (
                <div
                  key={s.n}
                  draggable={!locked}
                  onDragStart={() => setDragging(s.n)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => { if (!locked) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); dropShot(s.n); }}
                  className={cn(
                    "flex items-center gap-2 rounded-sm border bg-raised px-2 py-1.5",
                    dragging === s.n ? "border-grit-teal opacity-50" : "border-border",
                    locked ? "" : "cursor-grab active:cursor-grabbing",
                  )}
                  data-testid={`row-shot-${s.n}`}
                >
                  <span className="font-mono text-[8.5px] text-victory-gold" data-numeric>{s.n}</span>
                  <input
                    value={s.text}
                    onChange={(e) => editShot(s.n, e.target.value)}
                    disabled={locked}
                    placeholder="what happens at this moment"
                    aria-label={`Shot ${s.n}`}
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[11.5px] text-foreground outline-none placeholder:text-dim disabled:opacity-70"
                  />
                  <span
                    className={cn(
                      "whitespace-nowrap rounded-sm border px-1 py-px font-mono text-[7.5px] uppercase tracking-[0.06em]",
                      PROVENANCE_STYLES[s.provenance].cls,
                    )}
                  >
                    {PROVENANCE_STYLES[s.provenance].label}
                  </span>
                  {!locked && (
                    <button
                      onClick={() => removeShot(s.n)}
                      aria-label={`Remove shot ${s.n}`}
                      className="font-mono text-[10px] text-dim hover:text-rebel-pink"
                    >
                      {"×"}
                    </button>
                  )}
                </div>
              ))}

              {!locked && (
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    onClick={addShot}
                    disabled={shots.length >= MAX_SHOTS}
                    className="rounded-sm border border-border px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
                    data-testid="button-add-shot"
                  >
                    + Add a shot
                  </button>
                  <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
                    {usableShots.length < 2
                      ? `two moments make a sequence · ${usableShots.length} so far`
                      : `${usableShots.length} moments · each one generates and animates on its own`}
                  </span>
                </div>
              )}
            </div>
          )}
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
