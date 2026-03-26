import { Settings2, RefreshCw, Star, Layers, FileText, Image as ImageIcon, Package, Play, Loader2, Video } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ReferenceAnalyzer } from "./ReferenceAnalyzer";
import { BudgetStatus, PLATFORM_LABELS, ALL_PLATFORM_KEYS } from "./creative-studio.types";
import type { Asset } from "@workspace/api-client-react";

export interface CreativeConfigPanelProps {
  /* URL-derived flags */
  remixId: string | null;

  /* Creative name */
  creativeName: string;
  onCreativeNameChange: (name: string) => void;

  /* Brand selector */
  brands: Array<{ id: string; name: string; colorPrimary: string }> | undefined;
  selectedBrand: string;
  onBrandChange: (brandId: string) => void;

  /* Template selector */
  templates: { data?: Array<{ id: string; name: string }> } | undefined;
  selectedTemplate: string;
  onTemplateChange: (templateId: string) => void;

  /* Subject reference assets */
  subjectAssetId: string | null;
  onSubjectAssetChange: (id: string | null) => void;
  recommendedSubjects: Asset[];
  approvedVisualAssets: Asset[];

  /* Style reference assets */
  styleAssetIds: string[];
  onToggleStyleAsset: (id: string) => void;
  recommendedStyles: Asset[];

  /* Context cards */
  contextAssetIds: string[];
  onToggleContextAsset: (id: string) => void;
  briefs: { data?: Asset[] } | undefined;

  /* Compositing assets */
  compositingAssets: Asset[];

  /* Generation packet preview */
  packetPreviewOpen: boolean;
  onPacketPreviewToggle: () => void;
  approvedAssets: { data?: Asset[] } | undefined;

  /* Reference analyzer props */
  referenceUrl: string;
  onReferenceUrlChange: (url: string) => void;
  referenceStatus: "idle" | "capturing" | "analyzing" | "done" | "error";
  referenceError: string;
  referenceAnalysis: Record<string, string> | null;
  referenceScreenshots: Array<{ url: string; viewport: string }>;
  onAnalyzeUrl: () => void;
  onUploadScreenshot: (file: File) => void;
  onClearReference: () => void;

  /* Context brief */
  briefText: string;
  onBriefTextChange: (text: string) => void;
  onBriefSelect: (briefId: string) => void;

  /* Platforms */
  selectedPlatforms: string[];
  onSelectedPlatformsChange: (platforms: string[]) => void;

  /* Generate actions */
  onGenerate: () => void;
  onGenerateVideo: () => void;
  isGenerating: boolean;
  isGeneratingVideo: boolean;
  generateDisabledReason: string | null;

  /* Budget / cost */
  budgetStatus: BudgetStatus | null;
  estimatedCost: number;

  /* Video button dependencies */
  creativeId: string | null;
  hasVariants: boolean;
}

export function CreativeConfigPanel({
  remixId,
  creativeName,
  onCreativeNameChange,
  brands,
  selectedBrand,
  onBrandChange,
  templates,
  selectedTemplate,
  onTemplateChange,
  subjectAssetId,
  onSubjectAssetChange,
  recommendedSubjects,
  approvedVisualAssets,
  styleAssetIds,
  onToggleStyleAsset,
  recommendedStyles,
  contextAssetIds,
  onToggleContextAsset,
  briefs,
  compositingAssets,
  packetPreviewOpen,
  onPacketPreviewToggle,
  approvedAssets,
  referenceUrl,
  onReferenceUrlChange,
  referenceStatus,
  referenceError,
  referenceAnalysis,
  referenceScreenshots,
  onAnalyzeUrl,
  onUploadScreenshot,
  onClearReference,
  briefText,
  onBriefTextChange,
  onBriefSelect,
  selectedPlatforms,
  onSelectedPlatformsChange,
  onGenerate,
  onGenerateVideo,
  isGenerating,
  isGeneratingVideo,
  generateDisabledReason,
  budgetStatus,
  estimatedCost,
  creativeId,
  hasVariants,
}: CreativeConfigPanelProps) {
  return (
    <aside className="w-[320px] shrink-0 border-r border-border bg-card/50 flex flex-col z-20 shadow-xl">
      <div className="p-4 border-b border-border">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Settings2 size={18} className="text-primary" />
          Creative Setup
        </h2>
        {remixId && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
            <RefreshCw size={12} />
            <span>Remixing from existing creative</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Creative Name</label>
          <Input
            placeholder="e.g. Fall Tournament Hype"
            className="bg-background border-border"
            value={creativeName}
            onChange={e => onCreativeNameChange(e.target.value)}
            disabled={isGenerating}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Brand DNA</label>
          <Select value={selectedBrand} onValueChange={onBrandChange} disabled={isGenerating}>
            <SelectTrigger className="w-full bg-background border-border">
              <SelectValue placeholder="Select Brand" />
            </SelectTrigger>
            <SelectContent>
              {brands?.map(b => (
                <SelectItem key={b.id} value={b.id}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.colorPrimary }} />
                    {b.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Template</label>
          <Select value={selectedTemplate} onValueChange={onTemplateChange} disabled={!selectedBrand || isGenerating}>
            <SelectTrigger className="w-full bg-background border-border">
              <SelectValue placeholder="Select Template" />
            </SelectTrigger>
            <SelectContent>
              {templates?.data?.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
              <Star size={10} /> Subject Reference <span className="text-muted-foreground">(pick 1)</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(recommendedSubjects.length > 0 ? recommendedSubjects : approvedVisualAssets).slice(0, 6).map((asset, idx) => {
                const isSelected = subjectAssetId === asset.id;
                const isRecommended = idx < 3 && recommendedSubjects.length > 0;
                return (
                  <div
                    key={asset.id}
                    onClick={() => !isGenerating && onSubjectAssetChange(isSelected ? null : asset.id)}
                    className={`aspect-square rounded-md bg-muted border-2 cursor-pointer overflow-hidden relative group transition-colors ${isSelected ? 'border-blue-400 ring-1 ring-blue-400/30' : isRecommended ? 'border-blue-400/30 hover:border-blue-400/60' : 'border-transparent hover:border-muted-foreground/50'} ${isGenerating ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    {asset.thumbnailUrl || asset.fileUrl ? (
                      <img src={asset.thumbnailUrl || asset.fileUrl || ""} alt="Asset" className={`w-full h-full object-cover transition-opacity ${isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-card"><ImageIcon size={16} className="text-muted-foreground" /></div>
                    )}
                    {isSelected && <div className="absolute top-1 left-1 w-2.5 h-2.5 bg-blue-400 rounded-full shadow-[0_0_8px_rgba(96,165,250,0.8)] border border-background" />}
                    {isRecommended && !isSelected && (
                      <div className="absolute bottom-0 left-0 right-0 bg-blue-500/80 text-center">
                        <span className="text-[8px] text-white font-semibold uppercase">Recommended</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-green-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers size={10} /> Style Reference <span className="text-muted-foreground">(pick 1-2)</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(recommendedStyles.length > 0 ? recommendedStyles : approvedVisualAssets).slice(0, 6).map((asset, idx) => {
                const isSelected = styleAssetIds.includes(asset.id);
                const isRecommended = idx < 3 && recommendedStyles.length > 0;
                return (
                  <div
                    key={asset.id}
                    onClick={() => !isGenerating && onToggleStyleAsset(asset.id)}
                    className={`aspect-square rounded-md bg-muted border-2 cursor-pointer overflow-hidden relative group transition-colors ${isSelected ? 'border-green-400 ring-1 ring-green-400/30' : isRecommended ? 'border-green-400/30 hover:border-green-400/60' : 'border-transparent hover:border-muted-foreground/50'} ${isGenerating ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    {asset.thumbnailUrl || asset.fileUrl ? (
                      <img src={asset.thumbnailUrl || asset.fileUrl || ""} alt="Asset" className={`w-full h-full object-cover transition-opacity ${isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-card"><ImageIcon size={16} className="text-muted-foreground" /></div>
                    )}
                    {isSelected && <div className="absolute top-1 left-1 w-2.5 h-2.5 bg-green-400 rounded-full shadow-[0_0_8px_rgba(74,222,128,0.8)] border border-background" />}
                    {isRecommended && !isSelected && (
                      <div className="absolute bottom-0 left-0 right-0 bg-green-500/80 text-center">
                        <span className="text-[8px] text-white font-semibold uppercase">Recommended</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={10} /> Context Cards <span className="text-muted-foreground">(optional)</span>
            </label>
            {briefs?.data && briefs.data.length > 0 ? (
              <div className="space-y-1">
                {briefs.data.slice(0, 4).map(brief => {
                  const isSelected = contextAssetIds.includes(brief.id);
                  return (
                    <button
                      key={brief.id}
                      onClick={() => !isGenerating && onToggleContextAsset(brief.id)}
                      className={`w-full text-left p-2 rounded border text-xs transition-colors ${isSelected ? 'border-amber-400/50 bg-amber-500/10 text-amber-200' : 'border-border bg-background hover:border-amber-400/30 text-muted-foreground'}`}
                    >
                      <span className="font-medium truncate block">{brief.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No context briefs available.</p>
            )}
          </div>

          {compositingAssets.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={10} /> Compositing <span className="text-muted-foreground">(auto)</span>
              </label>
              <div className="flex gap-1.5">
                {compositingAssets.slice(0, 4).map(asset => (
                  <div key={asset.id} className="w-8 h-8 rounded border border-purple-400/30 bg-purple-500/10 overflow-hidden" title={asset.name}>
                    {asset.thumbnailUrl || asset.fileUrl ? (
                      <img src={asset.thumbnailUrl || asset.fileUrl || ""} alt={asset.name} className="w-full h-full object-cover opacity-80" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Layers size={10} className="text-purple-400" /></div>
                    )}
                  </div>
                ))}
                <span className="text-[10px] text-purple-400 self-center ml-1">Auto-applied</span>
              </div>
            </div>
          )}

          {(subjectAssetId || styleAssetIds.length > 0) && (
            <button
              onClick={onPacketPreviewToggle}
              className="w-full text-xs text-primary hover:text-primary/80 flex items-center justify-center gap-1.5 py-2 border border-primary/20 rounded-md hover:bg-primary/5 transition-colors"
            >
              <Package size={12} />
              {packetPreviewOpen ? "Hide" : "Preview"} Generation Packet
            </button>
          )}
        </div>

        {packetPreviewOpen && (
          <div className="bg-background border border-primary/20 rounded-lg p-3 space-y-3">
            <h4 className="text-xs font-semibold text-primary uppercase flex items-center gap-1.5">
              <Package size={12} /> Generation Packet Preview
            </h4>

            <div className="space-y-2">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">To AI Generation</p>
              <div className="space-y-1">
                {subjectAssetId && (() => {
                  const asset = approvedAssets?.data?.find(a => a.id === subjectAssetId) || recommendedSubjects.find(a => a.id === subjectAssetId);
                  return asset ? (
                    <div className="flex items-center gap-2 p-1.5 rounded bg-blue-500/10 border border-blue-500/20">
                      <div className="w-6 h-6 rounded overflow-hidden shrink-0">
                        {asset.thumbnailUrl || asset.fileUrl ? <img src={asset.thumbnailUrl || asset.fileUrl || ""} className="w-full h-full object-cover" /> : <ImageIcon size={12} />}
                      </div>
                      <span className="text-[10px] text-blue-300 truncate flex-1">{asset.name}</span>
                      <Badge className="text-[8px] bg-blue-500/20 text-blue-300 border-none">Subject</Badge>
                    </div>
                  ) : null;
                })()}
                {styleAssetIds.map(id => {
                  const asset = approvedAssets?.data?.find(a => a.id === id) || recommendedStyles.find(a => a.id === id);
                  return asset ? (
                    <div key={id} className="flex items-center gap-2 p-1.5 rounded bg-green-500/10 border border-green-500/20">
                      <div className="w-6 h-6 rounded overflow-hidden shrink-0">
                        {asset.thumbnailUrl || asset.fileUrl ? <img src={asset.thumbnailUrl || asset.fileUrl || ""} className="w-full h-full object-cover" /> : <ImageIcon size={12} />}
                      </div>
                      <span className="text-[10px] text-green-300 truncate flex-1">{asset.name}</span>
                      <Badge className="text-[8px] bg-green-500/20 text-green-300 border-none">Style</Badge>
                    </div>
                  ) : null;
                })}
                {!subjectAssetId && styleAssetIds.length === 0 && (
                  <p className="text-[10px] text-muted-foreground italic">No assets selected for generation</p>
                )}
              </div>
            </div>

            {compositingAssets.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase text-muted-foreground font-semibold">To Compositing (Post-Generation)</p>
                <div className="space-y-1">
                  {compositingAssets.slice(0, 3).map(asset => (
                    <div key={asset.id} className="flex items-center gap-2 p-1.5 rounded bg-purple-500/10 border border-purple-500/20">
                      <div className="w-6 h-6 rounded overflow-hidden shrink-0">
                        {asset.thumbnailUrl || asset.fileUrl ? <img src={asset.thumbnailUrl || asset.fileUrl || ""} className="w-full h-full object-cover" /> : <Layers size={12} />}
                      </div>
                      <span className="text-[10px] text-purple-300 truncate flex-1">{asset.name}</span>
                      <Badge className="text-[8px] bg-purple-500/20 text-purple-300 border-none">Logo</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {contextAssetIds.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] uppercase text-muted-foreground font-semibold">Text Context</p>
                <div className="space-y-1">
                  {contextAssetIds.map(id => {
                    const brief = briefs?.data?.find(b => b.id === id);
                    return brief ? (
                      <div key={id} className="flex items-center gap-2 p-1.5 rounded bg-amber-500/10 border border-amber-500/20">
                        <FileText size={12} className="text-amber-400 shrink-0" />
                        <span className="text-[10px] text-amber-300 truncate flex-1">{brief.name}</span>
                        <Badge className="text-[8px] bg-amber-500/20 text-amber-300 border-none">Brief</Badge>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <ReferenceAnalyzer
          referenceUrl={referenceUrl}
          onUrlChange={onReferenceUrlChange}
          referenceStatus={referenceStatus}
          referenceError={referenceError}
          referenceAnalysis={referenceAnalysis}
          referenceScreenshots={referenceScreenshots}
          onAnalyzeUrl={onAnalyzeUrl}
          onUploadScreenshot={onUploadScreenshot}
          onClearReference={onClearReference}
          isGenerating={isGenerating}
          selectedBrand={selectedBrand}
        />

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Context Brief</label>
          <Select onValueChange={onBriefSelect} disabled={!selectedBrand || !briefs?.data?.length || isGenerating}>
            <SelectTrigger className="w-full bg-background border-border">
              <SelectValue placeholder="Select a Brief" />
            </SelectTrigger>
            <SelectContent>
              {briefs?.data?.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Write custom brief or instructions for the AI..."
            className="min-h-[120px] bg-background border-border text-sm resize-y mt-2"
            value={briefText}
            onChange={e => onBriefTextChange(e.target.value)}
            disabled={isGenerating}
          />
        </div>
      </div>

      <div className="p-4 border-t border-border bg-background shadow-[0_-4px_10px_rgba(0,0,0,0.2)] z-10 space-y-2">
        {selectedPlatforms.length < ALL_PLATFORM_KEYS.length && (
          <div className="flex flex-wrap gap-1 mb-1">
            <span className="text-[10px] text-muted-foreground w-full">Platforms:</span>
            {ALL_PLATFORM_KEYS.map(pk => {
              const active = selectedPlatforms.includes(pk);
              return (
                <button
                  key={pk}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    active
                      ? "bg-primary/20 text-primary border-primary/40"
                      : "bg-muted/30 text-muted-foreground border-border hover:border-primary/30"
                  }`}
                  onClick={() => {
                    onSelectedPlatformsChange(
                      active
                        ? selectedPlatforms.filter(p => p !== pk)
                        : [...selectedPlatforms, pk]
                    );
                  }}
                  disabled={isGenerating}
                >
                  {PLATFORM_LABELS[pk].name}
                </button>
              );
            })}
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
              onClick={() => onSelectedPlatformsChange(ALL_PLATFORM_KEYS)}
            >
              All
            </button>
          </div>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20"
                  onClick={onGenerate}
                  disabled={isGenerating || isGeneratingVideo || !!generateDisabledReason || selectedPlatforms.length === 0}
                >
                  {isGenerating ? (
                    <><Loader2 size={16} className="mr-2 animate-spin" /> Generating...</>
                  ) : (
                    <><Play size={16} className="mr-2" /> Generate Creative</>
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            {generateDisabledReason && (
              <TooltipContent>{generateDisabledReason}</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        {budgetStatus && budgetStatus.threshold !== null && (
          <div className={`text-xs mt-2 space-y-0.5 ${
            budgetStatus.overBudget ? "text-red-400" :
            budgetStatus.nearLimit ? "text-amber-400" : "text-muted-foreground"
          }`}>
            <div>Est. cost: ${estimatedCost.toFixed(2)}</div>
            <div>Daily: ${budgetStatus.todaySpend.toFixed(2)} / ${budgetStatus.threshold.toFixed(2)}</div>
          </div>
        )}
        <Button
          variant="outline"
          className="w-full border-border hover:bg-muted text-foreground"
          onClick={onGenerateVideo}
          disabled={isGenerating || isGeneratingVideo || !creativeId || !hasVariants}
        >
          {isGeneratingVideo ? (
            <><Loader2 size={16} className="mr-2 animate-spin" /> Generating Video...</>
          ) : (
            <><Video size={16} className="mr-2 text-primary" /> Generate Video</>
          )}
        </Button>
      </div>
    </aside>
  );
}
