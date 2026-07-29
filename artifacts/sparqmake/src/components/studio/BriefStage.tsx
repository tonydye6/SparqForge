import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, cn } from "@/lib/utils";

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
        <textarea
          value={line}
          onChange={(e) => {
            setLine(e.target.value);
            setSaved(false);
          }}
          disabled={locked}
          rows={2}
          placeholder="new map release for Crown U"
          aria-label="Your brief, in one line"
          className="mt-1.5 w-full resize-none border-0 bg-transparent p-0 text-[17px] leading-snug text-foreground outline-none placeholder:text-dim disabled:opacity-70"
        />
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-dim">
          {yourWords > 0
            ? `${yourWords} ${yourWords === 1 ? "word" : "words"}. This is the only part that is yours by default, and it is never rewritten.`
            : "One line is enough. Everything below is derived from it and labelled with who decided it."}
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
        <p className="text-[11px] leading-relaxed text-dim">
          This stage is locked because you typed it. That is what stops an upstream re-run from overwriting your
          words. Unlock it above if you want it to rejoin the generated flow.
        </p>
      )}
    </div>
  );
}
