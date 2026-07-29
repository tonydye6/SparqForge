import { useState } from "react";

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
 *      proceed.
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
 */

interface BriefStageProps {
  creativeId: string;
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
}

/**
 * A question worth asking, with the assumption it falls back to.
 *
 * `assumption` is not optional. A question with no stated default is a gate,
 * and gates are what make people abandon a brief.
 */
interface OpenQuestion {
  id: string;
  question: string;
  options: string[];
  assumption: string;
}

export function BriefStage({ creativeId, stageId, locked, onSaved }: BriefStageProps) {
  const [line, setLine] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  /**
   * Derived rows and questions are placeholders until the intent service is
   * wired in the next Phase 4 commit. They are shaped exactly as the real
   * payload will be, and every one is labelled, so what is on screen is honest
   * about being derived rather than pretending to be your words.
   */
  const derived: DerivedRow[] = line.trim()
    ? [
        { key: "goal", label: "Goal", value: "Drive engagement from existing followers", provenance: "inferred" },
        { key: "audience", label: "Audience", value: "Existing players, not new installs", provenance: "inferred" },
        { key: "channels", label: "Channels", value: "IG feed, Story, X, TikTok", provenance: "brand" },
        { key: "mustnot", label: "Must not", value: "No trash talk, no red, no fake sponsor boards", provenance: "brand" },
      ]
    : [];

  const questions: OpenQuestion[] = line.trim()
    ? [
        {
          id: "timing",
          question: "Is this live now, or a tease?",
          options: ["Live now", "Tease", "Dated soon"],
          assumption: "live now, because your last three posts of this kind were",
        },
        {
          id: "art",
          question: "Lead with art you supply, or generate a scene?",
          options: ["Use my art", "Generate around it"],
          assumption: "use your art, composited and never redrawn",
        },
      ]
    : [];

  const yourWords = line.trim() ? line.trim().split(/\s+/).length : 0;
  // The gap the user is entitled to see: their words versus everything the
  // model will actually receive.
  const derivedWords = derived.reduce((n, d) => n + d.value.split(/\s+/).length, 0);
  const totalWords = yourWords + derivedWords;

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
          payload: line.trim(),
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

      {derived.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-sm border border-border/60 bg-card p-3.5">
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.11em] text-dim">
              What I derived from that
            </p>
            {derived.map((d) => (
              <div key={d.key} className="grid grid-cols-[70px_1fr] gap-2 border-b border-border/40 py-1.5 last:border-b-0">
                <span className="pt-0.5 font-mono text-[8.5px] uppercase tracking-[0.09em] text-dim">
                  {d.label}
                </span>
                <span className="text-[11.5px] leading-snug text-foreground">
                  {d.value}
                  <span
                    className={cn(
                      "ml-1.5 whitespace-nowrap rounded-sm border px-1 py-px font-mono text-[7.5px] uppercase tracking-[0.06em]",
                      PROVENANCE_STYLES[d.provenance].cls,
                    )}
                  >
                    {PROVENANCE_STYLES[d.provenance].label}
                  </span>
                </span>
              </div>
            ))}
            <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
              Every line is editable and any edit flips its label to yours. Nothing is sent that is not here.
            </p>
          </div>

          <div className="rounded-sm border border-border/60 bg-card p-3.5">
            <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.11em] text-dim">
              What I actually need from you · {questions.length}
            </p>
            {questions.map((q) => (
              <div key={q.id} className="mb-2 rounded-sm border border-border bg-raised px-2.5 py-2 last:mb-0">
                <p className="text-[12px] leading-snug text-foreground">{q.question}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
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
                  Skip and I assume <span className="text-muted-foreground">{q.assumption}</span>.
                </p>
              </div>
            ))}
            <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
              Only questions that change the output get asked, and each shows the assumption it will make if you
              ignore it. This is an interview, not a form.
            </p>
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
