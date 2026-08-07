import { useCallback, useEffect, useState } from "react";
import { apiFetch, cn } from "@/lib/utils";

/**
 * Phase 5 · the brand record.
 *
 * These fields already drove every generation. What was missing was anywhere to
 * see them, so nobody could tell what the Studio was guessing: Crown U was in
 * daily use with no default director and no style profile, and nothing said so.
 *
 * The framing is deliberate and worth holding. **An incomplete brand is not
 * broken; it is guessing.** So this screen never scolds and never says
 * "incomplete". It states, per field, what is being guessed instead and which
 * stage pays for it. A brand at 24% is a brand whose output will be visibly
 * weaker, and saying which weakness is the useful part.
 *
 * Every line carries its origin, so a value harvested from the library or
 * extracted from a guide can never be mistaken for one a person chose.
 */

type FieldKind = "text" | "color" | "list" | "json";

interface FieldState {
  key: string;
  label: string;
  kind: FieldKind;
  consumedBy: string;
  weight: number;
  costWhenMissing: string;
  filled: boolean;
  source: "user" | "guide" | "learned" | "default";
}

interface GuideCandidate {
  key: string;
  label: string;
  kind: FieldKind;
  value: unknown;
  formatted: string;
  quote: string;
  current: string;
  replacesAuthored: boolean;
}

interface RecordResponse {
  brand: Record<string, unknown> & { id: string; name: string };
  completeness: { score: number; filledCount: number; total: number; cold: boolean; fields: FieldState[] };
  harvested: Array<{ color: string; count: number }>;
  guideFileUrl: string | null;
}

interface LearnedCandidate {
  conclusionId: string;
  kind: string;
  rule: string;
  because: string;
  evidenceLine: string;
  overlapsApplied: string | null;
}

interface AppliedRule {
  index: number;
  rule: string;
  source: "user" | "guide" | "learned";
  n: number;
  appliedAt: string;
  retiredAt: string | null;
  conclusionId: string | null;
}

interface LearnedResponse {
  candidates: LearnedCandidate[];
  withheld: Array<{ conclusionId: string; rule: string; reason: string }>;
  rules: AppliedRule[];
  activeCount: number;
  trackedPosts: number;
}

const SOURCE_STYLE: Record<FieldState["source"], { label: string; cls: string }> = {
  user: { label: "You", cls: "text-foreground border-border" },
  guide: { label: "From the guide", cls: "text-victory-gold border-victory-gold/40" },
  learned: { label: "Learned", cls: "text-cyber-teal border-grit-teal/40" },
  default: { label: "Never set", cls: "text-dim border-border/50" },
};

/*
 * Display and parse have to respect the column's shape. `bannedTerms` is a
 * text[] and `hashtagStrategy` is jsonb: the first version showed the latter as
 * "[object Object]" and, worse, saved every field as a plain string, which
 * would have pushed a string into an array column on the first edit. Mirrors
 * formatFieldValue / parseFieldValue on the server.
 */
function formatValue(kind: FieldKind, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (kind === "list") return Array.isArray(value) ? value.join(", ") : String(value);
  if (kind === "json") return typeof value === "object" ? JSON.stringify(value) : String(value);
  return String(value);
}

function parseValue(kind: FieldKind, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (kind === "list") return { ok: true, value: trimmed.split(",").map(s => s.trim()).filter(Boolean) };
  if (kind === "json") {
    if (!trimmed) return { ok: true, value: {} };
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, error: 'This field holds a JSON object, so it needs braces: {"always_include": ["#CrownU"]}' };
      }
      return { ok: true, value: parsed };
    } catch {
      return { ok: false, error: "That is not valid JSON, so nothing was saved." };
    }
  }
  if (kind === "color") {
    if (!trimmed) return { ok: true, value: "" };
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return { ok: false, error: "A colour needs to be a six-digit hex value like #EB0028." };
    }
    return { ok: true, value: trimmed };
  }
  return { ok: true, value: trimmed };
}

export default function BrandRecord() {
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [data, setData] = useState<RecordResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [candidates, setCandidates] = useState<GuideCandidate[] | null>(null);
  const [rejected, setRejected] = useState<Array<{ key: string; reason: string }>>([]);
  const [learned, setLearned] = useState<LearnedResponse | null>(null);
  const [newRule, setNewRule] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/brands");
        if (!res.ok) return;
        const body = await res.json();
        const rows = Array.isArray(body) ? body : (body?.brands ?? body?.data ?? []);
        setBrands(rows.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })));
        if (rows[0]?.id) setBrandId(rows[0].id);
      } catch { /* the picker stays empty, which is visible rather than wrong */ }
    })();
  }, []);

  const load = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/api/brands/${id}/record`);
      if (!res.ok) return;
      setData(await res.json());
      setDraft({});
    } catch { /* leave the last good view rather than blanking it */ }
    try {
      // Separate request on purpose: it reads post_metrics, and a slow or empty
      // performance query must not hold up the record itself.
      const res = await apiFetch(`/api/brands/${id}/learned`);
      if (res.ok) setLearned(await res.json());
    } catch { /* the panel says nothing rather than showing something wrong */ }
  }, []);

  useEffect(() => { if (brandId) void load(brandId); }, [brandId, load]);

  async function save(key: string, kind: FieldKind) {
    if (!brandId || saving) return;
    const text = draft[key];
    if (text === undefined) return;

    // Convert before sending. A refusal here is the whole point: saving a string
    // into a list or a JSON column would report success and destroy the value.
    const parsed = parseValue(kind, text);
    if (!parsed.ok) { setError(parsed.error); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/brands/${brandId}/record`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { [key]: parsed.value }, source: "user" }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body?.error ?? "That could not be saved."); return; }
      await load(brandId);
    } finally {
      setSaving(false);
    }
  }

  async function readGuide(file: File) {
    if (!brandId || reading) return;
    setReading(true);
    setError(null);
    setCandidates(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/api/brands/${brandId}/guide`, { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) { setError(body?.error ?? "The guide could not be read."); return; }
      setCandidates(body.candidates ?? []);
      setRejected(body.rejected ?? []);
    } catch {
      setError("The guide could not be read.");
    } finally {
      setReading(false);
    }
  }

  /** Accepting a candidate is a separate write, and it stamps the guide as its source. */
  async function accept(cand: GuideCandidate) {
    if (!brandId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/brands/${brandId}/record`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { [cand.key]: cand.value }, source: "guide" }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body?.error ?? "That could not be applied."); return; }
      setCandidates((prev) => (prev ?? []).filter((x) => x.key !== cand.key));
      await load(brandId);
    } finally {
      setSaving(false);
    }
  }

  /** Applying a learned candidate, or writing a rule by hand. */
  async function applyRule(body: { conclusionId?: string; rule?: string }) {
    if (!brandId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/brands/${brandId}/composition-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (!res.ok) { setError(out?.error ?? "That rule could not be applied."); return; }
      setNewRule("");
      await load(brandId);
    } finally {
      setSaving(false);
    }
  }

  async function retire(conclusionId: string) {
    if (!brandId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/brands/${brandId}/composition-rules/${encodeURIComponent(conclusionId)}/retire`, {
        method: "POST",
      });
      const out = await res.json();
      if (!res.ok) { setError(out?.error ?? "That rule could not be retired."); return; }
      await load(brandId);
    } finally {
      setSaving(false);
    }
  }

  const c = data?.completeness;
  const liveRules = (learned?.rules ?? []).filter(r => !r.retiredAt);
  const retiredRules = (learned?.rules ?? []).filter(r => r.retiredAt);

  /*
   * The outer scroller is not optional, and the inner `w-full` is not padding.
   *
   * AppLayout's content slot is `overflow-hidden`, so a page that does not
   * bring its own scroller is CLIPPED rather than scrolled: this screen shipped
   * with 1639px of record inside a 953px box, and every unset field, which is
   * the entire point of it, was unreachable. Nothing said so; it just ended.
   *
   * And `mx-auto` alone was making it narrow. In a flex column an auto cross-axis
   * margin cancels the default stretch, so the box shrank to its content at
   * 721px instead of filling to the 896px cap. `w-full` restores the stretch and
   * lets max-w do the capping.
   */
  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-[19px] uppercase tracking-[0.02em] text-foreground">Brand record</h1>
          <p className="mt-0.5 text-[11.5px] text-dim">
            What every stage reads before it generates anything.
          </p>
        </div>
        {brands.length > 1 && (
          <select
            value={brandId ?? ""}
            onChange={(e) => setBrandId(e.target.value)}
            className="rounded-sm border border-border bg-card px-2 py-1 text-[12px] text-foreground"
            aria-label="Brand"
          >
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {c && (
        <div className="rounded-sm border border-border/60 bg-card px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-grit-teal">
              {data!.brand.name}
            </p>
            <span className="font-mono text-[13px] text-foreground" data-numeric>{c.score}%</span>
          </div>
          {/* A bar, not a grade. The sentence under it is the part that matters. */}
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-sm bg-raised">
            <div
              className={cn("h-full", c.score >= 70 ? "bg-grit-teal" : c.score >= 35 ? "bg-victory-gold" : "bg-rebel-pink")}
              style={{ width: `${Math.max(c.score, 2)}%` }}
            />
          </div>
          <p className="mt-2 max-w-[85ch] text-[12px] leading-relaxed text-muted-foreground">
            {c.cold
              ? "Nothing is set yet, so every post is generated from the scaffold defaults. Anything you fill in below is used immediately."
              : c.filledCount === c.total
                ? "Everything the Studio reads is set. Nothing is being guessed."
                : `${c.filledCount} of ${c.total} set. An unset field is not a broken brand, it is a guess the model makes for you. Each one below says which.`}
          </p>
        </div>
      )}

      {data && data.harvested.length > 0 && (
        <div className="rounded-sm border border-border/60 bg-card px-3.5 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">
            Colours already in this brand's library
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-dim">
            Counted across your own analysed assets. Suggestions only: nothing here is in the record
            until you put it there.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.harvested.map((h) => (
              <span key={h.color} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-1.5 py-0.5">
                <span className="h-3 w-3 rounded-sm border border-border/60" style={{ background: h.color }} />
                <span className="font-mono text-[10px] text-foreground">{h.color}</span>
                <span className="font-mono text-[9px] text-dim" data-numeric>×{h.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] text-rebel-pink">{error}</p>
      )}

      {/*
        Reading a guide PROPOSES; it never writes. Each candidate carries the
        sentence it came from, and accepting one is a separate act that stamps
        the guide as its source. That separation is what stops an extraction
        becoming brand law.
      */}
      <div className="rounded-sm border border-border/60 bg-card px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">
            Read a brand guide
          </p>
          {data?.guideFileUrl && (
            <a href={data.guideFileUrl} target="_blank" rel="noreferrer" className="font-mono text-[9px] uppercase tracking-[0.09em] text-grit-teal">
              Current guide
            </a>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-dim">
          A PDF the brand team already wrote is the fastest way to fill this in. Nothing is applied
          until you apply it, and every line comes with the sentence it was read from.
        </p>
        <label className="mt-2 inline-flex cursor-pointer items-center rounded-sm border border-border px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate">
          {reading ? "Reading" : "Choose a PDF"}
          <input
            type="file" accept="application/pdf" className="hidden" disabled={reading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readGuide(f); e.target.value = ""; }}
          />
        </label>

        {candidates && candidates.length === 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-victory-gold">
            Nothing in that document could be traced to a specific line, so nothing is being
            proposed. That is a fact about the guide rather than a failure.
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <div className="mt-2.5 space-y-2">
            {candidates.map((cand) => (
              <div key={cand.key} className="rounded-sm border border-victory-gold/40 bg-raised px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[12px] text-foreground">{cand.label}</p>
                  <button
                    type="button" onClick={() => void accept(cand)} disabled={saving}
                    className="shrink-0 rounded-sm bg-primary px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-foreground">{cand.formatted}</p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-dim">
                  Read from: <span className="text-muted-foreground">&ldquo;{cand.quote}&rdquo;</span>
                </p>
                {cand.replacesAuthored && (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-rebel-pink">
                    This would replace what you wrote: &ldquo;{cand.current}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {rejected.length > 0 && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
            Not proposed: {rejected.map((r) => `${r.key} (${r.reason})`).join(" · ")}
          </p>
        )}
      </div>

      {/*
        The third source. Harvesting reads the library, the guide reads a PDF,
        and this reads how the brand's published work actually did. Same shape
        deliberately: propose, show the evidence, let a person accept, stamp
        where it came from.

        The empty state is the one that matters most here, because it is the
        state this brand is actually in. A panel that renders nothing would read
        as broken; this one says what it had to work with and what would change
        it.
      */}
      <div className="rounded-sm border border-border/60 bg-card px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">
            Composition rules
          </p>
          <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-dim">
            {liveRules.length} in the contract
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-dim">
          These are sent with every image this brand generates, just after its visual language and
          ahead of everything it forbids. A rule learned from performance carries the number of posts
          behind it, so a thin finding never reads like brand law.
        </p>

        {liveRules.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {liveRules.map((r) => (
              <div key={r.conclusionId ?? r.index} className="rounded-sm border border-border/60 bg-raised px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[11.5px] leading-relaxed text-foreground">{r.rule}</p>
                  {r.conclusionId && (
                    <button
                      type="button" onClick={() => void retire(r.conclusionId!)} disabled={saving}
                      className="shrink-0 rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate disabled:opacity-50"
                    >
                      Retire
                    </button>
                  )}
                </div>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.09em] text-dim">
                  {r.source === "learned" ? `Learned · ${r.n} post${r.n === 1 ? "" : "s"}`
                    : r.source === "guide" ? "From the guide" : "Set by the team"}
                </p>
              </div>
            ))}
          </div>
        )}

        {learned && learned.candidates.length > 0 && (
          <div className="mt-2.5 space-y-2">
            {learned.candidates.map((cand) => (
              <div key={cand.conclusionId} className="rounded-sm border border-grit-teal/40 bg-raised px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[11.5px] leading-relaxed text-foreground">{cand.rule}</p>
                  <button
                    type="button" onClick={() => void applyRule({ conclusionId: cand.conclusionId })} disabled={saving}
                    className="shrink-0 rounded-sm bg-primary px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">{cand.because}</p>
                <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.09em] text-grit-teal">{cand.evidenceLine}</p>
                {cand.overlapsApplied && (
                  <p className="mt-1 text-[10.5px] leading-relaxed text-victory-gold">
                    A rule already says something similar: &ldquo;{cand.overlapsApplied}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/*
          Said out loud. "Nothing was found" and "four things were found and
          none had enough behind them" are different facts about the brand, and
          only one of them means the derivation is working.
        */}
        {learned && learned.candidates.length === 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-victory-gold">
            {learned.trackedPosts === 0
              ? "Nothing has been learned yet, because no post from this brand has been published and tracked. Conclusions appear here once they have been."
              : learned.withheld.length === 0
                ? `${learned.trackedPosts} tracked post${learned.trackedPosts === 1 ? "" : "s"} so far, and nothing in them yet points one way strongly enough to propose.`
                : `${learned.trackedPosts} tracked post${learned.trackedPosts === 1 ? "" : "s"}, but nothing survived the checks.`}
          </p>
        )}
        {/*
          The refusal names the FINDING, not its id. An earlier pass rendered
          "channel:hype:instagram (a channel finding does not belong...)", which
          discloses a string rather than something a person can judge.
        */}
        {learned && learned.withheld.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {learned.withheld.map((w) => (
              <li key={w.conclusionId} className="text-[10.5px] leading-relaxed text-dim">
                Not proposed: {w.rule ? <span className="text-muted-foreground">{w.rule}</span> : "an unnamed finding"}{" "}
                &mdash; {w.reason}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2.5 flex items-start gap-2">
          <input
            value={newRule}
            onChange={(e) => setNewRule(e.target.value)}
            placeholder="Or write a rule yourself"
            aria-label="Write a composition rule"
            className="min-w-0 flex-1 border-0 border-b border-border/40 bg-transparent px-0 pb-1 text-[12px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal"
          />
          {newRule.trim() && (
            <button
              type="button" onClick={() => void applyRule({ rule: newRule.trim() })} disabled={saving}
              className="shrink-0 rounded-sm bg-primary px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
            >
              Add
            </button>
          )}
        </div>

        {retiredRules.length > 0 && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-dim">
            Retired, and kept so they are not proposed again:{" "}
            {retiredRules.map((r) => r.rule).join(" · ")}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {c?.fields.map((f) => {
          const current = formatValue(f.kind, data!.brand[f.key]);
          const value = draft[f.key] ?? current;
          const dirty = draft[f.key] !== undefined && draft[f.key] !== current;
          const style = SOURCE_STYLE[f.source];
          return (
            <div
              key={f.key}
              className={cn(
                "rounded-sm border bg-card px-3.5 py-2.5",
                f.filled ? "border-border/60" : "border-l-2 border-l-victory-gold/60 border-border/60",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[12.5px] text-foreground">{f.label}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-dim">{f.consumedBy}</span>
                  <span className={cn("rounded-sm border px-1 py-px font-mono text-[8.5px] uppercase tracking-[0.09em]", style.cls)}>
                    {style.label}
                  </span>
                </div>
              </div>

              <div className="mt-1.5 flex items-start gap-2">
                {f.kind === "color" && /^#[0-9a-fA-F]{6}$/.test(value) && (
                  <span className="mt-0.5 h-5 w-5 shrink-0 rounded-sm border border-border/60" style={{ background: value }} />
                )}
                <input
                  value={value}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.filled ? "" : "Not set"}
                  aria-label={f.label}
                  className="min-w-0 flex-1 border-0 border-b border-border/40 bg-transparent px-0 pb-1 text-[12px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal"
                />
                {dirty && (
                  <button
                    type="button"
                    onClick={() => void save(f.key, f.kind)}
                    disabled={saving}
                    className="shrink-0 rounded-sm bg-primary px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
              </div>

              {/*
                The cost, shown only when it is being paid. Stating what an unset
                field costs is the whole difference between a progress bar and a
                record worth filling in.
              */}
              {!f.filled && (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-victory-gold">{f.costWhenMissing}</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="max-w-[85ch] text-[11px] leading-relaxed text-dim">
        Importing a brand guide and learning fields from performance both write here too, and both
        stamp their own origin, so an automated suggestion never quietly becomes brand law.
      </p>
    </div>
    </div>
  );
}
