import { MoreHorizontal, Image as ImageIcon, Sparkles, X, AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { VariantCard } from "./VariantCard";
import type { GeneratedVariant, DuplicateInfo, RewriteToolbarState, LoadingPhase } from "./creative-studio.types";
import { PLATFORM_LABELS } from "./creative-studio.types";

export interface VariantGridProps {
  refineText: string;
  onRefineTextChange: (value: string) => void;
  onRefineSubmit: () => void;
  isGenerating: boolean;
  generatedVariants: GeneratedVariant[];
  selectedBrand: string;
  duplicateInfo: DuplicateInfo | null;
  duplicateDismissed: boolean;
  onDismissDuplicate: () => void;
  loadingPhase: LoadingPhase;
  selectedPlatforms: string[];
  /* VariantCard pass-through props */
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

export function VariantGrid({
  refineText,
  onRefineTextChange,
  onRefineSubmit,
  isGenerating,
  generatedVariants,
  selectedBrand,
  duplicateInfo,
  duplicateDismissed,
  onDismissDuplicate,
  loadingPhase,
  selectedPlatforms,
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
}: VariantGridProps) {
  return (
    <section className="flex-1 flex flex-col min-w-0 relative bg-background/50">
      <div className="h-16 px-6 border-b border-border flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3 ml-auto">
          <Badge variant="outline" className={`border-border ${isGenerating ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : generatedVariants.length > 0 ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-card text-muted-foreground'}`}>
            {isGenerating ? "Generating..." : generatedVariants.length > 0 ? `${generatedVariants.length} Variants` : "Draft Mode"}
          </Badge>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {duplicateInfo?.duplicate && !duplicateDismissed && (
          <div className="max-w-6xl mx-auto mb-6 bg-amber-500/5 border border-amber-500/30 rounded-lg p-4 flex items-start gap-3 border-l-4 border-l-amber-500">
            <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                Similar creative detected
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This looks similar to "{duplicateInfo.creativeName}" from{" "}
                {duplicateInfo.createdAt
                  ? new Date(duplicateInfo.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "recently"}
              </p>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={onDismissDuplicate}
                >
                  Dismiss and Proceed
                </Button>
              </div>
            </div>
            <button onClick={onDismissDuplicate} className="text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl mx-auto pb-12">
          {generatedVariants.length > 0 ? (
            generatedVariants.map((variant) => (
              <VariantCard
                key={variant.platform}
                variant={variant}
                loadingPhase={loadingPhase}
                regeneratingVariant={regeneratingVariant}
                variantRefineOpen={variantRefineOpen}
                variantRefineText={variantRefineText}
                rewriteToolbar={rewriteToolbar}
                isGeneratingAudio={isGeneratingAudio}
                onDownloadVariant={onDownloadVariant}
                onCaptionChange={onCaptionChange}
                onTextSelect={onTextSelect}
                onRewrite={onRewrite}
                onHeadlineSave={onHeadlineSave}
                onVariantRegenerate={onVariantRegenerate}
                extractHashtags={extractHashtags}
                onRewriteToolbarClose={onRewriteToolbarClose}
                onSetVariantRefineOpen={onSetVariantRefineOpen}
                onSetVariantRefineText={onSetVariantRefineText}
                onOpenAudioDialog={onOpenAudioDialog}
                onOpenHashtagDialog={onOpenHashtagDialog}
              />
            ))
          ) : !selectedBrand ? (
            <div className="col-span-full">
              <EmptyState
                icon={Sparkles}
                title="Start a creative"
                description="Select a brand and template to begin"
              />
            </div>
          ) : (
            Object.entries(PLATFORM_LABELS).map(([key, panel]) => (
              <div key={key} className="bg-card border border-border rounded-xl overflow-hidden shadow-lg flex flex-col hover:border-border/80 transition-colors">
                <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={panel.platformIcon} />
                    <span className="font-semibold text-sm">{panel.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">{panel.ratio}</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                    <MoreHorizontal size={16} />
                  </Button>
                </div>

                <div className="p-4 flex-1 flex flex-col gap-4">
                  <div className="flex gap-4">
                    <div className="w-[120px] shrink-0 bg-muted/30 rounded-md border border-border/50 flex flex-col items-center justify-center text-muted-foreground aspect-square">
                      <ImageIcon size={24} className="mb-2 opacity-20" />
                      <span className="text-[10px] font-medium uppercase tracking-wider opacity-50">Placeholder</span>
                    </div>

                    <div className="flex-1 flex flex-col gap-2">
                      <Textarea
                        className="flex-1 min-h-[100px] resize-none text-sm bg-background border-border p-3"
                        placeholder="AI generated caption will appear here..."
                        disabled
                      />
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[10px] text-muted-foreground">0 chars</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
