import {
  LayoutSpec,
  LAYOUT_DEFAULTS,
  ASPECT_RATIO_DIMENSIONS,
  HeadlineZone,
  LogoPlacement,
  GradientOverlay,
} from "./layout-editor.types";

interface LayoutPreviewCanvasProps {
  spec: LayoutSpec;
  aspectRatio: string; // "1:1", "16:9", "9:16", etc.
  brandLogoUrl?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace(/^#/, "");
  const fullHex =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  const num = parseInt(fullHex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Merge spec fields with defaults and per-aspect-ratio overrides.
 */
function resolveEffectiveSpec(
  spec: LayoutSpec,
  aspectRatio: string,
): {
  headline_zone: Required<HeadlineZone>;
  logo_placement: Required<LogoPlacement>;
  gradient_overlay: Required<GradientOverlay>;
} {
  const overrides = spec.aspect_ratio_overrides?.[aspectRatio];
  return {
    headline_zone: {
      ...LAYOUT_DEFAULTS.headline_zone,
      ...spec.headline_zone,
      ...overrides?.headline_zone,
    } as Required<HeadlineZone>,
    logo_placement: {
      ...LAYOUT_DEFAULTS.logo_placement,
      ...spec.logo_placement,
      ...overrides?.logo_placement,
    } as Required<LogoPlacement>,
    gradient_overlay: {
      ...LAYOUT_DEFAULTS.gradient_overlay,
      ...spec.gradient_overlay,
      ...overrides?.gradient_overlay,
    } as Required<GradientOverlay>,
  };
}

/* ------------------------------------------------------------------ */
/*  Sub-layers                                                        */
/* ------------------------------------------------------------------ */

const GRID_BG = `repeating-linear-gradient(
  0deg,
  rgba(255,255,255,0.03) 0px,
  rgba(255,255,255,0.03) 1px,
  transparent 1px,
  transparent 40px
),
repeating-linear-gradient(
  90deg,
  rgba(255,255,255,0.03) 0px,
  rgba(255,255,255,0.03) 1px,
  transparent 1px,
  transparent 40px
)`;

function BackgroundLayer() {
  return (
    <div
      className="absolute inset-0 bg-gradient-to-br from-[#1A1A28] to-[#2A2A3A]"
      style={{ backgroundImage: GRID_BG }}
    />
  );
}

function GradientOverlayLayer({
  gradient,
}: {
  gradient: Required<GradientOverlay>;
}) {
  const { direction, color, start_opacity, end_opacity, height_percent } =
    gradient;
  const { r, g, b } = hexToRgb(color);

  const isBottomToTop = direction === "bottom_to_top";
  const cssDirection = isBottomToTop ? "to top" : "to bottom";

  const positionStyle: React.CSSProperties = isBottomToTop
    ? { bottom: 0, left: 0, right: 0 }
    : { top: 0, left: 0, right: 0 };

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        ...positionStyle,
        height: `${height_percent}%`,
        background: `linear-gradient(${cssDirection}, rgba(${r},${g},${b},${start_opacity}), rgba(${r},${g},${b},${end_opacity}))`,
      }}
    />
  );
}

function HeadlineZoneLayer({
  zone,
  targetWidth,
}: {
  zone: Required<HeadlineZone>;
  targetWidth: number;
}) {
  const { position, alignment, max_width_percent, padding_px, font_size_px, color } = zone;

  // Scale factor: spec pixels -> percentage of container width
  const scaledPaddingPct = (padding_px / targetWidth) * 100;
  const scaledFontPct = (font_size_px / targetWidth) * 100;

  // Position the zone
  let zoneStyle: React.CSSProperties = {
    left: 0,
    right: 0,
    position: "absolute",
    border: "2px dashed rgba(59, 130, 246, 0.4)",
    backgroundColor: "rgba(59, 130, 246, 0.05)",
  };

  let innerAlignItems = "flex-start";

  if (position === "upper_third") {
    zoneStyle = { ...zoneStyle, top: 0, height: "33.33%" };
  } else if (position === "center") {
    zoneStyle = { ...zoneStyle, top: "33.33%", height: "33.34%" };
    innerAlignItems = "center";
  } else {
    // lower_third
    zoneStyle = { ...zoneStyle, bottom: 0, height: "33.33%" };
    innerAlignItems = "flex-end";
  }

  // Map alignment to CSS
  const textAlign = alignment as React.CSSProperties["textAlign"];
  const justifyContent =
    alignment === "left"
      ? "flex-start"
      : alignment === "right"
        ? "flex-end"
        : "center";

  return (
    <div style={zoneStyle}>
      {/* Zone label */}
      <span className="absolute top-1 left-1.5 text-[10px] leading-none text-blue-400/60 select-none">
        Headline
      </span>

      {/* Inner flex container for vertical + horizontal alignment */}
      <div
        className="flex h-full w-full"
        style={{
          alignItems: innerAlignItems,
          justifyContent,
          padding: `${scaledPaddingPct}%`,
        }}
      >
        <span
          className="font-bold leading-tight select-none"
          style={{
            textAlign,
            maxWidth: `${max_width_percent}%`,
            fontSize: `clamp(8px, ${scaledFontPct}cqi, 64px)`,
            color,
            display: "block",
          }}
        >
          HEADLINE TEXT
        </span>
      </div>
    </div>
  );
}

function LogoLayer({
  logo,
  targetWidth,
  brandLogoUrl,
}: {
  logo: Required<LogoPlacement>;
  targetWidth: number;
  brandLogoUrl?: string | null;
}) {
  const { position, offset_px, max_height_px, opacity } = logo;

  const offsetPct = `${(offset_px / targetWidth) * 100}%`;
  const maxHeightPct = `${(max_height_px / targetWidth) * 100}%`;

  // Compute corner positioning
  const posStyle: React.CSSProperties = { position: "absolute" };
  if (position.startsWith("top")) posStyle.top = offsetPct;
  else posStyle.bottom = offsetPct;
  if (position.endsWith("left")) posStyle.left = offsetPct;
  else posStyle.right = offsetPct;

  return (
    <div
      style={{
        ...posStyle,
        border: "1px dashed rgba(59, 130, 246, 0.3)",
        padding: "4px",
      }}
    >
      {/* Logo label */}
      <span
        className="absolute text-[10px] leading-none text-blue-400/60 select-none"
        style={{ top: -14, left: 0 }}
      >
        Logo
      </span>

      {brandLogoUrl ? (
        <img
          src={brandLogoUrl}
          alt="Brand logo"
          style={{
            maxHeight: maxHeightPct,
            opacity,
            display: "block",
          }}
          // fallback sizing when maxHeight% can't resolve (no explicit container height)
          // use a reasonable clamped pixel value instead
          onError={() => {}}
        />
      ) : (
        <div
          className="bg-white/20 text-white/60 text-[10px] px-2 py-1 rounded select-none whitespace-nowrap"
          style={{ opacity }}
        >
          LOGO
        </div>
      )}
    </div>
  );
}

function DimensionLabel({ width, height }: { width: number; height: number }) {
  return (
    <span className="absolute bottom-1.5 right-2 text-[10px] text-muted-foreground/50 select-none">
      {width} x {height}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export function LayoutPreviewCanvas({
  spec,
  aspectRatio,
  brandLogoUrl,
}: LayoutPreviewCanvasProps) {
  const dims = ASPECT_RATIO_DIMENSIONS[aspectRatio] ?? {
    label: aspectRatio,
    width: 1080,
    height: 1080,
  };
  const targetWidth = dims.width;

  const effective = resolveEffectiveSpec(spec, aspectRatio);

  return (
    <div>
      {/* Canvas container — uses container query for font scaling */}
      <div
        className="relative overflow-hidden rounded-lg border border-border bg-[#1A1A28]"
        style={{
          aspectRatio: `${dims.width}/${dims.height}`,
          containerType: "inline-size",
          width: "100%",
        }}
      >
        {/* 1. Background + grid */}
        <BackgroundLayer />

        {/* 2. Gradient overlay */}
        <GradientOverlayLayer gradient={effective.gradient_overlay} />

        {/* 3. Headline zone */}
        <HeadlineZoneLayer
          zone={effective.headline_zone}
          targetWidth={targetWidth}
        />

        {/* 4. Logo */}
        <LogoLayer
          logo={effective.logo_placement}
          targetWidth={targetWidth}
          brandLogoUrl={brandLogoUrl}
        />

        {/* 5. Dimension label */}
        <DimensionLabel width={dims.width} height={dims.height} />
      </div>

      <p className="text-[11px] text-muted-foreground/50 mt-1 text-center select-none">
        Preview is approximate
      </p>
    </div>
  );
}
