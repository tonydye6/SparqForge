import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoPlacement, LAYOUT_DEFAULTS } from "./layout-editor.types";

interface LogoPlacementEditorProps {
  value: LogoPlacement;
  onChange: (placement: LogoPlacement) => void;
}

type CornerPosition = "top_left" | "top_right" | "bottom_left" | "bottom_right";

const CORNERS: { id: CornerPosition; label: string }[] = [
  { id: "top_left", label: "TL" },
  { id: "top_right", label: "TR" },
  { id: "bottom_left", label: "BL" },
  { id: "bottom_right", label: "BR" },
];

const DOT_POSITION_CLASSES: Record<CornerPosition, string> = {
  top_left: "top-1 left-1",
  top_right: "top-1 right-1",
  bottom_left: "bottom-1 left-1",
  bottom_right: "bottom-1 right-1",
};

const LABEL_POSITION_CLASSES: Record<CornerPosition, string> = {
  top_left: "top-1 left-1",
  top_right: "top-1 right-1",
  bottom_left: "bottom-1 left-1",
  bottom_right: "bottom-1 right-1",
};

export function LogoPlacementEditor({ value, onChange }: LogoPlacementEditorProps) {
  const defaults = LAYOUT_DEFAULTS.logo_placement;

  const currentPosition = value.position ?? defaults.position;
  const currentOffset = value.offset_px ?? defaults.offset_px;
  const currentMaxHeight = value.max_height_px ?? defaults.max_height_px;
  const currentOpacity = value.opacity ?? defaults.opacity;

  const handlePositionChange = (pos: CornerPosition) => {
    onChange({ ...value, position: pos });
  };

  const handleOffsetChange = (delta: number) => {
    const next = Math.min(100, Math.max(0, (currentOffset) + delta));
    onChange({ ...value, offset_px: next });
  };

  const handleOffsetInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(100, Math.max(0, Number(e.target.value)));
    onChange({ ...value, offset_px: next });
  };

  const handleMaxHeightChange = (delta: number) => {
    const next = Math.min(200, Math.max(20, (currentMaxHeight) + delta));
    onChange({ ...value, max_height_px: next });
  };

  const handleMaxHeightInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(200, Math.max(20, Number(e.target.value)));
    onChange({ ...value, max_height_px: next });
  };

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...value, opacity: Number(e.target.value) });
  };

  const opacityPercent = Math.round((currentOpacity) * 100);

  return (
    <div className="space-y-4">
      {/* Position */}
      <div className="space-y-1.5">
        <Label>Position</Label>
        <div className="grid grid-cols-2 gap-2 w-32">
          {CORNERS.map((corner) => {
            const isSelected = currentPosition === corner.id;
            return (
              <button
                key={corner.id}
                type="button"
                onClick={() => handlePositionChange(corner.id)}
                className={[
                  "relative h-12 rounded border transition-colors",
                  isSelected
                    ? "bg-primary/20 border-primary ring-1 ring-primary"
                    : "bg-muted/30 border-border hover:bg-muted/50",
                ].join(" ")}
                aria-label={corner.id.replace("_", " ")}
              >
                {/* Dot indicator in corner */}
                <span
                  className={[
                    "absolute w-1.5 h-1.5 rounded-full",
                    DOT_POSITION_CLASSES[corner.id],
                    isSelected ? "bg-primary" : "bg-muted-foreground/50",
                  ].join(" ")}
                />
                {/* Label */}
                <span
                  className={[
                    "absolute text-[9px] font-medium leading-none text-muted-foreground",
                    LABEL_POSITION_CLASSES[corner.id],
                    // offset label slightly away from dot so they don't overlap
                    corner.id === "top_left" ? "top-3 left-1" : "",
                    corner.id === "top_right" ? "top-3 right-1" : "",
                    corner.id === "bottom_left" ? "bottom-3 left-1" : "",
                    corner.id === "bottom_right" ? "bottom-3 right-1" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {corner.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Offset */}
      <div className="space-y-1.5">
        <Label htmlFor="logo-offset">Corner offset (px)</Label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => handleOffsetChange(-1)}
            disabled={currentOffset <= 0}
            aria-label="Decrease offset"
          >
            <Minus />
          </Button>
          <Input
            id="logo-offset"
            type="number"
            min={0}
            max={100}
            value={currentOffset}
            placeholder={String(defaults.offset_px)}
            onChange={handleOffsetInput}
            className="w-20 text-center"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => handleOffsetChange(1)}
            disabled={currentOffset >= 100}
            aria-label="Increase offset"
          >
            <Plus />
          </Button>
        </div>
      </div>

      {/* Max Height */}
      <div className="space-y-1.5">
        <Label htmlFor="logo-max-height">Logo max height (px)</Label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => handleMaxHeightChange(-1)}
            disabled={currentMaxHeight <= 20}
            aria-label="Decrease max height"
          >
            <Minus />
          </Button>
          <Input
            id="logo-max-height"
            type="number"
            min={20}
            max={200}
            value={currentMaxHeight}
            placeholder={String(defaults.max_height_px)}
            onChange={handleMaxHeightInput}
            className="w-20 text-center"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => handleMaxHeightChange(1)}
            disabled={currentMaxHeight >= 200}
            aria-label="Increase max height"
          >
            <Plus />
          </Button>
        </div>
      </div>

      {/* Opacity */}
      <div className="space-y-1.5">
        <Label htmlFor="logo-opacity">Opacity</Label>
        <div className="flex items-center gap-3">
          <input
            id="logo-opacity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={currentOpacity}
            onChange={handleOpacityChange}
            className="flex-1 accent-primary"
          />
          <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
            {opacityPercent}%
          </span>
          {/* Opacity preview swatch */}
          <div
            className="h-5 w-5 rounded border border-border bg-primary shrink-0"
            style={{ opacity: currentOpacity }}
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
