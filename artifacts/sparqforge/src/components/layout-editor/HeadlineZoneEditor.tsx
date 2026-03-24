import { useState, useEffect } from "react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HeadlineZone, LAYOUT_DEFAULTS } from "./layout-editor.types";

interface HeadlineZoneEditorProps {
  value: HeadlineZone;
  onChange: (zone: HeadlineZone) => void;
  brandColors?: string[];
}

const POSITION_OPTIONS: { label: string; value: NonNullable<HeadlineZone["position"]> }[] = [
  { label: "Upper Third", value: "upper_third" },
  { label: "Center", value: "center" },
  { label: "Lower Third", value: "lower_third" },
];

const ALIGNMENT_OPTIONS: {
  value: NonNullable<HeadlineZone["alignment"]>;
  icon: React.ReactNode;
  label: string;
}[] = [
  { value: "left", icon: <AlignLeft className="h-4 w-4" />, label: "Align Left" },
  { value: "center", icon: <AlignCenter className="h-4 w-4" />, label: "Align Center" },
  { value: "right", icon: <AlignRight className="h-4 w-4" />, label: "Align Right" },
];

const defaults = LAYOUT_DEFAULTS.headline_zone;

export function HeadlineZoneEditor({ value, onChange, brandColors }: HeadlineZoneEditorProps) {
  const handleChange = <K extends keyof HeadlineZone>(field: K, newValue: HeadlineZone[K]) => {
    onChange({ ...value, [field]: newValue });
  };

  const stepNumber = (
    field: "padding_px" | "font_size_px" | "max_lines",
    delta: number,
    min: number,
    max: number,
  ) => {
    const current = value[field] ?? defaults[field];
    const next = Math.min(max, Math.max(min, (current as number) + delta));
    handleChange(field, next as HeadlineZone[typeof field]);
  };

  const currentPosition = value.position ?? undefined;
  const currentAlignment = value.alignment ?? defaults.alignment;
  const currentMaxWidth = value.max_width_percent ?? defaults.max_width_percent;
  const currentPadding = value.padding_px ?? defaults.padding_px;
  const currentFontSize = value.font_size_px ?? defaults.font_size_px;
  const committedColor = value.color ?? defaults.color;
  const [colorInput, setColorInput] = useState(committedColor);

  useEffect(() => {
    setColorInput(committedColor);
  }, [committedColor]);

  const isValidHex = (hex: string) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex);
  const normalizeHex = (hex: string) => {
    if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
      return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    return hex;
  };
  const currentMaxLines = value.max_lines ?? defaults.max_lines;

  return (
    <div className="space-y-4">
      {/* Position */}
      <div className="space-y-1.5">
        <Label>Position</Label>
        <Select
          value={currentPosition}
          onValueChange={(v) => handleChange("position", v as HeadlineZone["position"])}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                POSITION_OPTIONS.find((o) => o.value === defaults.position)?.label ??
                defaults.position
              }
            />
          </SelectTrigger>
          <SelectContent>
            {POSITION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Alignment */}
      <div className="space-y-1.5">
        <Label>Alignment</Label>
        <div className="flex gap-1">
          {ALIGNMENT_OPTIONS.map((opt) => {
            const isActive = currentAlignment === opt.value;
            return (
              <Button
                key={opt.value}
                type="button"
                variant="outline"
                size="sm"
                aria-label={opt.label}
                aria-pressed={isActive}
                className={isActive ? "bg-primary/10 text-primary" : ""}
                onClick={() => handleChange("alignment", opt.value)}
              >
                {opt.icon}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Max Width % */}
      <div className="space-y-1.5">
        <Label>Max Width %</Label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={currentMaxWidth}
            onChange={(e) => handleChange("max_width_percent", Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="w-12 text-right text-sm tabular-nums">{currentMaxWidth}%</span>
        </div>
      </div>

      {/* Padding (px) */}
      <div className="space-y-1.5">
        <Label>Padding (px)</Label>
        <div className="flex items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-r-none px-2"
            onClick={() => stepNumber("padding_px", -1, 0, 100)}
            aria-label="Decrease padding"
          >
            −
          </Button>
          <Input
            type="number"
            min={0}
            max={100}
            value={currentPadding}
            onChange={(e) =>
              handleChange(
                "padding_px",
                Math.min(100, Math.max(0, Number(e.target.value))),
              )
            }
            className="w-16 rounded-none text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-l-none px-2"
            onClick={() => stepNumber("padding_px", 1, 0, 100)}
            aria-label="Increase padding"
          >
            +
          </Button>
        </div>
      </div>

      {/* Font Size (px) */}
      <div className="space-y-1.5">
        <Label>Font Size (px)</Label>
        <div className="flex items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-r-none px-2"
            onClick={() => stepNumber("font_size_px", -1, 12, 120)}
            aria-label="Decrease font size"
          >
            −
          </Button>
          <Input
            type="number"
            min={12}
            max={120}
            value={currentFontSize}
            onChange={(e) =>
              handleChange(
                "font_size_px",
                Math.min(120, Math.max(12, Number(e.target.value))),
              )
            }
            className="w-16 rounded-none text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-l-none px-2"
            onClick={() => stepNumber("font_size_px", 1, 12, 120)}
            aria-label="Increase font size"
          >
            +
          </Button>
        </div>
      </div>

      {/* Color */}
      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={normalizeHex(committedColor)}
            onChange={(e) => handleChange("color", e.target.value)}
            className="h-9 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5"
            aria-label="Pick color"
          />
          <Input
            type="text"
            value={colorInput}
            maxLength={7}
            onChange={(e) => {
              const hex = e.target.value;
              if (/^#[0-9A-Fa-f]{0,6}$/.test(hex)) {
                setColorInput(hex);
                if (isValidHex(hex)) {
                  handleChange("color", hex);
                }
              }
            }}
            onBlur={() => {
              if (!isValidHex(colorInput)) {
                setColorInput(committedColor);
              }
            }}
            className="w-28 font-mono uppercase"
            placeholder={defaults.color}
          />
        </div>
        {brandColors && brandColors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {brandColors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Pick brand color ${c}`}
                title={c}
                onClick={() => handleChange("color", c)}
                className="h-6 w-6 rounded-sm border border-input transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Max Lines */}
      <div className="space-y-1.5">
        <Label>Max Lines</Label>
        <div className="flex items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-r-none px-2"
            onClick={() => stepNumber("max_lines", -1, 1, 5)}
            aria-label="Decrease max lines"
          >
            −
          </Button>
          <Input
            type="number"
            min={1}
            max={5}
            value={currentMaxLines}
            onChange={(e) =>
              handleChange(
                "max_lines",
                Math.min(5, Math.max(1, Number(e.target.value))),
              )
            }
            className="w-16 rounded-none text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-l-none px-2"
            onClick={() => stepNumber("max_lines", 1, 1, 5)}
            aria-label="Increase max lines"
          >
            +
          </Button>
        </div>
      </div>
    </div>
  );
}
