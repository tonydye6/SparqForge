import * as React from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GradientOverlay, LAYOUT_DEFAULTS } from "./layout-editor.types";

interface GradientOverlayEditorProps {
  value: GradientOverlay;
  onChange: (gradient: GradientOverlay) => void;
  brandColors?: string[];
}

/** Parse a 6-digit hex string (with or without #) into { r, g, b }. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0");
  const int = parseInt(full.slice(0, 6), 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

/** Build the CSS linear-gradient string from current gradient values. */
function buildGradientCSS(gradient: GradientOverlay): string {
  const direction =
    gradient.direction ?? LAYOUT_DEFAULTS.gradient_overlay.direction;
  const color = gradient.color ?? LAYOUT_DEFAULTS.gradient_overlay.color;
  const startOpacity =
    gradient.start_opacity ?? LAYOUT_DEFAULTS.gradient_overlay.start_opacity;
  const endOpacity =
    gradient.end_opacity ?? LAYOUT_DEFAULTS.gradient_overlay.end_opacity;

  const { r, g, b } = hexToRgb(color);
  const cssDirection =
    direction === "bottom_to_top" ? "to top" : "to bottom";

  return `linear-gradient(${cssDirection}, rgba(${r}, ${g}, ${b}, ${startOpacity}), rgba(${r}, ${g}, ${b}, ${endOpacity}))`;
}

export function GradientOverlayEditor({
  value,
  onChange,
  brandColors,
}: GradientOverlayEditorProps) {
  const defaults = LAYOUT_DEFAULTS.gradient_overlay;

  const direction = value.direction ?? defaults.direction;
  const color = value.color ?? defaults.color;
  const startOpacity = value.start_opacity ?? defaults.start_opacity;
  const endOpacity = value.end_opacity ?? defaults.end_opacity;
  const heightPercent = value.height_percent ?? defaults.height_percent;

  // Local state for the hex text input so users can type freely
  const [hexInputValue, setHexInputValue] = React.useState<string>(color);

  // Keep hex input in sync when value.color changes externally
  React.useEffect(() => {
    setHexInputValue(value.color ?? defaults.color);
  }, [value.color, defaults.color]);

  function handleDirectionChange(dir: "bottom_to_top" | "top_to_bottom") {
    onChange({ ...value, direction: dir });
  }

  function handleColorPickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newColor = e.target.value;
    setHexInputValue(newColor);
    onChange({ ...value, color: newColor });
  }

  function handleHexInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setHexInputValue(raw);
    // Only commit valid hex values
    const clean = raw.replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      onChange({ ...value, color: `#${clean}` });
    }
  }

  function handleHexInputBlur() {
    // Normalise on blur — fall back to current committed color
    const clean = hexInputValue.replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      setHexInputValue(`#${clean}`);
    } else {
      setHexInputValue(color);
    }
  }

  function handleStartOpacityChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, start_opacity: parseFloat(e.target.value) });
  }

  function handleEndOpacityChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, end_opacity: parseFloat(e.target.value) });
  }

  function handleHeightSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, height_percent: parseInt(e.target.value, 10) });
  }

  function handleHeightNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.min(100, Math.max(0, parsed));
      onChange({ ...value, height_percent: clamped });
    }
  }

  const gradientCSS = buildGradientCSS(value);

  return (
    <div className="space-y-4">
      {/* Direction */}
      <div className="space-y-1.5">
        <Label>Gradient direction</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={
              direction === "bottom_to_top"
                ? "bg-primary/10 text-primary"
                : ""
            }
            onClick={() => handleDirectionChange("bottom_to_top")}
            aria-pressed={direction === "bottom_to_top"}
          >
            <ArrowUp className="size-4" />
            <span>Bottom to top</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={
              direction === "top_to_bottom"
                ? "bg-primary/10 text-primary"
                : ""
            }
            onClick={() => handleDirectionChange("top_to_bottom")}
            aria-pressed={direction === "top_to_bottom"}
          >
            <ArrowDown className="size-4" />
            <span>Top to bottom</span>
          </Button>
        </div>
      </div>

      {/* Color */}
      <div className="space-y-1.5">
        <Label>Gradient color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={handleColorPickerChange}
            className="h-9 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5"
            title="Pick gradient color"
          />
          <Input
            type="text"
            value={hexInputValue}
            onChange={handleHexInputChange}
            onBlur={handleHexInputBlur}
            placeholder={defaults.color}
            className="w-28 font-mono uppercase"
            maxLength={7}
          />
        </div>
        {brandColors && brandColors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {brandColors.map((bc) => (
              <button
                key={bc}
                type="button"
                title={bc}
                onClick={() => {
                  setHexInputValue(bc);
                  onChange({ ...value, color: bc });
                }}
                className="h-6 w-6 rounded border border-input shadow-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                style={{ backgroundColor: bc }}
                aria-label={`Use color ${bc}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Start Opacity */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Start opacity (dense end)</Label>
          <span className="text-xs text-muted-foreground">
            {Math.round(startOpacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={startOpacity}
          onChange={handleStartOpacityChange}
          className="w-full accent-primary"
        />
      </div>

      {/* End Opacity */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>End opacity (fade end)</Label>
          <span className="text-xs text-muted-foreground">
            {Math.round(endOpacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={endOpacity}
          onChange={handleEndOpacityChange}
          className="w-full accent-primary"
        />
      </div>

      {/* Height % */}
      <div className="space-y-1.5">
        <Label>Gradient height (% of image)</Label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={heightPercent}
            onChange={handleHeightSliderChange}
            className="flex-1 accent-primary"
          />
          <Input
            type="number"
            min={0}
            max={100}
            step={5}
            value={heightPercent}
            onChange={handleHeightNumberChange}
            className="w-16 text-right"
            placeholder={String(defaults.height_percent)}
          />
        </div>
      </div>

      {/* Inline gradient preview */}
      <div className="space-y-1.5">
        <Label>Preview</Label>
        <div
          className="h-[30px] w-full rounded-md border border-input"
          style={{ background: gradientCSS }}
          title={`Gradient preview — height: ${heightPercent}%`}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
