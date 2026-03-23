import * as React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { Code, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HeadlineZoneEditor } from "./HeadlineZoneEditor";
import { LogoPlacementEditor } from "./LogoPlacementEditor";
import { GradientOverlayEditor } from "./GradientOverlayEditor";
import { LayoutPreviewCanvas } from "./LayoutPreviewCanvas";
import type {
  LayoutSpec,
  HeadlineZone,
  LogoPlacement,
  GradientOverlay,
} from "./layout-editor.types";
import { LAYOUT_PRESETS } from "./layout-presets";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LayoutSpecEditorProps {
  value: LayoutSpec;
  onChange: (spec: LayoutSpec) => void;
  brandColors?: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  brandLogoUrl?: string | null;
  targetAspectRatios?: string[];
}

/* ------------------------------------------------------------------ */
/*  Collapsible section wrapper                                        */
/* ------------------------------------------------------------------ */

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <span className="font-medium text-sm">{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function LayoutSpecEditor({
  value,
  onChange,
  brandColors,
  brandLogoUrl,
  targetAspectRatios,
}: LayoutSpecEditorProps) {
  /* ---- State ---- */
  const [spec, setSpec] = useState<LayoutSpec>(value || {});
  const [activeRatio, setActiveRatio] = useState<string>("base");
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState({
    headline: true,
    logo: true,
    gradient: true,
  });

  // Track last serialised value from parent to avoid infinite loops
  const lastExternalJson = useRef<string>(JSON.stringify(value || {}));

  /* ---- Sync with parent value prop ---- */
  useEffect(() => {
    const incoming = JSON.stringify(value || {});
    if (incoming !== lastExternalJson.current) {
      lastExternalJson.current = incoming;
      setSpec(value || {});
    }
  }, [value]);

  /* ---- Brand color swatches ---- */
  const brandColorArray = brandColors
    ? [
        brandColors.primary,
        brandColors.secondary,
        brandColors.accent,
        brandColors.background,
      ].filter(Boolean)
    : undefined;

  /* ---- Section toggle helper ---- */
  const toggleSection = useCallback(
    (key: keyof typeof openSections) => {
      setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    [],
  );

  /* ---- Emit spec changes ---- */
  const emitChange = useCallback(
    (newSpec: LayoutSpec) => {
      setSpec(newSpec);
      lastExternalJson.current = JSON.stringify(newSpec);
      onChange(newSpec);
    },
    [onChange],
  );

  /* ---- Preset selection ---- */
  const handlePresetSelect = useCallback(
    (presetId: string) => {
      const preset = LAYOUT_PRESETS.find((p) => p.id === presetId);
      if (preset) {
        emitChange({ ...preset.spec });
      }
    },
    [emitChange],
  );

  /* ---- JSON toggle ---- */
  const enterJsonMode = useCallback(() => {
    setJsonText(JSON.stringify(spec, null, 2));
    setJsonError(null);
    setJsonMode(true);
  }, [spec]);

  const leaveJsonMode = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText) as LayoutSpec;
      emitChange(parsed);
      setJsonError(null);
      setJsonMode(false);
    } catch (err) {
      setJsonError(
        err instanceof Error ? err.message : "Invalid JSON",
      );
    }
  }, [jsonText, emitChange]);

  const handleJsonToggle = useCallback(() => {
    if (jsonMode) {
      leaveJsonMode();
    } else {
      enterJsonMode();
    }
  }, [jsonMode, enterJsonMode, leaveJsonMode]);

  /* ---- Determine if editing an override or the base spec ---- */
  const isOverrideMode = activeRatio !== "base";

  /** Get the sub-spec currently being edited (base or per-ratio override). */
  const editingSpec: LayoutSpec = isOverrideMode
    ? spec.aspect_ratio_overrides?.[activeRatio] ?? {}
    : spec;

  /* ---- Sub-editor onChange handlers ---- */
  const handleHeadlineChange = useCallback(
    (zone: HeadlineZone) => {
      if (isOverrideMode) {
        const overrides = { ...(spec.aspect_ratio_overrides ?? {}) };
        overrides[activeRatio] = {
          ...(overrides[activeRatio] ?? {}),
          headline_zone: zone,
        };
        emitChange({ ...spec, aspect_ratio_overrides: overrides });
      } else {
        emitChange({ ...spec, headline_zone: zone });
      }
    },
    [spec, isOverrideMode, activeRatio, emitChange],
  );

  const handleLogoChange = useCallback(
    (placement: LogoPlacement) => {
      if (isOverrideMode) {
        const overrides = { ...(spec.aspect_ratio_overrides ?? {}) };
        overrides[activeRatio] = {
          ...(overrides[activeRatio] ?? {}),
          logo_placement: placement,
        };
        emitChange({ ...spec, aspect_ratio_overrides: overrides });
      } else {
        emitChange({ ...spec, logo_placement: placement });
      }
    },
    [spec, isOverrideMode, activeRatio, emitChange],
  );

  const handleGradientChange = useCallback(
    (gradient: GradientOverlay) => {
      if (isOverrideMode) {
        const overrides = { ...(spec.aspect_ratio_overrides ?? {}) };
        overrides[activeRatio] = {
          ...(overrides[activeRatio] ?? {}),
          gradient_overlay: gradient,
        };
        emitChange({ ...spec, aspect_ratio_overrides: overrides });
      } else {
        emitChange({ ...spec, gradient_overlay: gradient });
      }
    },
    [spec, isOverrideMode, activeRatio, emitChange],
  );

  /* ---- Resolve effective values for override mode placeholders ---- */
  const headlineValue: HeadlineZone = isOverrideMode
    ? { ...(spec.headline_zone ?? {}), ...(editingSpec.headline_zone ?? {}) }
    : editingSpec.headline_zone ?? {};

  const logoValue: LogoPlacement = isOverrideMode
    ? { ...(spec.logo_placement ?? {}), ...(editingSpec.logo_placement ?? {}) }
    : editingSpec.logo_placement ?? {};

  const gradientValue: GradientOverlay = isOverrideMode
    ? {
        ...(spec.gradient_overlay ?? {}),
        ...(editingSpec.gradient_overlay ?? {}),
      }
    : editingSpec.gradient_overlay ?? {};

  /* ---- Compute preview aspect ratio ---- */
  const previewRatio =
    activeRatio === "base"
      ? targetAspectRatios?.[0] || "1:1"
      : activeRatio;

  /* ---- Aspect ratio tabs ---- */
  const hasRatioTabs =
    targetAspectRatios && targetAspectRatios.length > 0;
  const ratioTabs = hasRatioTabs
    ? ["base", ...targetAspectRatios]
    : null;

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="md:flex md:gap-6">
      {/* ---- Form panel ---- */}
      <div className="md:w-[55%] space-y-4">
        {/* Top bar: Preset select + JSON toggle */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Select onValueChange={handlePresetSelect}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Load preset..." />
              </SelectTrigger>
              <SelectContent>
                {LAYOUT_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    <div className="flex flex-col">
                      <span>{preset.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {preset.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant={jsonMode ? "default" : "outline"}
            size="sm"
            onClick={handleJsonToggle}
            aria-label={jsonMode ? "Exit JSON mode" : "Edit as JSON"}
            title={jsonMode ? "Exit JSON mode" : "Edit as JSON"}
          >
            <Code className="h-4 w-4" />
          </Button>
        </div>

        {/* JSON editor mode */}
        {jsonMode ? (
          <div className="space-y-2">
            <Textarea
              className="font-mono text-xs"
              rows={16}
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonError(null);
              }}
            />
            {jsonError && (
              <p className="text-sm text-destructive">{jsonError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Edit the JSON spec directly. Click the Code button again
              to apply changes.
            </p>
          </div>
        ) : (
          <>
            {/* Aspect ratio tabs */}
            {ratioTabs && (
              <div className="flex flex-wrap gap-1 border-b border-border pb-2">
                {ratioTabs.map((tab) => {
                  const isActive = activeRatio === tab;
                  const label =
                    tab === "base" ? "Base" : tab;
                  return (
                    <Button
                      key={tab}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "text-xs",
                        isActive &&
                          "bg-primary/10 text-primary",
                      )}
                      onClick={() => setActiveRatio(tab)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            )}

            {/* Override mode hint */}
            {isOverrideMode && (
              <p className="text-xs text-muted-foreground italic">
                Editing overrides for{" "}
                <strong>{activeRatio}</strong>. Empty fields inherit
                from Base.
              </p>
            )}

            {/* Section editors */}
            <div className="space-y-3">
              <CollapsibleSection
                title="Headline Zone"
                open={openSections.headline}
                onToggle={() => toggleSection("headline")}
              >
                <HeadlineZoneEditor
                  value={headlineValue}
                  onChange={handleHeadlineChange}
                  brandColors={brandColorArray}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Logo Placement"
                open={openSections.logo}
                onToggle={() => toggleSection("logo")}
              >
                <LogoPlacementEditor
                  value={logoValue}
                  onChange={handleLogoChange}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Gradient Overlay"
                open={openSections.gradient}
                onToggle={() => toggleSection("gradient")}
              >
                <GradientOverlayEditor
                  value={gradientValue}
                  onChange={handleGradientChange}
                  brandColors={brandColorArray}
                />
              </CollapsibleSection>
            </div>
          </>
        )}
      </div>

      {/* ---- Preview panel ---- */}
      <div className="mt-6 md:mt-0 md:w-[45%] md:sticky md:top-4 self-start">
        <LayoutPreviewCanvas
          spec={spec}
          aspectRatio={previewRatio}
          brandLogoUrl={brandLogoUrl}
        />
      </div>
    </div>
  );
}
