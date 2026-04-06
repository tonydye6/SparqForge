export interface HeadlineZone {
  position?: "upper_third" | "center" | "lower_third";
  alignment?: "left" | "center" | "right";
  max_width_percent?: number;
  padding_px?: number;
  font_size_px?: number;
  color?: string;
  max_lines?: number;
}

export interface LogoPlacement {
  position?: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  offset_px?: number;
  max_height_px?: number;
  opacity?: number;
}

export interface GradientOverlay {
  type?: "linear";
  direction?: "bottom_to_top" | "top_to_bottom";
  color?: string;
  start_opacity?: number;
  end_opacity?: number;
  height_percent?: number;
}

export interface LayoutSpec {
  headline_zone?: HeadlineZone;
  logo_placement?: LogoPlacement;
  gradient_overlay?: GradientOverlay;
  aspect_ratio_overrides?: Record<string, Partial<LayoutSpec>>;
}

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  spec: LayoutSpec;
}

export const ASPECT_RATIO_DIMENSIONS: Record<string, { label: string; width: number; height: number }> = {
  "1:1": { label: "Square", width: 1080, height: 1080 },
  "16:9": { label: "Landscape", width: 1200, height: 675 },
  "9:16": { label: "Portrait/Story", width: 1080, height: 1920 },
  "4:5": { label: "Portrait", width: 1080, height: 1350 },
  "1.91:1": { label: "LinkedIn", width: 1200, height: 628 },
};

// Compositing defaults (used as placeholders)
export const LAYOUT_DEFAULTS = {
  headline_zone: { position: "lower_third" as const, alignment: "left" as const, max_width_percent: 80, padding_px: 24, font_size_px: 48, color: "#FFFFFF", max_lines: 2 },
  logo_placement: { position: "bottom_right" as const, offset_px: 24, max_height_px: 40, opacity: 1 },
  gradient_overlay: { type: "linear" as const, direction: "bottom_to_top" as const, color: "#000000", start_opacity: 0.7, end_opacity: 0, height_percent: 40 },
};
