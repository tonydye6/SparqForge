import { LayoutPreset } from "./layout-editor.types";

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: "lower-third-standard",
    name: "Lower Third Standard",
    description: "Headline in lower third, logo bottom-right, gradient from bottom",
    spec: {
      headline_zone: { position: "lower_third", alignment: "left", max_width_percent: 80, padding_px: 24, font_size_px: 48, color: "#FFFFFF", max_lines: 2 },
      logo_placement: { position: "bottom_right", offset_px: 24, max_height_px: 40, opacity: 1 },
      gradient_overlay: { type: "linear", direction: "bottom_to_top", color: "#000000", start_opacity: 0.7, end_opacity: 0, height_percent: 40 },
    },
  },
  {
    id: "centered-bold",
    name: "Centered Bold",
    description: "Large centered headline, no gradient, logo top-right",
    spec: {
      headline_zone: { position: "center", alignment: "center", max_width_percent: 90, padding_px: 32, font_size_px: 72, color: "#FFFFFF", max_lines: 3 },
      logo_placement: { position: "top_right", offset_px: 24, max_height_px: 36, opacity: 0.9 },
      gradient_overlay: { type: "linear", direction: "bottom_to_top", color: "#000000", start_opacity: 0.3, end_opacity: 0, height_percent: 100 },
    },
  },
  {
    id: "minimal-corner-logo",
    name: "Minimal Corner Logo",
    description: "No headline, just logo and subtle gradient",
    spec: {
      logo_placement: { position: "bottom_right", offset_px: 16, max_height_px: 32, opacity: 0.7 },
      gradient_overlay: { type: "linear", direction: "bottom_to_top", color: "#000000", start_opacity: 0.3, end_opacity: 0, height_percent: 20 },
    },
  },
  {
    id: "story-optimized",
    name: "Story Optimized",
    description: "Full-width lower headline for 9:16 formats",
    spec: {
      headline_zone: { position: "lower_third", alignment: "center", max_width_percent: 90, padding_px: 20, font_size_px: 56, color: "#FFFFFF", max_lines: 3 },
      logo_placement: { position: "top_left", offset_px: 20, max_height_px: 32, opacity: 0.9 },
      gradient_overlay: { type: "linear", direction: "bottom_to_top", color: "#000000", start_opacity: 0.8, end_opacity: 0, height_percent: 50 },
    },
  },
  {
    id: "clean-upper",
    name: "Clean Upper",
    description: "Headline in upper third, top-down gradient, logo bottom-left",
    spec: {
      headline_zone: { position: "upper_third", alignment: "left", max_width_percent: 75, padding_px: 24, font_size_px: 44, color: "#FFFFFF", max_lines: 2 },
      logo_placement: { position: "bottom_left", offset_px: 24, max_height_px: 36, opacity: 1 },
      gradient_overlay: { type: "linear", direction: "top_to_bottom", color: "#000000", start_opacity: 0.6, end_opacity: 0, height_percent: 35 },
    },
  },
  {
    id: "sports-score",
    name: "Sports Score",
    description: "Lower third left-aligned, high contrast, heavy gradient",
    spec: {
      headline_zone: { position: "lower_third", alignment: "left", max_width_percent: 70, padding_px: 28, font_size_px: 60, color: "#FFFFFF", max_lines: 2 },
      logo_placement: { position: "top_left", offset_px: 20, max_height_px: 48, opacity: 1 },
      gradient_overlay: { type: "linear", direction: "bottom_to_top", color: "#000000", start_opacity: 0.85, end_opacity: 0, height_percent: 55 },
    },
  },
];
