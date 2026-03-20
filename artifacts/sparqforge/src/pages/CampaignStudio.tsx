import { useState, useCallback, useRef, useEffect } from "react";
import { Search, Play, MoreHorizontal, Settings2, Image as ImageIcon, FileText, Send, Save, Download, Loader2, Check, X, AlertCircle, CalendarIcon, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { 
  useGetBrands, 
  useGetTemplates, 
  useGetAssets,
  useCreateCampaign
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ScheduleModal } from "@/components/ScheduleModal";
import { useSearch } from "wouter";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface GeneratedVariant {
  id?: string;
  platform: string;
  aspectRatio: string;
  rawImageUrl: string | null;
  compositedImageUrl: string | null;
  caption: string;
  headlineText: string | null;
}

interface ActivityLog {
  time: string;
  text: string;
  status: "pending" | "done" | "error";
}

interface DuplicateInfo {
  duplicate: boolean;
  campaignId?: string;
  campaignName?: string;
  createdAt?: string;
}

const PLATFORM_LABELS: Record<string, { name: string; platformIcon: string; ratio: string }> = {
  instagram_feed: { name: "Instagram Feed", platformIcon: "instagram", ratio: "1:1" },
  instagram_story: { name: "Instagram Story", platformIcon: "instagram", ratio: "9:16" },
  twitter: { name: "X (Twitter)", platformIcon: "twitter", ratio: "16:9" },
  linkedin: { name: "LinkedIn", platformIcon: "linkedin", ratio: "16:9" },
};

export default function CampaignStudio() {
  const { toast } = useToast();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const remixId = params.get("remix");
  
  const { data: brands } = useGetBrands();
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  
  const { data: templates } = useGetTemplates({ brandId: selectedBrand || undefined }, { query: { enabled: !!selectedBrand } });
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const { data: approvedAssets } = useGetAssets({ brandId: selectedBrand || undefined, status: "approved" }, { query: { enabled: !!selectedBrand } });
  const { data: briefs } = useGetAssets({ brandId: selectedBrand || undefined, type: "context" }, { query: { enabled: !!selectedBrand } });

  const [campaignName, setCampaignName] = useState("");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [briefText, setBriefText] = useState("");
  const [refineText, setRefineText] = useState("");
  
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariant[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([{ time: "Just now", text: "Studio session started", status: "done" }]);
  const [estimatedCost, setEstimatedCost] = useState(0);
  
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [duplicateDismissed, setDuplicateDismissed] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const remixLoadedRef = useRef(false);
  
  const createCampaignMutation = useCreateCampaign();

  useEffect(() => {
    if (remixId && !remixLoadedRef.current) {
      remixLoadedRef.current = true;
      loadRemixCampaign(remixId);
    }
  }, [remixId]);

  const loadRemixCampaign = async (sourceId: string) => {
    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${sourceId}`);
      if (!resp.ok) return;
      const source = await resp.json();

      setCampaignName(`${source.name} (Remix)`);
      setSelectedBrand(source.brandId);
      setBriefText(source.briefText || "");

      const assets = (source.selectedAssets || []) as Array<{ assetId: string }>;
      setSelectedAssets(assets.map((a: { assetId: string }) => a.assetId));

      addLog(`Remixing from: ${source.name}`, "done");
      toast({ title: "Campaign loaded for remix", description: "Select a new template and generate." });
    } catch {
      toast({ variant: "destructive", title: "Failed to load source campaign" });
    }
  };

  useEffect(() => {
    if (!selectedTemplate || !selectedAssets.length || duplicateDismissed) return;

    const primaryAssetId = selectedAssets[0];
    if (!primaryAssetId) return;

    const checkDuplicate = async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/campaigns/check-duplicate?templateId=${selectedTemplate}&primaryAssetId=${primaryAssetId}`);
        if (resp.ok) {
          const data = await resp.json();
          setDuplicateInfo(data);
        }
      } catch {}
    };

    checkDuplicate();
  }, [selectedTemplate, selectedAssets, duplicateDismissed]);

  const toggleAsset = (id: string) => {
    setSelectedAssets(prev => {
      if (prev.includes(id)) return prev.filter(a => a !== id);
      return [id, ...prev];
    });
    setDuplicateDismissed(false);
  };

  const addLog = useCallback((text: string, status: ActivityLog["status"] = "pending") => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setActivityLog(prev => [{ time, text, status }, ...prev]);
  }, []);

  const updateLastLog = useCallback((status: ActivityLog["status"]) => {
    setActivityLog(prev => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[0] = { ...updated[0], status };
      return updated;
    });
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (!selectedBrand) {
      toast({ variant: "destructive", title: "Brand required" });
      return;
    }
    
    createCampaignMutation.mutate({
      data: {
        name: campaignName || "Untitled Campaign",
        brandId: selectedBrand,
        templateId: selectedTemplate || null,
        briefText,
        selectedAssets: selectedAssets.map((id, i) => ({ assetId: id, role: i === 0 ? "primary" : "supporting" })),
        sourceCampaignId: remixId || null,
        createdBy: "current_user",
      }
    }, {
      onSuccess: (data) => {
        setCampaignId(data.id);
        toast({ title: "Draft Saved", description: "Campaign saved successfully." });
        addLog("Campaign draft saved", "done");
      }
    });
  }, [selectedBrand, campaignName, selectedTemplate, briefText, selectedAssets, remixId, createCampaignMutation, toast, addLog]);

  const handleGenerate = useCallback(async () => {
    if (!selectedBrand || !selectedTemplate) {
      toast({ variant: "destructive", title: "Select a brand and template first" });
      return;
    }

    setIsGenerating(true);
    setGeneratedVariants([]);
    addLog("Creating campaign...", "pending");

    try {
      let cId = campaignId;

      if (!cId) {
        const resp = await fetch(`${API_BASE}/api/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: campaignName || "Untitled Campaign",
            brandId: selectedBrand,
            templateId: selectedTemplate,
            briefText,
            selectedAssets: selectedAssets.map((id, i) => ({ assetId: id, role: i === 0 ? "primary" : "supporting" })),
            sourceCampaignId: remixId || null,
            createdBy: "current_user",
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Failed to create campaign" }));
          throw new Error(err.error || "Failed to create campaign");
        }
        const campaign = await resp.json();
        cId = campaign.id;
        setCampaignId(cId!);
      } else {
        const resp = await fetch(`${API_BASE}/api/campaigns/${cId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: selectedTemplate,
            briefText,
            selectedAssets: selectedAssets.map((id, i) => ({ assetId: id, role: i === 0 ? "primary" : "supporting" })),
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Failed to update campaign" }));
          throw new Error(err.error || "Failed to update campaign");
        }
      }

      updateLastLog("done");
      addLog("Starting AI generation pipeline...", "pending");

      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`${API_BASE}/api/campaigns/${cId}/generate`, {
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start generation");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(currentEvent, data);
            } catch {}
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        addLog("Generation cancelled", "error");
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        addLog(`Generation failed: ${msg}`, "error");
        toast({ variant: "destructive", title: "Generation Failed", description: msg });
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [selectedBrand, selectedTemplate, campaignId, campaignName, briefText, selectedAssets, remixId, toast, addLog, updateLastLog]);

  const handleSSEEvent = useCallback((event: string, data: Record<string, unknown>) => {
    switch (event) {
      case "progress": {
        const message = data.message as string;
        const isDone = data.done as boolean;
        if (isDone) {
          addLog(message, "done");
        } else {
          addLog(message, "pending");
        }
        break;
      }
      case "image_progress": {
        const platform = data.platform as string;
        const status = data.status as string;
        const label = PLATFORM_LABELS[platform]?.name || platform;
        if (status === "started") {
          addLog(`Generating ${label} image...`, "pending");
        } else if (status === "completed") {
          updateLastLog("done");
        } else if (status === "failed") {
          updateLastLog("error");
        }
        break;
      }
      case "variant_ready": {
        const variant: GeneratedVariant = {
          platform: data.platform as string,
          aspectRatio: data.aspectRatio as string,
          rawImageUrl: data.rawImageUrl as string | null,
          compositedImageUrl: data.compositedImageUrl as string | null,
          caption: data.caption as string,
          headlineText: data.headline as string | null,
        };
        setGeneratedVariants(prev => [...prev, variant]);
        break;
      }
      case "complete": {
        const variants = data.variants as GeneratedVariant[] | undefined;
        const cost = data.estimatedCost as number | undefined;
        if (variants) {
          setGeneratedVariants(variants.map(v => ({
            id: (v as any).id,
            platform: v.platform,
            aspectRatio: v.aspectRatio,
            rawImageUrl: v.rawImageUrl,
            compositedImageUrl: v.compositedImageUrl,
            caption: v.caption,
            headlineText: v.headlineText,
          })));
        }
        if (cost) setEstimatedCost(cost);
        addLog("Generation complete!", "done");
        break;
      }
      case "error": {
        addLog(data.message as string, "error");
        break;
      }
    }
  }, [addLog, updateLastLog]);

  const handleCaptionChange = useCallback(async (variantId: string | undefined, platform: string, newCaption: string) => {
    setGeneratedVariants(prev => prev.map(v => 
      v.platform === platform ? { ...v, caption: newCaption } : v
    ));

    if (variantId && campaignId) {
      try {
        await fetch(`${API_BASE}/api/campaigns/${campaignId}/variants/${variantId}/caption`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caption: newCaption }),
        });
      } catch {}
    }
  }, [campaignId]);

  const handleDownloadAll = useCallback(() => {
    if (!campaignId) return;
    window.open(`${API_BASE}/api/campaigns/${campaignId}/download`, "_blank");
  }, [campaignId]);

  const handleDownloadVariant = useCallback((variantId: string | undefined) => {
    if (!campaignId || !variantId) return;
    window.open(`${API_BASE}/api/campaigns/${campaignId}/variants/${variantId}/download`, "_blank");
  }, [campaignId]);

  const handleSubmitForReview = useCallback(async () => {
    if (!campaignId) return;
    try {
      await fetch(`${API_BASE}/api/campaigns/${campaignId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending_review" }),
      });
      toast({ title: "Submitted!", description: "Campaign sent to Review Queue." });
      addLog("Submitted for review", "done");
    } catch {
      toast({ variant: "destructive", title: "Failed to submit" });
    }
  }, [campaignId, toast, addLog]);

  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      
      <aside className="w-[320px] shrink-0 border-r border-border bg-card/50 flex flex-col z-20 shadow-xl">
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Settings2 size={18} className="text-primary" />
            Campaign Setup
          </h2>
          {remixId && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
              <RefreshCw size={12} />
              <span>Remixing from existing campaign</span>
            </div>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign Name</label>
            <Input 
              placeholder="e.g. Fall Tournament Hype" 
              className="bg-background border-border"
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Brand DNA</label>
            <Select value={selectedBrand} onValueChange={(v) => { setSelectedBrand(v); setSelectedTemplate(""); }} disabled={isGenerating}>
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
            <Select value={selectedTemplate} onValueChange={(v) => { setSelectedTemplate(v); setDuplicateDismissed(false); }} disabled={!selectedBrand || isGenerating}>
              <SelectTrigger className="w-full bg-background border-border">
                <SelectValue placeholder="Select Template" />
              </SelectTrigger>
              <SelectContent>
                {templates?.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source Assets</label>
            </div>
            
            <div className="grid grid-cols-3 gap-2">
              {approvedAssets?.filter(a => a.type === 'visual').slice(0, 8).map(asset => {
                const isSelected = selectedAssets.includes(asset.id);
                return (
                  <div 
                    key={asset.id} 
                    onClick={() => !isGenerating && toggleAsset(asset.id)}
                    className={`aspect-square rounded-md bg-muted border-2 cursor-pointer overflow-hidden relative group transition-colors ${isSelected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/50'} ${isGenerating ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    {asset.thumbnailUrl || asset.fileUrl ? (
                       <img src={asset.thumbnailUrl || asset.fileUrl || ""} alt="Asset" className={`w-full h-full object-cover transition-opacity ${isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-card"><ImageIcon size={16} className="text-muted-foreground" /></div>
                    )}
                    {isSelected && <div className="absolute top-1 left-1 w-2.5 h-2.5 bg-primary rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)] border border-background" />}
                  </div>
                );
              })}
              {selectedBrand && !approvedAssets?.filter(a => a.type === 'visual').length && (
                <p className="text-xs text-muted-foreground italic col-span-3">No approved visual assets found.</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Context Brief</label>
            <Select onValueChange={(val) => {
              const brief = briefs?.find(b => b.id === val);
              if(brief) setBriefText(brief.content || "");
            }} disabled={!selectedBrand || !briefs?.length || isGenerating}>
              <SelectTrigger className="w-full bg-background border-border">
                <SelectValue placeholder="Select a Brief" />
              </SelectTrigger>
              <SelectContent>
                {briefs?.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea 
              placeholder="Write custom brief or instructions for the AI..." 
              className="min-h-[120px] bg-background border-border text-sm resize-y mt-2"
              value={briefText}
              onChange={e => setBriefText(e.target.value)}
              disabled={isGenerating}
            />
          </div>
        </div>
        
        <div className="p-4 border-t border-border bg-background shadow-[0_-4px_10px_rgba(0,0,0,0.2)] z-10">
          <Button 
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20"
            onClick={handleGenerate}
            disabled={isGenerating || !selectedBrand || !selectedTemplate}
          >
            {isGenerating ? (
              <><Loader2 size={16} className="mr-2 animate-spin" /> Generating...</>
            ) : (
              <><Play size={16} className="mr-2" /> Generate Campaign</>
            )}
          </Button>
        </div>
      </aside>

      <section className="flex-1 flex flex-col min-w-0 relative bg-background/50">
        <div className="h-16 px-6 border-b border-border flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex-1 max-w-xl relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <Input 
              placeholder="Refine all variants... (e.g. 'Make it more aggressive')" 
              className="w-full pl-10 bg-card border-border h-10 focus-visible:ring-primary/50"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
            />
            {refineText && (
              <Button size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 bg-primary hover:bg-primary/90">
                <Send size={14} />
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-3 ml-4">
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
                  Similar campaign detected
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This looks similar to "{duplicateInfo.campaignName}" from{" "}
                  {duplicateInfo.createdAt
                    ? new Date(duplicateInfo.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "recently"}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => setDuplicateDismissed(true)}
                  >
                    Dismiss and Proceed
                  </Button>
                </div>
              </div>
              <button onClick={() => setDuplicateDismissed(true)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl mx-auto pb-12">
            {generatedVariants.length > 0 ? (
              generatedVariants.map((variant) => {
                const label = PLATFORM_LABELS[variant.platform] || { name: variant.platform, platformIcon: "twitter", ratio: variant.aspectRatio };
                const imageUrl = variant.compositedImageUrl || variant.rawImageUrl;
                return (
                  <div key={variant.platform} className="bg-card border border-border rounded-xl overflow-hidden shadow-lg flex flex-col hover:border-border/80 transition-colors">
                    <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={label.platformIcon} />
                        <span className="font-semibold text-sm">{label.name}</span>
                        <span className="text-xs text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">{label.ratio}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {variant.id && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => handleDownloadVariant(variant.id)}>
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
                        <div className="w-[160px] shrink-0 rounded-md border border-border/50 overflow-hidden bg-muted/30">
                          {imageUrl ? (
                            <img 
                              src={`${API_BASE}${imageUrl}`} 
                              alt={`${label.name} variant`} 
                              className="w-full h-auto object-cover"
                            />
                          ) : (
                            <div className="w-full aspect-square flex flex-col items-center justify-center text-muted-foreground">
                              <Loader2 size={24} className="mb-2 animate-spin opacity-30" />
                              <span className="text-[10px] uppercase tracking-wider opacity-50">Generating</span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 flex flex-col gap-2">
                          {variant.headlineText && (
                            <div className="bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
                              <span className="text-[10px] text-primary uppercase tracking-wider font-semibold">Headline</span>
                              <p className="text-sm font-bold text-foreground mt-0.5">{variant.headlineText}</p>
                            </div>
                          )}
                          <Textarea 
                            className="flex-1 min-h-[80px] resize-none text-sm bg-background border-border p-3"
                            value={variant.caption}
                            onChange={(e) => handleCaptionChange(variant.id, variant.platform, e.target.value)}
                          />
                          <div className="flex justify-between items-center px-1">
                            <span className="text-[10px] text-muted-foreground">{variant.caption.length} chars</span>
                            <div className="flex gap-1">
                               <Button variant="ghost" size="icon" className="h-6 w-6"><FileText size={12} /></Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
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
                        {isGenerating ? (
                          <>
                            <Loader2 size={24} className="mb-2 animate-spin opacity-30" />
                            <span className="text-[10px] uppercase tracking-wider opacity-50">Generating</span>
                          </>
                        ) : (
                          <>
                            <ImageIcon size={24} className="mb-2 opacity-20" />
                            <span className="text-[10px] font-medium uppercase tracking-wider opacity-50">Placeholder</span>
                          </>
                        )}
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

      <aside className="w-[280px] shrink-0 border-l border-border bg-card/50 flex flex-col z-20 shadow-xl">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-foreground">Overview</h2>
          <div className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded border border-primary/20">
            Cost: ${estimatedCost.toFixed(2)}
          </div>
        </div>
        
        <div className="flex-1 p-4 overflow-y-auto">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Activity Log</h3>
          <div className="space-y-3">
            {activityLog.map((log, i) => (
              <div key={i} className="flex gap-3 relative">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 z-10 ${
                  log.status === "done" ? "bg-green-500/20 text-green-400" :
                  log.status === "error" ? "bg-red-500/20 text-red-400" :
                  "bg-amber-500/20 text-amber-400"
                }`}>
                  {log.status === "done" ? <Check size={10} /> :
                   log.status === "error" ? <X size={10} /> :
                   <Loader2 size={10} className="animate-spin" />}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-foreground leading-tight">{log.text}</p>
                  <p className="text-[10px] text-muted-foreground">{log.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="p-4 border-t border-border space-y-2 bg-background">
          <Button 
            variant="outline" 
            className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground"
            onClick={handleSaveDraft}
            disabled={createCampaignMutation.isPending || isGenerating}
          >
            <Save size={16} className="mr-2 text-muted-foreground" /> 
            {createCampaignMutation.isPending ? "Saving..." : "Save Draft"}
          </Button>
          <Button 
            variant="outline" 
            className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground" 
            disabled={generatedVariants.length === 0 || !campaignId}
            onClick={handleDownloadAll}
          >
            <Download size={16} className="mr-2 text-muted-foreground" /> Download All Assets
          </Button>
          <Button 
            variant="outline" 
            className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground" 
            disabled={generatedVariants.length === 0 || !campaignId || isGenerating}
            onClick={() => setScheduleModalOpen(true)}
          >
            <CalendarIcon size={16} className="mr-2 text-muted-foreground" /> Schedule
          </Button>
          <Button 
            className="w-full justify-center bg-primary hover:bg-primary/90 text-primary-foreground font-bold mt-2" 
            disabled={generatedVariants.length === 0 || !campaignId || isGenerating}
            onClick={handleSubmitForReview}
          >
            Submit for Review
          </Button>
        </div>
      </aside>

      {campaignId && (
        <ScheduleModal
          open={scheduleModalOpen}
          onOpenChange={setScheduleModalOpen}
          campaignId={campaignId}
          campaignName={campaignName || "Untitled Campaign"}
          onScheduled={() => {
            addLog("Campaign scheduled", "done");
            toast({ title: "Scheduled!", description: "Campaign added to calendar." });
          }}
        />
      )}
    </div>
  );
}
