import { Download, MoreHorizontal, Loader2, ChevronDown, ChevronUp, Wand2, Video, Volume2, VolumeX, Music, Hash, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { TikTokPreviewFrame } from "@/components/ui/tiktok-preview-frame";
import { InstagramFeedPreviewFrame } from "@/components/ui/instagram-feed-preview-frame";
import { InstagramStoryPreviewFrame } from "@/components/ui/instagram-story-preview-frame";
import { TwitterPreviewFrame } from "@/components/ui/twitter-preview-frame";
import { LinkedInPreviewFrame } from "@/components/ui/linkedin-preview-frame";
import { RewriteToolbar } from "@/components/ui/rewrite-toolbar";
import { HeadlineOverlayEditor } from "@/components/ui/headline-editor";
import type { GeneratedVariant, RewriteToolbarState, LoadingPhase } from "./campaign-studio.types";
import { PLATFORM_LABELS, API_BASE } from "./campaign-studio.types";

export interface VariantCardProps {
  variant: GeneratedVariant;
  loadingPhase: LoadingPhase;
  regeneratingVariant: string | null;
  variantRefineOpen: Record<string, boolean>;
  variantRefineText: Record<string, string>;
  rewriteToolbar: RewriteToolbarState | null;
  isGeneratingAudio: boolean;
  onDownloadVariant: (variantId: string | undefined) => void;
  onCaptionChange: (variantId: string | undefined, platform: string, newCaption: string) => void;
  onTextSelect: (platform: string, textarea: HTMLTextAreaElement) => void;
  onRewrite: (text: string, instruction: string) => Promise<string>;
  onHeadlineSave: (variantId: string | undefined, platform: string, newHeadline: string) => Promise<void>;
  onVariantRegenerate: (variantId: string, platform: string) => void;
  extractHashtags: (caption: string) => string[];
  onRewriteToolbarClose: () => void;
  onSetVariantRefineOpen: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  onSetVariantRefineText: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  onOpenAudioDialog: (variant: GeneratedVariant) => void;
  onOpenHashtagDialog: (hashtags: string[]) => void;
}

export function VariantCard({
  variant,
  loadingPhase: loadingPhaseMap,
  regeneratingVariant,
  variantRefineOpen,
  variantRefineText,
  rewriteToolbar,
  isGeneratingAudio,
  onDownloadVariant,
  onCaptionChange,
  onTextSelect,
  onRewrite,
  onHeadlineSave,
  onVariantRegenerate,
  extractHashtags,
  onRewriteToolbarClose,
  onSetVariantRefineOpen,
  onSetVariantRefineText,
  onOpenAudioDialog,
  onOpenHashtagDialog,
}: VariantCardProps) {
  const label = PLATFORM_LABELS[variant.platform] || { name: variant.platform, platformIcon: "twitter", ratio: variant.aspectRatio };
  const imageUrl = variant.compositedImageUrl || variant.rawImageUrl;
  const versionSuffix = variant.imageVersion ? `?v=${variant.imageVersion}` : "";
  const phase = loadingPhaseMap[variant.platform];
  const isLoading = phase && (!phase.caption || !phase.image);
  const hasCaption = phase ? phase.caption : !!variant.caption;
  const hasImage = phase ? phase.image : !!imageUrl;

  const headlineOverlay = variant.headlineText && hasImage ? (
    <HeadlineOverlayEditor
      headline={variant.headlineText}
      disabled={!variant.id}
      onSave={(newHeadline) => onHeadlineSave(variant.id, variant.platform, newHeadline)}
    />
  ) : undefined;

  const renderPreviewFrame = () => {
    const frameImageUrl = hasImage && imageUrl ? `${API_BASE}${imageUrl}${versionSuffix}` : undefined;
    const frameCaption = variant.caption;

    if (variant.platform === "tiktok") {
      return <TikTokPreviewFrame imageUrl={frameImageUrl} caption={frameCaption} overlay={headlineOverlay} />;
    }
    if (variant.platform === "instagram_feed") {
      return <InstagramFeedPreviewFrame imageUrl={frameImageUrl} caption={frameCaption} overlay={headlineOverlay} />;
    }
    if (variant.platform === "instagram_story") {
      return <InstagramStoryPreviewFrame imageUrl={frameImageUrl} caption={frameCaption} overlay={headlineOverlay} />;
    }
    if (variant.platform === "twitter") {
      return <TwitterPreviewFrame imageUrl={frameImageUrl} caption={frameCaption} overlay={headlineOverlay} />;
    }
    if (variant.platform === "linkedin") {
      return <LinkedInPreviewFrame imageUrl={frameImageUrl} caption={frameCaption} overlay={headlineOverlay} />;
    }
    return frameImageUrl ? (
      <img src={frameImageUrl} alt={`${label.name} variant`} className="w-full h-auto object-cover" />
    ) : null;
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg flex flex-col hover:border-border/80 transition-colors">
      <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={label.platformIcon} />
          <span className="font-semibold text-sm">{label.name}</span>
          <span className="text-xs text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">{label.ratio}</span>
          {isLoading && (
            <Loader2 size={12} className="animate-spin text-primary ml-1" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {variant.id && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => onDownloadVariant(variant.id)}>
              <Download size={14} />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <MoreHorizontal size={16} />
          </Button>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-4">
        <div className="flex gap-4">
          <div className="w-[160px] shrink-0 relative">
            {regeneratingVariant === variant.platform && (
              <div className="absolute inset-0 z-10 bg-background/70 flex flex-col items-center justify-center rounded-md">
                <Loader2 size={24} className="animate-spin text-primary" />
                <span className="text-[10px] text-primary mt-1">Regenerating...</span>
              </div>
            )}
            {!hasImage && !imageUrl ? (
              <div className={`w-full rounded-md border border-border/50 overflow-hidden bg-muted/30 relative ${
                variant.platform === "instagram_feed" ? "aspect-square" :
                variant.platform === "instagram_story" || variant.platform === "tiktok" ? "aspect-[9/16]" :
                "aspect-video"
              }`}>
                <div className="w-full h-full bg-muted/50 animate-pulse relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              </div>
            ) : (
              <div className={`${hasImage ? "animate-crossfade-in" : ""}`}>
                {renderPreviewFrame()}
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-2 relative">
            {!hasCaption && isLoading ? (
              <div className="bg-muted/20 border border-border/30 rounded-md px-3 py-2">
                <div className="w-16 h-2 bg-muted/50 rounded animate-pulse mb-1.5" />
                <div className="w-24 h-3 bg-muted/40 rounded animate-pulse" />
              </div>
            ) : null}
            {hasCaption && variant.caption ? (
              <>
                <Textarea
                  className="flex-1 min-h-[80px] resize-none text-sm bg-background border-border p-3 animate-in fade-in duration-500"
                  value={variant.caption}
                  onChange={(e) => onCaptionChange(variant.id, variant.platform, e.target.value)}
                  onMouseUp={(e) => onTextSelect(variant.platform, e.currentTarget)}
                  onKeyUp={(e) => onTextSelect(variant.platform, e.currentTarget)}
                />
                {rewriteToolbar && rewriteToolbar.platform === variant.platform && (
                  <RewriteToolbar
                    selectedText={rewriteToolbar.selectedText}
                    position={rewriteToolbar.position}
                    onRewrite={(instruction) => onRewrite(rewriteToolbar.selectedText, instruction)}
                    onApply={(newText) => {
                      const before = variant.caption.substring(0, rewriteToolbar.selectionStart);
                      const after = variant.caption.substring(rewriteToolbar.selectionEnd);
                      const updated = before + newText + after;
                      onCaptionChange(variant.id, variant.platform, updated);
                    }}
                    onClose={onRewriteToolbarClose}
                  />
                )}
              </>
            ) : (
              <div className="flex-1 min-h-[80px] bg-background border border-border/30 rounded-md p-3 space-y-2">
                <div className="h-2.5 bg-muted/50 rounded w-full animate-pulse relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite_0.1s] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
                <div className="h-2.5 bg-muted/50 rounded w-4/5 animate-pulse relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite_0.2s] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
                <div className="h-2.5 bg-muted/50 rounded w-3/5 animate-pulse relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite_0.3s] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              </div>
            )}
            <div className="flex justify-between items-center px-1">
              <span className="text-[10px] text-muted-foreground">{variant.caption?.length ?? 0} chars</span>
              <div className="flex gap-1">
                {(variant.caption ? extractHashtags(variant.caption) : []).length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-muted-foreground hover:text-primary px-1.5 gap-1"
                    onClick={() => {
                      onOpenHashtagDialog(extractHashtags(variant.caption ?? ""));
                    }}
                  >
                    <Hash size={10} />
                    Save as Hashtag Set
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {variant.videoUrl && (
          <div className="border-t border-border pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Video size={12} className="text-primary" /> Video Preview
              </span>
              <div className="flex items-center gap-1">
                {variant.audioSource && variant.audioSource !== "mute" && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                    <Volume2 size={8} className="mr-0.5" />
                    {variant.audioSource === "elevenlabs_music" ? "Music" : variant.audioSource === "elevenlabs_sfx" ? "SFX" : variant.audioSource === "custom_upload" ? "Custom" : "Native"}
                  </Badge>
                )}
                {variant.audioSource === "mute" && (
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground">
                    <VolumeX size={8} className="mr-0.5" /> Muted
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] text-muted-foreground hover:text-primary px-1.5 gap-1"
                  onClick={() => {
                    onOpenAudioDialog(variant);
                  }}
                  disabled={isGeneratingAudio}
                >
                  <Music size={10} /> Audio
                </Button>
              </div>
            </div>
            <video
              src={`${API_BASE}${variant.mergedVideoUrl || variant.videoUrl}`}
              controls
              className="w-full rounded-md border border-border/50 bg-black"
              style={{ maxHeight: "200px" }}
            />
          </div>
        )}

        {variant.id && (
          <div className="border-t border-border pt-2">
            <button
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
              onClick={() => onSetVariantRefineOpen(prev => ({ ...prev, [variant.platform]: !prev[variant.platform] }))}
            >
              {variantRefineOpen[variant.platform] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              <Wand2 size={11} />
              <span>Refine this variant</span>
            </button>
            {variantRefineOpen[variant.platform] && (
              <div className="mt-2 flex gap-2">
                <Input
                  placeholder="e.g. 'Make it brighter' or 'More dynamic angle'"
                  className="flex-1 h-8 text-xs bg-background border-border"
                  value={variantRefineText[variant.platform] || ""}
                  onChange={(e) => onSetVariantRefineText(prev => ({ ...prev, [variant.platform]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && variant.id) {
                      onVariantRegenerate(variant.id, variant.platform);
                    }
                  }}
                  disabled={regeneratingVariant !== null}
                />
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs bg-primary hover:bg-primary/90"
                  disabled={regeneratingVariant !== null}
                  onClick={() => variant.id && onVariantRegenerate(variant.id, variant.platform)}
                >
                  {regeneratingVariant === variant.platform ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <><Wand2 size={12} className="mr-1" /> Refine</>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
