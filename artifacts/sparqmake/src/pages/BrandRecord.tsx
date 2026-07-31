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

interface RecordResponse {
  brand: Record<string, unknown> & { id: string; name: string };
  completeness: { score: number; filledCount: number; total: number; cold: boolean; fields: FieldState[] };
  harvested: Array<{ color: string; count: number }>;
  guideFileUrl: string | null;
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

  const c = data?.completeness;

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
