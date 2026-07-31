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

interface FieldState {
  key: string;
  label: string;
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

const COLOR_KEYS = new Set(["colorPrimary", "colorSecondary", "colorAccent", "colorBackground"]);

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

  async function save(key: string) {
    if (!brandId || saving) return;
    const value = draft[key];
    if (value === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/brands/${brandId}/record`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { [key]: value }, source: "user" }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body?.error ?? "That could not be saved."); return; }
      await load(brandId);
    } finally {
      setSaving(false);
    }
  }

  const c = data?.completeness;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
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
          const raw = data!.brand[f.key];
          const current = Array.isArray(raw) ? raw.join(", ") : raw == null ? "" : String(raw);
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
                {COLOR_KEYS.has(f.key) && /^#[0-9a-fA-F]{6}$/.test(value) && (
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
                    onClick={() => void save(f.key)}
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
  );
}
