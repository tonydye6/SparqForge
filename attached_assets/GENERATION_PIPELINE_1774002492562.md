# SparqForge™ — Generation Pipeline Specification

**Version:** 1.0
**Date:** March 20, 2026
**Status:** Implementation-Ready

---

## 1. Pipeline Overview

```
User Inputs → Context Assembly → Parallel API Calls → Compositing → Results
```

The pipeline transforms user selections (template + assets + brief) into multi-platform social media content by orchestrating multiple AI models and a server-side compositing layer. The context assembly layer is deterministic application code — not AI. It builds prompt packages from database configuration.

---

## 2. Context Assembly Algorithm

### Step-by-Step Data Flow

```
FUNCTION assembleContext(inputs):

  ── STEP 1: Load brand DNA ──
  brand = db.Brand.findById(inputs.brandId)
  // Returns: colors, voice, banned terms, trademarks, hashtag strategy,
  //          imagen prefix, negative prompt, platform rules, logo URL, fonts

  ── STEP 2: Load template ──
  template = db.Template.findById(inputs.templateId)
  // Returns: imagen prompt addition, negative addition, claude caption
  //          instructions (per platform), headline instruction, layout spec,
  //          target aspect ratios, recommended asset types

  ── STEP 3: Load selected assets ──
  primaryAsset = db.Asset.findById(inputs.selectedAssets.primary)
  supportingAssets = db.Asset.findByIds(inputs.selectedAssets.supporting)
  // Load file buffers from storage for base64 encoding

  ── STEP 4: Load brief/context cards ──
  briefTexts = []
  IF inputs.selectedContextIds:
    contextCards = db.Asset.findByIds(inputs.selectedContextIds, type="context")
    briefTexts.push(...contextCards.map(c => c.content))
  IF inputs.customBriefText:
    briefTexts.push(inputs.customBriefText)
  combinedBrief = briefTexts.join("\n\n")

  ── STEP 5: Load hashtag sets ──
  hashtagSets = db.HashtagSet.findByIds(inputs.selectedHashtagSets)
  // Format: { "Ohio State Buckeyes": ["GoBuckeyes", "OhioState", "OSU"],
  //           "Crown U Launch": ["CrownU", "CollegeSports", "MobileGaming"] }

  ── STEP 6: Reference analysis (already completed if URL was provided) ──
  referenceAnalysis = campaign.referenceAnalysis  // JSON or null
  referenceScreenshots = campaign.referenceScreenshots  // URLs or null

  RETURN { brand, template, primaryAsset, supportingAssets,
           combinedBrief, hashtagSets, referenceAnalysis, referenceScreenshots }
```

### Data Sources Map

| Context Element | Database Table | Field(s) |
|----------------|---------------|----------|
| Voice & tone system prompt | Brand | voiceDescription, bannedTerms, trademarkRules |
| Hashtag rules | Brand | hashtagStrategy |
| Platform char limits | Brand | platformRules |
| Image style prefix | Brand | imagenPrefix |
| Image exclusions | Brand | negativePrompt |
| Logo for compositing | Brand | logoFileUrl |
| Brand fonts | Brand | brandFonts |
| Template image prompt | Template | imagenPromptAddition |
| Template negative prompt | Template | imagenNegativeAddition |
| Caption instructions | Template | claudeCaptionInstruction (JSON, per-platform) |
| Headline instruction | Template | claudeHeadlineInstruction |
| Layout spec | Template | layoutSpec (JSON) |
| Target aspect ratios | Template | targetAspectRatios |
| Visual references | Asset | fileUrl (primary + supporting) |
| Brief text | Asset (context) / inline | content / customBriefText |
| Available hashtags | HashtagSet | hashtags, category |
| Reference URL insights | Campaign | referenceAnalysis |

---

## 3. Prompt Templates

### 3.1 Claude — Caption + Headline Generation

**System Prompt (assembled from Brand DNA):**
```
You are generating social media captions and headline overlay text for {brand.name}, a product by Sparq Games.

VOICE: {brand.voiceDescription}

NEVER USE THESE WORDS/PHRASES: {brand.bannedTerms.join(", ")}

TRADEMARK RULES:
{brand.trademarkRules}

HASHTAG STRATEGY:
{FOR EACH platform IN brand.hashtagStrategy:}
- {platform}: Always include {defaults.join(", ")}. Maximum {max_count} hashtags total. {platform-specific format notes}

PLATFORM CHARACTER LIMITS:
{FOR EACH platform IN brand.platformRules:}
- {platform}: {char_limit} characters maximum, including hashtags

AVAILABLE HASHTAG SETS (choose from these rather than inventing hashtags):
{FOR EACH set IN hashtagSets:}
- {set.name} ({set.category}): #{set.hashtags.join(" #")}
```

**User Message:**
```
{template.claudeCaptionInstruction[platform]} (NOTE: this is included once, with all platforms specified)

{IF template.claudeHeadlineInstruction:}
HEADLINE OVERLAY TEXT INSTRUCTION:
{template.claudeHeadlineInstruction}

ADDITIONAL CONTEXT:
{combinedBrief}

{IF referenceAnalysis:}
REFERENCE TONE: The user provided a reference URL with the following tonal qualities. Incorporate these influences into the caption style:
Content tone: {referenceAnalysis.content_tone}
Sparq application notes: {referenceAnalysis.sparq_application}

[IMAGE: {primaryAsset as base64}]

Generate captions AND headline overlay text for the following platforms: Instagram feed, Instagram story, Twitter/X, LinkedIn.

Return ONLY valid JSON in this exact format:
{
  "instagram_feed": { "caption": "...", "headline": "..." },
  "instagram_story": { "caption": "...", "headline": "..." },
  "twitter": { "caption": "...", "headline": "..." },
  "linkedin": { "caption": "...", "headline": "..." }
}

Each headline should be different per platform if the layout/format demands it (e.g., shorter for Story).
Captions must respect each platform's character limit.
Select hashtags from the provided sets — do not invent new ones unless no relevant set exists.
```

**API Parameters:**
- Model: `claude-sonnet-4-20250514`
- Max tokens: 2048
- Temperature: 0.7

### 3.2 Imagen 4 Ultra — Image Generation

**Prompt (per aspect ratio, assembled by concatenation):**
```
{brand.imagenPrefix}

{template.imagenPromptAddition}

{combinedBrief}

{IF referenceAnalysis:}
REFERENCE INSPIRATION: The following visual direction is drawn from a reference URL. Incorporate these influences while maintaining the brand DNA above:
Visual mood: {referenceAnalysis.visual_mood}
Color approach: {referenceAnalysis.color_strategy.color_usage}
Composition techniques: {referenceAnalysis.composition_techniques.join(". ")}
```

**Negative Prompt (assembled by concatenation):**
```
{brand.negativePrompt}, {template.imagenNegativeAddition}, no text baked into image, no words or letters in the image, no watermarks
```

**API Parameters (per call):**
- Model: `imagen-4-ultra`
- Aspect ratio: one of `1:1`, `3:4`, `9:16`, `16:9`, `4:3` (map from template targets to API-supported values)
- Number of images: 1
- Output format: PNG
- Reference images: [primaryAsset, ...supportingAssets] as base64
- If reference URL: also include referenceScreenshots as additional reference images

**Aspect Ratio Mapping:**
| Template Target | Imagen API Value | Platform | Output Dimensions |
|----------------|-----------------|----------|-------------------|
| 1:1 | 1:1 | Instagram Feed | 1080 × 1080 |
| 4:5 | 3:4 (closest) | Instagram Feed alt | 1080 × 1350 |
| 9:16 | 9:16 | Instagram Story | 1080 × 1920 |
| 16:9 | 16:9 | Twitter | 1200 × 675 |
| 1.91:1 | 16:9 (closest) | LinkedIn | 1200 × 628 |

> **⚠️ Decision Flag:** The 1.91:1 ratio for LinkedIn may not be natively supported by Imagen. If not, generate at 16:9 and crop/letterbox to 1.91:1 in the compositing step. Test during Phase 2 implementation.

### 3.3 Veo 3.1 Generate — Video Generation

**Prompt:**
```
{brand.imagenPrefix adapted for video — replace "social media graphic" with "social media video clip"}

{template.imagenPromptAddition adapted for motion — add "with dynamic camera movement" or similar}

{combinedBrief}

Create an 8-second cinematic video clip. Smooth camera movement. High production value. The video should feel like a premium social media teaser.
```

**API Parameters:**
- Model: `veo-3.1-generate` (Standard) or `veo-3.1-fast-generate` (Fast, cheaper)
- Aspect ratios: `16:9` (landscape) and `9:16` (portrait) — 2 separate calls
- Reference images: [primaryAsset] (up to 3)
- Number of videos: 1 per call
- Resolution: 1080p

**Execution:** Video generation runs AFTER all image variants are complete (or in parallel if the user opted into video upfront). Video is significantly slower (15-60s), so UI shows a progress indicator.

### 3.4 Gemini 3.1 Flash — Reference URL Analysis

**Prompt:**
```
You are a creative director at a gaming company analyzing a reference webpage for visual and tonal inspiration. Your analysis will guide AI image generation and copywriting for social media assets.

Analyze the attached screenshot(s) of a webpage and produce a JSON creative direction brief with the following fields:

{
  "visual_mood": "2-3 sentence description of the overall aesthetic — energy level, darkness/lightness, sophistication level, emotional tone",
  "color_strategy": {
    "dominant_colors": ["list of hex values or descriptive colors observed"],
    "color_usage": "how colors are deployed — gradients, solid blocks, accents, overlays",
    "contrast_approach": "high contrast / low contrast / mixed, and how it creates visual hierarchy"
  },
  "typography_feel": "describe the font styles and hierarchy — condensed/extended, serif/sans-serif, weight usage, how text relates to imagery",
  "layout_patterns": "compositional structure — grid vs. freeform, use of whitespace, image-to-text ratio, section rhythms",
  "composition_techniques": ["list of specific visual techniques worth emulating"],
  "content_tone": "the copywriting/messaging approach — formal vs. casual, hype vs. understated, question-based vs. declarative",
  "sparq_application": "2-3 sentences on how these elements could specifically enhance Sparq Games social media content, translated through Sparq's brand rather than copied directly"
}

Be specific and actionable. Don't describe what the page IS — describe what visual and tonal qualities should INFLUENCE the assets being generated.
```

**API Parameters:**
- Model: `gemini-3.1-flash`
- Temperature: 0.2
- Response MIME type: `application/json`
- Media resolution: `media_resolution_high` (1120 tokens per image)
- Input: all screenshot segments as inline_data parts

### 3.5 ElevenLabs — Music Generation

**Prompt:** User-provided text prompt. Examples:
- "8-second high-energy esports intro track, electronic, building tension, bass drop at 5 seconds"
- "Ambient college game day atmosphere, crowd cheering, brass instruments, 8 seconds"

**API Call:**
```
POST https://api.elevenlabs.io/v1/text-to-music
{
  "prompt": "{user-provided prompt}",
  "mode": "quality",
  "duration_seconds": {video duration, typically 8}
}
```

### 3.6 ElevenLabs — Sound Effects

**Prompt:** User-provided text prompt. Examples:
- "cinematic whoosh transition with deep bass impact"
- "crowd roar erupting, stadium atmosphere, 3 seconds"

**API Call:**
```
POST https://api.elevenlabs.io/v1/sound-generation
{
  "text": "{user-provided prompt}",
  "duration_seconds": {optional, specified duration}
}
```

---

## 4. Parallel Execution Strategy

### Execution Timeline

```
T+0.0s  ── User hits Generate ──
        │
        ├─ Duplicate check (database query, <100ms)
        │
        ├─ Context assembly (database reads, <200ms)
        │
T+0.2s  ── API calls fire ──
        │
        ├─── Claude (captions + headlines) ──────── returns T+1.5s
        │
        ├─── Imagen (1:1) ─────────────────────── returns T+2.7s
        ├─── Imagen (4:5) ─────────────────────── returns T+2.9s
        ├─── Imagen (9:16) ────────────────────── returns T+3.1s
        ├─── Imagen (16:9) ────────────────────── returns T+2.5s
        ├─── Imagen (1.91:1) ──────────────────── returns T+3.0s
        │    ↓ (each triggers compositing on return, <500ms each)
        │
T+3.5s  ── All images composited, captions populated ──
        │
        ├─── [IF video] Veo landscape (16:9) ──── returns T+30-45s
        ├─── [IF video] Veo portrait (9:16) ───── returns T+45-75s
        │    ↓ (after video, if custom audio requested)
        │
        └─── [IF custom audio] ElevenLabs ─────── returns T+5-10s after video
             ↓
             ffmpeg merge (<2s)
```

### What Runs in Parallel

| Parallel Group | Calls | Dependencies |
|---------------|-------|-------------|
| Group 1 (fire immediately) | Claude + all Imagen calls | None — all fire at T+0.2s after context assembly |
| Group 2 (after each Imagen) | Compositing per variant | Requires: that variant's Imagen result + Claude headlines |
| Group 3 (after all images) | Veo landscape + portrait | Can start earlier, but UI shows after images for UX |
| Group 4 (after Veo) | ElevenLabs + ffmpeg merge | Requires: Veo video file for duration matching |

### What Must Be Sequential

1. **Reference URL analysis** must complete BEFORE generation starts (its output feeds prompts)
2. **Compositing** must wait for BOTH the Imagen raw image AND the Claude headline text
3. **ffmpeg merge** must wait for BOTH the Veo video AND the ElevenLabs audio
4. **Duplicate check** runs before generation starts but is non-blocking (warning only)

---

## 5. Compositing Pipeline — Detailed Implementation

### Input → Output

```
INPUT:
  rawImageBuffer: Buffer     ← Imagen output (PNG, no text)
  layoutSpec: JSON           ← From template
  headlineText: string       ← From Claude (per-platform)
  logoBuffer: Buffer | null  ← From brand settings
  brandFonts: FontConfig[]   ← From brand settings (uploaded fonts)
  aspectRatio: string        ← Target ratio (determines which overrides apply)

OUTPUT:
  compositedImageBuffer: Buffer  ← Final PNG with overlays
```

### Compositing Steps (in order)

**Step 1: Resolve Layout Spec for Aspect Ratio**
```typescript
function resolveLayout(layoutSpec: LayoutSpec, aspectRatio: string) {
  const overrides = layoutSpec.aspect_ratio_overrides?.[aspectRatio];
  return {
    headlineZone: { ...layoutSpec.headline_zone, ...overrides?.headline_zone },
    logoPlacement: { ...layoutSpec.logo_placement, ...overrides?.logo_placement },
    gradientOverlay: { ...layoutSpec.gradient_overlay, ...overrides?.gradient_overlay },
  };
}
```

**Step 2: Load and Size Raw Image**
```typescript
// Resize Imagen output to target dimensions for the platform
const targetDimensions = {
  "1:1":    { width: 1080, height: 1080 },
  "4:5":    { width: 1080, height: 1350 },
  "9:16":   { width: 1080, height: 1920 },
  "16:9":   { width: 1200, height: 675 },
  "1.91:1": { width: 1200, height: 628 },
};
const { width, height } = targetDimensions[aspectRatio];
const resized = await sharp(rawImageBuffer).resize(width, height, { fit: 'cover' }).toBuffer();
```

**Step 3: Create Canvas and Draw Base Image**
```typescript
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');
const baseImg = await loadImage(resized);
ctx.drawImage(baseImg, 0, 0, width, height);
```

**Step 4: Apply Gradient Overlay**
```typescript
function applyGradient(ctx, width, height, gradient) {
  const gradientHeight = Math.round(height * gradient.height_percent / 100);
  const yStart = gradient.direction === 'bottom_to_top'
    ? height - gradientHeight : 0;
  const yEnd = gradient.direction === 'bottom_to_top'
    ? height : gradientHeight;

  const grad = ctx.createLinearGradient(0, yStart, 0, yEnd);
  const color = gradient.color; // e.g., "#000000"
  grad.addColorStop(0, `${color}00`);  // transparent at top
  grad.addColorStop(1, hexToRgba(color, gradient.start_opacity));  // opaque at bottom

  ctx.fillStyle = grad;
  ctx.fillRect(0, yStart, width, gradientHeight);
}
```

**Step 5: Render Headline Text**
```typescript
function renderHeadline(ctx, width, height, text, zone) {
  // Load font (must be registered with registerFont before this call)
  const fontSize = zone.font_size_px;
  ctx.font = `${zone.font_weight} ${fontSize}px "${zone.font_family}"`;
  ctx.fillStyle = zone.color;
  ctx.textAlign = zone.alignment;

  // Calculate position
  const maxWidth = width * zone.max_width_percent / 100;
  const padding = zone.padding_px;

  let x, y;
  switch (zone.position) {
    case 'lower_third':
      x = zone.alignment === 'left' ? padding : width / 2;
      y = height - (height * 0.15) - padding;  // 15% from bottom
      break;
    case 'center_bottom':
      x = width / 2;
      y = height - (height * 0.20) - padding;
      break;
    case 'top_left':
      x = padding;
      y = padding + fontSize;
      break;
    // ... other positions
  }

  // Text shadow for legibility
  if (zone.text_shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  // Word wrap to max_lines
  const lines = wrapText(ctx, text, maxWidth, zone.max_lines);
  const lineHeight = fontSize * 1.15;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + (i * lineHeight));
  }

  // Reset shadow
  ctx.shadowColor = 'transparent';
}
```

**Step 6: Place Logo**
```typescript
async function placeLogo(ctx, width, height, logoBuffer, placement) {
  const logo = await loadImage(logoBuffer);
  const scale = placement.max_height_px / logo.height;
  const logoWidth = logo.width * scale;
  const logoHeight = placement.max_height_px;

  let x, y;
  switch (placement.position) {
    case 'bottom_right':
      x = width - logoWidth - placement.offset_px;
      y = height - logoHeight - placement.offset_px;
      break;
    case 'bottom_left':
      x = placement.offset_px;
      y = height - logoHeight - placement.offset_px;
      break;
    case 'top_right':
      x = width - logoWidth - placement.offset_px;
      y = placement.offset_px;
      break;
    // ... other positions
  }

  ctx.globalAlpha = placement.opacity;
  ctx.drawImage(logo, x, y, logoWidth, logoHeight);
  ctx.globalAlpha = 1.0;
}
```

**Step 7: Export**
```typescript
const compositedBuffer = canvas.toBuffer('image/png');
// Store both raw and composited
await storage.upload(`campaigns/${campaignId}/${variantId}/raw.png`, rawImageBuffer, 'image/png');
await storage.upload(`campaigns/${campaignId}/${variantId}/composited.png`, compositedBuffer, 'image/png');
```

### Recomposite (Headline Edit — No Imagen Call)

When a user edits headline text on a variant card:
1. Load the EXISTING raw image from storage (no Imagen API call)
2. Run the compositing pipeline with the NEW headline text
3. Store the new composited image, replacing the old one
4. Return the new composited image URL to the client
5. Total time: <500ms

---

## 6. Audio Pipeline

### Audio Source Decision Tree

```
User selects audio source on video variant card:
│
├─ "Auto (Veo native)" ──→ Do nothing. Video already has Veo's audio.
│
├─ "Generate Music" ──→ Show prompt input
│   └─ User types prompt + clicks Generate
│       └─ POST /api/audio/generate-music
│           └─ ElevenLabs text-to-music API
│               └─ Store audio file
│                   └─ ffmpeg merge (replace mode)
│                       └─ Store merged video, update variant
│
├─ "Generate SFX" ──→ Show prompt input
│   └─ User types prompt + clicks Generate
│       └─ POST /api/audio/generate-sfx
│           └─ ElevenLabs sound-generation API
│               └─ Store audio file
│                   └─ ffmpeg merge (replace mode)
│                       └─ Store merged video, update variant
│
├─ "Upload Audio" ──→ File picker opens
│   └─ User selects MP3/WAV
│       └─ POST /api/audio/upload
│           └─ Store audio file
│               └─ ffmpeg merge (replace mode)
│                   └─ Store merged video, update variant
│
└─ "Muted" ──→ ffmpeg strip audio
    └─ Store muted video, update variant
```

### ffmpeg Commands Reference

```bash
# Replace Veo audio with ElevenLabs/uploaded track
ffmpeg -i input_video.mp4 -i audio_track.mp3 \
  -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 \
  -shortest -y output.mp4

# Mix both audio tracks (Veo native + ElevenLabs)
ffmpeg -i input_video.mp4 -i audio_track.mp3 \
  -filter_complex "[0:a]volume=0.3[va];[1:a]volume=1.0[ma];[va][ma]amix=inputs=2:duration=first[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac \
  -y output.mp4

# Mute (strip all audio)
ffmpeg -i input_video.mp4 -an -c:v copy -y output.mp4
```

---

## 7. Error Handling & Retry Logic

### Per-Model Retry Strategy

```typescript
async function callWithRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; baseDelayMs: number; service: string }
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
      if (attempt < options.maxRetries) {
        const delay = options.baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
        logRetry(options.service, attempt + 1, error);
      }
    }
  }
  throw lastError!;
}

function isRetryable(error: any): boolean {
  const status = error.status || error.statusCode;
  return status === 429 || status === 500 || status === 502 || status === 503;
}
```

| Model | Max Retries | Base Delay | Timeout | Special Handling |
|-------|------------|------------|---------|-----------------|
| Claude | 3 | 1000ms | 30s | Content filter → simplify prompt, retry once |
| Imagen | 3 | 1000ms | 15s | Safety filter → log and show user message, no retry |
| Veo | 2 | 5000ms | 120s | Long timeout. Poll for completion. |
| Gemini Flash | 3 | 500ms | 15s | Fast, rarely fails |
| ElevenLabs | 2 | 2000ms | 30s | Credit limit → no retry, show message |
| ScreenshotOne | 2 | 2000ms | 30s | URL unreachable → offer manual upload |

---

## 8. Inline Refinement Flow

### Single Variant Refinement

```
User types refinement instruction on variant card → presses Enter
│
├─ Build modified prompt:
│   originalPrompt = [brand prefix] + [template addition] + [brief] + [reference]
│   refinedPrompt = originalPrompt + "\n\nADDITIONAL INSTRUCTION: " + refinementText
│
├─ Call Imagen with refinedPrompt for that variant's aspect ratio only
│
├─ On Imagen return: run compositing with existing headline text
│
├─ Update variant: rawImageUrl, compositedImageUrl
│
├─ Log to RefinementLog: { editType: "image_refinement", refinementPrompt, templateId }
│
└─ UI: show spinner on that card only, other cards unchanged
```

### Refine All

Same as single variant, but fires Imagen calls for ALL aspect ratios in parallel with the same refinement appended. Each composites independently as it returns.

---

## 9. Caption Rewrite Flow

```
User highlights text in caption → clicks "Rewrite" → types instruction
│
├─ Build rewrite prompt:
│   System: brand DNA voice/rules (same as generation)
│   User: "Rewrite the following text passage to be {instruction}.
│          Original passage: '{highlighted text}'
│          Full caption context: '{full caption}'
│          Return ONLY the rewritten passage, nothing else."
│
├─ Call Claude (temperature 0.7, max_tokens 512)
│
├─ Replace highlighted text with Claude's response
│
├─ Log to RefinementLog: { editType: "caption_edit", originalValue, newValue }
│
└─ UI: highlighted text updates in place with subtle flash animation
```

---

## 10. Hashtag Library Integration

During context assembly for Claude, hashtag sets are formatted and injected:

```
AVAILABLE HASHTAG SETS FOR {brand.name}:

School-Specific:
- "Ohio State Buckeyes": #GoBuckeyes #OhioState #OSU #Buckeyes
- "Michigan Wolverines": #GoBlue #Michigan #Wolverines

Campaign:
- "Crown U Launch": #CrownU #CollegeSports #MobileGaming #CrownYourSchool

Evergreen:
- "Sparq Corporate": #SparqGames #Gaming #IndieGames

SELECT hashtags from these sets. Do not invent new hashtags unless no relevant set exists for this specific content. Prioritize the school-specific set if a specific school is featured.
```

Claude receives this as part of the system prompt. The hashtag strategy in brand DNA tells Claude HOW MANY to use per platform; the library tells it WHICH ONES to choose from.

---

## 11. Reference URL Pipeline — End to End

```
T+0s   User pastes URL into Campaign Studio
       │
T+0.1s UI: input disabled, spinner, "Capturing page..."
       │
T+0.2s POST /api/reference/analyze { url: "..." }
       │
T+0.5s Server calls ScreenshotOne API:
       │ GET https://api.screenshotone.com/take?url=...&full_page=true&viewport_width=1440
       │
T+2-3s ScreenshotOne returns PNG(s)
       │ Store in campaign storage: reference/screenshot_1.png, screenshot_2.png, etc.
       │
T+3s   UI: thumbnail appears, "Analyzing reference..."
       │
T+3.1s Server sends screenshots to Gemini 3.1 Flash:
       │ POST gemini-3.1-flash:generateContent with all screenshots + analysis prompt
       │
T+4-5s Flash returns structured JSON analysis
       │ Store in campaign.referenceAnalysis
       │
T+5s   UI: thumbnail + "Analyzed ✓" green badge
       │
       │ ── User can now hit Generate ──
       │
       │ Context assembly injects:
       │   → Into Imagen prompts: visual mood, color strategy, composition techniques
       │   → Into Imagen reference images: screenshots passed alongside library assets
       │   → Into Claude prompts: content tone, sparq_application notes
```

---

## 12. Duplicate Detection Query

```sql
SELECT c.id, c.name, c.created_at, t.name as template_name
FROM campaigns c
JOIN templates t ON c.template_id = t.id
WHERE c.template_id = :currentTemplateId
  AND c.selected_assets::jsonb @> '[{"role": "primary", "assetId": ":primaryAssetId"}]'
  AND c.created_at > NOW() - INTERVAL '30 days'
  AND c.id != :currentCampaignId
  AND c.status NOT IN ('rejected', 'draft')
ORDER BY c.created_at DESC
LIMIT 1;
```

In Prisma:
```typescript
const duplicate = await prisma.campaign.findFirst({
  where: {
    templateId: currentTemplateId,
    selectedAssets: { path: '$[0].assetId', equals: primaryAssetId },
    createdAt: { gte: thirtyDaysAgo },
    id: { not: currentCampaignId },
    status: { notIn: ['rejected', 'draft'] },
  },
  include: { template: { select: { name: true } } },
  orderBy: { createdAt: 'desc' },
});
```

> **Note:** The `selectedAssets` JSON query syntax depends on Prisma's JSON filtering capabilities with PostgreSQL. If the path-based query doesn't work cleanly, use a raw query or store the primary asset ID as a separate indexed column on Campaign for efficient lookups.

---

## 13. Cost Logging

Every API call logs to the CostLog table:

```typescript
async function logCost(campaignId: string, service: string, operation: string, model: string, costUsd: number, metadata?: any) {
  await prisma.costLog.create({
    data: { campaignId, service, operation, model, costUsd, metadata },
  });
}

// Cost constants
const COSTS = {
  claude_caption: 0.02,     // estimated per call
  imagen_ultra: 0.06,       // per image
  imagen_standard: 0.04,
  veo_standard_per_sec: 0.40,
  veo_fast_per_sec: 0.15,
  elevenlabs_music: 0.12,   // estimated per generation
  elevenlabs_sfx: 0.08,
  gemini_flash: 0.001,
  screenshotone: 0.01,
};
```

Campaign cost estimate displayed in real-time:
```
Typical image campaign: 1 Claude call ($0.02) + 5 Imagen calls ($0.30) + 1 Flash ($0.001) = ~$0.32
With video: + 2 Veo calls ($2.40-$6.40) = ~$2.72-$6.72
With ElevenLabs: + 1 music gen ($0.12) = ~$2.84-$6.84
```
