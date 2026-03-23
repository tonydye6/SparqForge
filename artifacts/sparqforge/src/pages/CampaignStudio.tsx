import { useState, useCallback, useRef, useEffect } from "react";
import { Search, Play, MoreHorizontal, Settings2, Image as ImageIcon, FileText, Send, Loader2, Check, X, AlertCircle, RefreshCw, AlertTriangle, Link, Upload, Trash2, Hash, Video, Layers, Star, Eye, Package, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { VariantCard } from "@/components/campaign-studio/VariantCard";
import { ReferenceAnalyzer } from "@/components/campaign-studio/ReferenceAnalyzer";
import { 
  useGetBrands, 
  useGetTemplates, 
  useGetAssets,
  useCreateCampaign,
  type Asset
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ScheduleModal } from "@/components/ScheduleModal";
import { useSearch } from "wouter";
import { HashtagSetDialog } from "@/components/campaign-studio/HashtagSetDialog";
import { AudioSettingsDialog } from "@/components/campaign-studio/AudioSettingsDialog";
import { ActivityPanel } from "@/components/campaign-studio/ActivityPanel";
import { useBrandReadiness } from "@/hooks/useBrandReadiness";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GeneratedVariant, ActivityLog, DuplicateInfo, BudgetStatus, RewriteToolbarState, LoadingPhase, PLATFORM_LABELS, ALL_PLATFORM_KEYS, PLAN_PLATFORM_MAP, API_BASE } from "@/components/campaign-studio/campaign-studio.types";

export default function CampaignStudio() {
  const { toast } = useToast();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const remixId = params.get("remix");
  const fromPlanCampaignId = params.get("campaign");
  const fromPlanPlatform = params.get("platform");
  
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
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(ALL_PLATFORM_KEYS);
  
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariant[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([{ time: "Just now", text: "Studio session started", status: "done" }]);
  const [estimatedCost, setEstimatedCost] = useState(0);
  
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [duplicateDismissed, setDuplicateDismissed] = useState(false);
  
  const [variantRefineOpen, setVariantRefineOpen] = useState<Record<string, boolean>>({});
  const [variantRefineText, setVariantRefineText] = useState<Record<string, string>>({});
  const [regeneratingVariant, setRegeneratingVariant] = useState<string | null>(null);
  
  const [hashtagDialogOpen, setHashtagDialogOpen] = useState(false);
  const [hashtagSetName, setHashtagSetName] = useState("");
  const [hashtagsToSave, setHashtagsToSave] = useState<string[]>([]);
  const [savingHashtags, setSavingHashtags] = useState(false);

  const [subjectAssetId, setSubjectAssetId] = useState<string | null>(null);
  const [styleAssetIds, setStyleAssetIds] = useState<string[]>([]);
  const [contextAssetIds, setContextAssetIds] = useState<string[]>([]);
  const [packetPreviewOpen, setPacketPreviewOpen] = useState(false);

  const [recommendedSubjects, setRecommendedSubjects] = useState<Asset[]>([]);
  const [recommendedStyles, setRecommendedStyles] = useState<Asset[]>([]);
  const [compositingAssets, setCompositingAssets] = useState<Asset[]>([]);

  const { data: brandReadiness } = useBrandReadiness(selectedBrand || null);

  const generateDisabledReason = (() => {
    if (!selectedBrand) return "Select a brand";
    if (brandReadiness && !brandReadiness.ready) {
      const missingLabels = brandReadiness.missing
        .map(key => brandReadiness.checks[key]?.label)
        .filter(Boolean)
        .join(", ");
      return `Brand setup incomplete: ${missingLabels}`;
    }
    if (!selectedTemplate) return "Select a template";
    if (selectedAssets.length === 0) return "Select at least one asset";
    return null;
  })();

  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/daily-budget-status`, { credentials: "include" })
      .then(r => r.json())
      .then(setBudgetStatus)
      .catch(() => {});
  }, [generatedVariants.length]);

  useEffect(() => {
    if (!selectedBrand) return;
    const fetchRecommended = async () => {
      try {
        const [subRes, styRes, compRes] = await Promise.all([
          fetch(`${API_BASE}/api/assets/recommended?brandId=${selectedBrand}&role=subject_reference${selectedTemplate ? `&templateId=${selectedTemplate}` : ''}`),
          fetch(`${API_BASE}/api/assets/recommended?brandId=${selectedBrand}&role=style_reference${selectedTemplate ? `&templateId=${selectedTemplate}` : ''}`),
          fetch(`${API_BASE}/api/assets/recommended?brandId=${selectedBrand}&role=compositing`),
        ]);
        if (subRes.ok) setRecommendedSubjects(await subRes.json());
        if (styRes.ok) setRecommendedStyles(await styRes.json());
        if (compRes.ok) setCompositingAssets(await compRes.json());
      } catch {
        toast({ variant: "destructive", title: "Could not load recommendations" });
      }
    };
    fetchRecommended();
  }, [selectedBrand, selectedTemplate]);

  useEffect(() => {
    const allIds: string[] = [];
    if (subjectAssetId) allIds.push(subjectAssetId);
    allIds.push(...styleAssetIds);
    allIds.push(...contextAssetIds);
    setSelectedAssets(allIds);
  }, [subjectAssetId, styleAssetIds, contextAssetIds]);

  const toggleStyleAsset = (id: string) => {
    setStyleAssetIds(prev => {
      if (prev.includes(id)) return prev.filter(a => a !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const toggleContextAsset = (id: string) => {
    setContextAssetIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState<Record<string, string>>({});
  const [audioDialogOpen, setAudioDialogOpen] = useState(false);
  const [audioDialogVariant, setAudioDialogVariant] = useState<GeneratedVariant | null>(null);
  const [audioSource, setAudioSource] = useState<"music" | "sfx" | "mute">("music");
  const [audioPrompt, setAudioPrompt] = useState("");
  const [audioMergeMode, setAudioMergeMode] = useState<"replace" | "mix">("replace");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);

  const [rewriteToolbar, setRewriteToolbar] = useState<RewriteToolbarState | null>(null);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>({});

  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceStatus, setReferenceStatus] = useState<"idle" | "capturing" | "analyzing" | "done" | "error">("idle");
  const [referenceAnalysis, setReferenceAnalysis] = useState<Record<string, string> | null>(null);
  const [referenceScreenshots, setReferenceScreenshots] = useState<Array<{ url: string; viewport: string }>>([]);
  const [referenceError, setReferenceError] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const remixLoadedRef = useRef(false);
  const planLoadedRef = useRef(false);
  const loadingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  
  const createCampaignMutation = useCreateCampaign();

  useEffect(() => {
    if (remixId && !remixLoadedRef.current) {
      remixLoadedRef.current = true;
      loadRemixCampaign(remixId);
    }
  }, [remixId]);

  useEffect(() => {
    if (fromPlanCampaignId && !planLoadedRef.current) {
      planLoadedRef.current = true;
      loadPlanCampaign(fromPlanCampaignId);
    }
  }, [fromPlanCampaignId]);

  const loadPlanCampaign = async (id: string) => {
    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${id}`);
      if (!resp.ok) return;
      const campaign = await resp.json();

      setCampaignId(campaign.id);
      setCampaignName(campaign.name || "");
      setSelectedBrand(campaign.brandId);
      if (campaign.templateId) setSelectedTemplate(campaign.templateId);
      setBriefText(campaign.briefText || "");

      const assets = (campaign.selectedAssets || []) as Array<{ assetId: string }>;
      setSelectedAssets(assets.map((a: { assetId: string }) => a.assetId));

      if (fromPlanPlatform) {
        const mapped = PLAN_PLATFORM_MAP[fromPlanPlatform.toLowerCase()];
        if (mapped && mapped.length > 0) {
          setSelectedPlatforms(mapped);
        }
      }

      try {
        const variantsResp = await fetch(`${API_BASE}/api/campaigns/${id}/variants`);
        if (variantsResp.ok) {
          const variantsData = await variantsResp.json() as Array<Record<string, unknown>>;
          if (variantsData.length > 0) {
            setGeneratedVariants(variantsData.map(v => ({
              id: v.id as string | undefined,
              platform: v.platform as string,
              aspectRatio: v.aspectRatio as string,
              rawImageUrl: v.rawImageUrl as string | null,
              compositedImageUrl: v.compositedImageUrl as string | null,
              caption: v.caption as string,
              headlineText: v.headlineText as string | null,
              videoUrl: v.videoUrl as string | null ?? null,
              audioSource: v.audioSource as string | null ?? null,
              audioUrl: v.audioUrl as string | null ?? null,
              mergedVideoUrl: v.mergedVideoUrl as string | null ?? null,
            })));
          }
        }
      } catch {
        toast({ variant: "destructive", title: "Could not load campaign variants" });
      }

      const platformNote = fromPlanPlatform ? ` (Primary platform: ${fromPlanPlatform})` : "";
      addLog(`Loaded from content plan: ${campaign.name}${platformNote}`, "done");
      toast({
        title: "Campaign loaded from plan",
        description: fromPlanPlatform
          ? `Primary platform: ${fromPlanPlatform}. Configure and generate content.`
          : "Configure and generate content.",
      });
    } catch {
      toast({ variant: "destructive", title: "Failed to load campaign from plan" });
    }
  };

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
      } catch {
        toast({ variant: "destructive", title: "Duplicate check failed" });
      }
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

  const ensureCampaignId = useCallback(async (): Promise<string | null> => {
    if (campaignId) return campaignId;
    if (!selectedBrand) return null;

    try {
      const resp = await fetch(`${API_BASE}/api/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName || "Untitled Campaign",
          brandId: selectedBrand,
          templateId: selectedTemplate || null,
          briefText,
          selectedAssets: selectedAssets.map((id, i) => ({ assetId: id, role: i === 0 ? "primary" : "supporting" })),
          sourceCampaignId: remixId || null,
          createdBy: "current_user",
        }),
      });
      if (!resp.ok) return null;
      const campaign = await resp.json();
      setCampaignId(campaign.id);
      return campaign.id;
    } catch {
      return null;
    }
  }, [campaignId, selectedBrand, campaignName, selectedTemplate, briefText, selectedAssets, remixId]);

  const processSSEStream = useCallback(async (
    response: Response,
    onCaptured: (screenshots: Array<{ url: string; viewport: string }>) => void,
    onComplete: (data: { referenceAnalysis: Record<string, string>; referenceScreenshots: Array<{ url: string; viewport: string }> }) => void,
    onError: (message: string) => void,
  ) => {
    if (!response.body) {
      onError("No response stream");
      return;
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
            if (currentEvent === "captured") {
              onCaptured(data.referenceScreenshots || []);
            } else if (currentEvent === "complete") {
              onComplete({
                referenceAnalysis: data.referenceAnalysis,
                referenceScreenshots: data.referenceScreenshots || [],
              });
            } else if (currentEvent === "error") {
              onError(data.message || "Analysis failed");
            }
          } catch {
            onError("Received malformed data from server");
          }
          currentEvent = "";
        }
      }
    }
  }, []);

  const handleAnalyzeUrl = useCallback(async () => {
    if (!referenceUrl.trim()) return;

    try {
      new URL(referenceUrl);
    } catch {
      setReferenceError("Please enter a valid URL");
      setReferenceStatus("error");
      return;
    }

    if (!selectedBrand) {
      toast({ variant: "destructive", title: "Select a brand first" });
      return;
    }

    setReferenceStatus("capturing");
    setReferenceError("");

    const cId = await ensureCampaignId();
    if (!cId) {
      setReferenceStatus("error");
      setReferenceError("Failed to create campaign");
      return;
    }

    try {
      addLog("Capturing reference page...", "pending");

      const resp = await fetch(`${API_BASE}/api/campaigns/${cId}/analyze-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: referenceUrl }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || "Analysis failed");
      }

      await processSSEStream(
        resp,
        (screenshots) => {
          setReferenceScreenshots(screenshots);
          setReferenceStatus("analyzing");
          addLog("Analyzing reference design...", "pending");
        },
        (data) => {
          setReferenceAnalysis(data.referenceAnalysis);
          setReferenceScreenshots(data.referenceScreenshots);
          setReferenceStatus("done");
          addLog("Reference analyzed ✓", "done");
        },
        (message) => {
          throw new Error(message);
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      setReferenceStatus("error");
      setReferenceError(msg);
      addLog(`Reference analysis failed: ${msg}`, "error");
    }
  }, [referenceUrl, selectedBrand, ensureCampaignId, addLog, toast, processSSEStream]);

  const handleUploadScreenshot = useCallback(async (file: File) => {
    if (!selectedBrand) {
      toast({ variant: "destructive", title: "Select a brand first" });
      return;
    }

    setReferenceStatus("capturing");
    setReferenceError("");

    const cId = await ensureCampaignId();
    if (!cId) {
      setReferenceStatus("error");
      setReferenceError("Failed to create campaign");
      return;
    }

    try {
      addLog("Processing uploaded screenshot...", "pending");

      const formData = new FormData();
      formData.append("screenshot", file);

      const resp = await fetch(`${API_BASE}/api/campaigns/${cId}/analyze-upload`, {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Upload analysis failed" }));
        throw new Error(err.error || "Upload analysis failed");
      }

      await processSSEStream(
        resp,
        (screenshots) => {
          setReferenceScreenshots(screenshots);
          setReferenceStatus("analyzing");
          addLog("Analyzing reference design...", "pending");
        },
        (data) => {
          setReferenceAnalysis(data.referenceAnalysis);
          setReferenceScreenshots(data.referenceScreenshots);
          setReferenceStatus("done");
          setReferenceUrl(file.name);
          addLog("Uploaded reference analyzed ✓", "done");
        },
        (message) => {
          throw new Error(message);
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload analysis failed";
      setReferenceStatus("error");
      setReferenceError(msg);
      addLog(`Reference analysis failed: ${msg}`, "error");
    }
  }, [selectedBrand, ensureCampaignId, addLog, toast, processSSEStream]);

  const handleClearReference = useCallback(async () => {
    setReferenceUrl("");
    setReferenceStatus("idle");
    setReferenceAnalysis(null);
    setReferenceScreenshots([]);
    setReferenceError("");

    if (campaignId) {
      try {
        await fetch(`${API_BASE}/api/campaigns/${campaignId}/reference`, {
          method: "DELETE",
        });
      } catch {
        toast({ variant: "destructive", title: "Failed to clear reference" });
      }
    }
  }, [campaignId, toast]);

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
    loadingTimersRef.current.forEach(t => clearTimeout(t));
    loadingTimersRef.current.clear();
    setLoadingPhase({});
    const platforms = selectedPlatforms.length > 0 ? selectedPlatforms : ALL_PLATFORM_KEYS;
    const initialPhase: Record<string, { caption: boolean; image: boolean }> = {};
    platforms.forEach(p => { initialPhase[p] = { caption: false, image: false }; });
    setLoadingPhase(initialPhase);
    setGeneratedVariants(platforms.map(p => ({
      platform: p,
      aspectRatio: PLATFORM_LABELS[p].ratio,
      rawImageUrl: null,
      compositedImageUrl: null,
      caption: "",
      headlineText: null,
    })));
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms }),
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
            } catch {
              addLog("Received malformed data from server", "error");
            }
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
  }, [selectedBrand, selectedTemplate, campaignId, campaignName, briefText, selectedAssets, selectedPlatforms, remixId, toast, addLog, updateLastLog]);

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
      case "caption_ready": {
        const platform = data.platform as string;
        setLoadingPhase(prev => ({
          ...prev,
          [platform]: { ...prev[platform], caption: true },
        }));
        setGeneratedVariants(prev => prev.map(v =>
          v.platform === platform ? {
            ...v,
            caption: data.caption as string,
            headlineText: data.headline as string | null,
            aspectRatio: data.aspectRatio as string || v.aspectRatio,
          } : v
        ));
        addLog(`${PLATFORM_LABELS[platform]?.name || platform} caption ready`, "done");
        break;
      }
      case "image_ready": {
        const platform = data.platform as string;
        setGeneratedVariants(prev => prev.map(v =>
          v.platform === platform ? {
            ...v,
            rawImageUrl: data.rawImageUrl as string | null,
            compositedImageUrl: data.compositedImageUrl as string | null,
            aspectRatio: data.aspectRatio as string || v.aspectRatio,
          } : v
        ));
        setLoadingPhase(prev => ({
          ...prev,
          [platform]: { ...prev[platform], image: true },
        }));
        break;
      }
      case "variant_ready": {
        const platform = data.platform as string;
        setLoadingPhase(prev => ({
          ...prev,
          [platform]: { caption: true, image: true },
        }));
        setGeneratedVariants(prev => prev.map(v =>
          v.platform === platform ? {
            ...v,
            caption: data.caption as string,
            headlineText: data.headline as string | null,
            rawImageUrl: data.rawImageUrl as string | null,
            compositedImageUrl: data.compositedImageUrl as string | null,
            aspectRatio: data.aspectRatio as string || v.aspectRatio,
          } : v
        ));
        break;
      }
      case "complete": {
        const variants = data.variants as Array<Record<string, unknown>> | undefined;
        const cost = data.estimatedCost as number | undefined;
        if (variants) {
          setGeneratedVariants(variants.map(v => ({
            id: v.id as string | undefined,
            platform: v.platform as string,
            aspectRatio: v.aspectRatio as string,
            rawImageUrl: v.rawImageUrl as string | null,
            compositedImageUrl: v.compositedImageUrl as string | null,
            caption: v.caption as string,
            headlineText: v.headlineText as string | null,
            videoUrl: v.videoUrl as string | null ?? null,
            audioSource: v.audioSource as string | null ?? null,
            audioUrl: v.audioUrl as string | null ?? null,
            mergedVideoUrl: v.mergedVideoUrl as string | null ?? null,
          })));
        }
        if (cost) setEstimatedCost(cost);
        setLoadingPhase({});
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
      } catch {
        toast({ variant: "destructive", title: "Failed to save caption" });
      }
    }
  }, [campaignId, toast]);

  const handleRewrite = useCallback(async (text: string, instruction: string): Promise<string> => {
    const resp = await fetch(`${API_BASE}/api/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, instruction }),
    });
    if (!resp.ok) throw new Error("Rewrite failed");
    const data = await resp.json();
    return data.rewritten;
  }, []);

  const handleTextSelect = useCallback((platform: string, textarea: HTMLTextAreaElement) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const rawSelected = textarea.value.substring(start, end);

    if (!rawSelected.trim() || rawSelected.trim().length < 3) {
      setRewriteToolbar(null);
      return;
    }

    const rect = textarea.getBoundingClientRect();
    const parentRect = textarea.closest(".relative")?.getBoundingClientRect() || rect;
    setRewriteToolbar({
      platform,
      selectedText: rawSelected.trim(),
      selectionStart: start,
      selectionEnd: end,
      position: {
        top: rect.top - parentRect.top - 40,
        left: (rect.width) / 2,
      },
    });
  }, []);

  const handleHeadlineSave = useCallback(async (variantId: string | undefined, platform: string, newHeadline: string) => {
    if (!variantId || !campaignId) {
      throw new Error("Cannot save yet");
    }

    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${campaignId}/variants/${variantId}/headline`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headline: newHeadline }),
      });
      if (!resp.ok) throw new Error("Failed to save headline");
      const updated = await resp.json();
      setGeneratedVariants(prev => prev.map(v =>
        v.platform === platform ? {
          ...v,
          headlineText: newHeadline,
          compositedImageUrl: updated.compositedImageUrl,
          imageVersion: (v.imageVersion || 0) + 1,
        } : v
      ));
      toast({ title: "Headline updated", description: "Image re-composited with new text." });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to update headline" });
      throw err;
    }
  }, [campaignId, toast]);

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

  const handleGenerateVideo = useCallback(async () => {
    if (!campaignId) {
      toast({ variant: "destructive", title: "Generate images first" });
      return;
    }

    setIsGeneratingVideo(true);
    setVideoProgress({});
    addLog("Starting video generation...", "pending");

    try {
      const response = await fetch(`${API_BASE}/api/campaigns/${campaignId}/generate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orientations: ["landscape", "portrait"] }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start video generation");
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
              if (currentEvent === "video_progress") {
                const orientation = data.orientation as string;
                const status = data.status as string;
                setVideoProgress(prev => ({ ...prev, [orientation]: status }));
                if (status === "started") {
                  addLog(`Generating ${orientation} video...`, "pending");
                } else if (status === "completed") {
                  updateLastLog("done");
                  if (data.videoUrl) {
                    const matchingRatio = orientation === "landscape" ? "16:9" : "9:16";
                    setGeneratedVariants(prev => prev.map(v =>
                      v.aspectRatio === matchingRatio ? { ...v, videoUrl: data.videoUrl as string } : v
                    ));
                  }
                } else if (status === "failed") {
                  updateLastLog("error");
                }
              } else if (currentEvent === "complete") {
                addLog("Video generation complete!", "done");
              } else if (currentEvent === "error") {
                addLog(data.message as string, "error");
              } else if (currentEvent === "progress") {
                addLog(data.message as string, data.done ? "done" : "pending");
              }
            } catch {
              addLog("Received malformed data from server", "error");
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`Video generation failed: ${msg}`, "error");
      toast({ variant: "destructive", title: "Video Generation Failed", description: msg });
    } finally {
      setIsGeneratingVideo(false);
    }
  }, [campaignId, addLog, updateLastLog, toast]);

  const handleSetAudio = useCallback(async () => {
    if (!campaignId || !audioDialogVariant?.id) return;

    setIsGeneratingAudio(true);
    addLog(`Generating ${audioSource} audio...`, "pending");

    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${campaignId}/variants/${audioDialogVariant.id}/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: audioSource,
          prompt: audioPrompt,
          mode: audioMergeMode,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Audio generation failed" }));
        throw new Error(err.error || "Audio generation failed");
      }

      const updated = await resp.json();
      setGeneratedVariants(prev => prev.map(v =>
        v.id === audioDialogVariant.id
          ? { ...v, audioSource: updated.audioSource, audioUrl: updated.audioUrl, mergedVideoUrl: updated.mergedVideoUrl }
          : v
      ));

      updateLastLog("done");
      toast({ title: "Audio applied!", description: `${audioSource} audio added to variant.` });
      setAudioDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`Audio failed: ${msg}`, "error");
      toast({ variant: "destructive", title: "Audio Failed", description: msg });
    } finally {
      setIsGeneratingAudio(false);
    }
  }, [campaignId, audioDialogVariant, audioSource, audioPrompt, audioMergeMode, addLog, updateLastLog, toast]);

  const handleUploadAudio = useCallback(async (variantId: string, file: File) => {
    if (!campaignId) return;

    addLog("Uploading custom audio...", "pending");

    try {
      const formData = new FormData();
      formData.append("audio", file);
      formData.append("mode", audioMergeMode);

      const resp = await fetch(`${API_BASE}/api/campaigns/${campaignId}/variants/${variantId}/audio-upload`, {
        method: "POST",
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }

      const updated = await resp.json();
      setGeneratedVariants(prev => prev.map(v =>
        v.id === variantId
          ? { ...v, audioSource: updated.audioSource, audioUrl: updated.audioUrl, mergedVideoUrl: updated.mergedVideoUrl }
          : v
      ));

      updateLastLog("done");
      toast({ title: "Custom audio applied!" });
      setAudioDialogOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`Audio upload failed: ${msg}`, "error");
      toast({ variant: "destructive", title: "Upload Failed", description: msg });
    }
  }, [campaignId, audioMergeMode, addLog, updateLastLog, toast]);

  const handleVariantRegenerate = useCallback(async (variantId: string, platform: string) => {
    if (!campaignId || !variantId) return;
    const instruction = variantRefineText[platform] || "";
    
    setRegeneratingVariant(platform);
    addLog(`Regenerating ${PLATFORM_LABELS[platform]?.name || platform}...`, "pending");

    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${campaignId}/variants/${variantId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Regeneration failed" }));
        throw new Error(err.error || "Regeneration failed");
      }

      const updated = await resp.json();
      setGeneratedVariants(prev => prev.map(v =>
        v.platform === platform
          ? { ...v, rawImageUrl: updated.rawImageUrl, compositedImageUrl: updated.compositedImageUrl, id: updated.id, imageVersion: (v.imageVersion || 0) + 1 }
          : v
      ));

      setVariantRefineText(prev => ({ ...prev, [platform]: "" }));
      setVariantRefineOpen(prev => ({ ...prev, [platform]: false }));
      addLog(`${PLATFORM_LABELS[platform]?.name || platform} regenerated`, "done");
      toast({ title: "Variant regenerated" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      addLog(`Regeneration failed: ${msg}`, "error");
      toast({ variant: "destructive", title: "Regeneration failed", description: msg });
    } finally {
      setRegeneratingVariant(null);
    }
  }, [campaignId, variantRefineText, addLog, toast]);

  const extractHashtags = useCallback((caption: string): string[] => {
    const matches = caption.match(/#[a-zA-Z0-9_]+/g);
    return matches ? [...new Set(matches)] : [];
  }, []);

  const handleSaveHashtagSet = useCallback(async () => {
    if (!selectedBrand || !hashtagSetName.trim() || hashtagsToSave.length === 0) return;
    
    setSavingHashtags(true);
    try {
      const resp = await fetch(`${API_BASE}/api/hashtag-sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: selectedBrand,
          name: hashtagSetName.trim(),
          hashtags: hashtagsToSave.map(h => h.startsWith("#") ? h.slice(1) : h),
          category: "saved",
        }),
      });

      if (!resp.ok) throw new Error("Failed to save");

      toast({ title: "Hashtag set saved", description: `"${hashtagSetName}" saved with ${hashtagsToSave.length} hashtags.` });
      setHashtagDialogOpen(false);
      setHashtagSetName("");
      setHashtagsToSave([]);
    } catch {
      toast({ variant: "destructive", title: "Failed to save hashtag set" });
    } finally {
      setSavingHashtags(false);
    }
  }, [selectedBrand, hashtagSetName, hashtagsToSave, toast]);

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
                {(recommendedSubjects.length > 0 ? recommendedSubjects : (approvedAssets?.data?.filter(a => a.type === 'visual') || [])).slice(0, 6).map((asset, idx) => {
                  const isSelected = subjectAssetId === asset.id;
                  const isRecommended = idx < 3 && recommendedSubjects.length > 0;
                  return (
                    <div
                      key={asset.id}
                      onClick={() => !isGenerating && setSubjectAssetId(isSelected ? null : asset.id)}
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
                {(recommendedStyles.length > 0 ? recommendedStyles : (approvedAssets?.data?.filter(a => a.type === 'visual') || [])).slice(0, 6).map((asset, idx) => {
                  const isSelected = styleAssetIds.includes(asset.id);
                  const isRecommended = idx < 3 && recommendedStyles.length > 0;
                  return (
                    <div
                      key={asset.id}
                      onClick={() => !isGenerating && toggleStyleAsset(asset.id)}
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
                        onClick={() => !isGenerating && toggleContextAsset(brief.id)}
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
                onClick={() => setPacketPreviewOpen(!packetPreviewOpen)}
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

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Link size={12} className="text-primary" />
              Reference URL
            </label>
            {referenceStatus === "idle" || referenceStatus === "error" ? (
              <>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="https://example.com"
                    className="bg-background border-border text-sm flex-1"
                    value={referenceUrl}
                    onChange={e => setReferenceUrl(e.target.value)}
                    disabled={isGenerating}
                    onKeyDown={e => { if (e.key === "Enter") handleAnalyzeUrl(); }}
                  />
                  <Button
                    size="icon"
                    className="h-9 w-9 bg-primary hover:bg-primary/90 shrink-0"
                    onClick={handleAnalyzeUrl}
                    disabled={!referenceUrl.trim() || isGenerating || !selectedBrand}
                  >
                    <Search size={14} />
                  </Button>
                </div>
                {referenceStatus === "error" && referenceError && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
                    <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[11px] text-red-400">{referenceError}</p>
                      <button
                        className="text-[11px] text-red-400 underline mt-1 hover:text-red-300"
                        onClick={handleAnalyzeUrl}
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )}
                <button
                  className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating || !selectedBrand}
                >
                  <Upload size={10} />
                  Or upload screenshot
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadScreenshot(file);
                    e.target.value = "";
                  }}
                />
              </>
            ) : referenceStatus === "capturing" ? (
              <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/20">
                <Loader2 size={14} className="text-amber-400 animate-spin" />
                <span className="text-xs text-amber-400">Capturing page...</span>
              </div>
            ) : referenceStatus === "analyzing" ? (
              <div className="space-y-2">
                {referenceScreenshots.length > 0 && (
                  <div className="w-full h-16 rounded-md overflow-hidden border border-border/50 bg-muted/30">
                    <img
                      src={`${API_BASE}${referenceScreenshots[0].url}`}
                      alt="Reference"
                      className="w-full h-full object-cover object-top opacity-60"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 p-2 rounded-md bg-blue-500/5 border border-blue-500/20">
                  <Loader2 size={14} className="text-blue-400 animate-spin" />
                  <span className="text-xs text-blue-400">Analyzing reference...</span>
                </div>
              </div>
            ) : referenceStatus === "done" ? (
              <div className="space-y-2">
                {referenceScreenshots.length > 0 && (
                  <div className="w-full h-16 rounded-md overflow-hidden border border-green-500/20 bg-muted/30 relative group">
                    <img
                      src={`${API_BASE}${referenceScreenshots[0].url}`}
                      alt="Reference"
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between p-2 rounded-md bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center gap-2">
                    <Check size={12} className="text-green-400" />
                    <span className="text-xs text-green-400 font-medium">Analyzed ✓</span>
                  </div>
                  <button
                    className="text-muted-foreground hover:text-red-400 transition-colors"
                    onClick={handleClearReference}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {referenceAnalysis?.visual_mood && (
                  <p className="text-[10px] text-muted-foreground leading-tight truncate" title={referenceAnalysis.visual_mood}>
                    Mood: {referenceAnalysis.visual_mood}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Context Brief</label>
            <Select onValueChange={(val) => {
              const brief = briefs?.data?.find(b => b.id === val);
              if(brief) setBriefText(brief.content || "");
            }} disabled={!selectedBrand || !briefs?.data?.length || isGenerating}>
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
              onChange={e => setBriefText(e.target.value)}
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
                      setSelectedPlatforms(prev =>
                        active
                          ? prev.filter(p => p !== pk)
                          : [...prev, pk]
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
                onClick={() => setSelectedPlatforms(ALL_PLATFORM_KEYS)}
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
                    onClick={handleGenerate}
                    disabled={isGenerating || isGeneratingVideo || !!generateDisabledReason || selectedPlatforms.length === 0}
                  >
                    {isGenerating ? (
                      <><Loader2 size={16} className="mr-2 animate-spin" /> Generating...</>
                    ) : (
                      <><Play size={16} className="mr-2" /> Generate Campaign</>
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
            onClick={handleGenerateVideo}
            disabled={isGenerating || isGeneratingVideo || !campaignId || generatedVariants.length === 0}
          >
            {isGeneratingVideo ? (
              <><Loader2 size={16} className="mr-2 animate-spin" /> Generating Video...</>
            ) : (
              <><Video size={16} className="mr-2 text-primary" /> Generate Video</>
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
                  onDownloadVariant={handleDownloadVariant}
                  onCaptionChange={handleCaptionChange}
                  onTextSelect={handleTextSelect}
                  onRewrite={handleRewrite}
                  onHeadlineSave={handleHeadlineSave}
                  onVariantRegenerate={handleVariantRegenerate}
                  extractHashtags={extractHashtags}
                  onRewriteToolbarClose={() => setRewriteToolbar(null)}
                  onSetVariantRefineOpen={setVariantRefineOpen}
                  onSetVariantRefineText={setVariantRefineText}
                  onOpenAudioDialog={(v) => {
                    setAudioDialogVariant(v);
                    setAudioSource("music");
                    setAudioPrompt("");
                    setAudioDialogOpen(true);
                  }}
                  onOpenHashtagDialog={(hashtags) => {
                    setHashtagsToSave(hashtags);
                    setHashtagDialogOpen(true);
                  }}
                />
              ))
            ) : !selectedBrand ? (
              <div className="col-span-full">
                <EmptyState
                  icon={Sparkles}
                  title="Start a campaign"
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

      <ActivityPanel
        activityLog={activityLog}
        estimatedCost={estimatedCost}
        onSaveDraft={handleSaveDraft}
        isSaving={createCampaignMutation.isPending}
        onDownloadAll={handleDownloadAll}
        onSchedule={() => setScheduleModalOpen(true)}
        onSubmitForReview={handleSubmitForReview}
        hasVariants={generatedVariants.length > 0}
        campaignId={campaignId}
        isGenerating={isGenerating}
      />

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

      <HashtagSetDialog
        open={hashtagDialogOpen}
        onOpenChange={setHashtagDialogOpen}
        hashtagSetName={hashtagSetName}
        onNameChange={setHashtagSetName}
        hashtagsToSave={hashtagsToSave}
        onRemoveHashtag={(index) => setHashtagsToSave(prev => prev.filter((_, idx) => idx !== index))}
        onSave={handleSaveHashtagSet}
        isSaving={savingHashtags}
      />

      <AudioSettingsDialog
        open={audioDialogOpen}
        onOpenChange={setAudioDialogOpen}
        audioSource={audioSource}
        onSourceChange={(v) => setAudioSource(v as "music" | "sfx" | "mute")}
        audioPrompt={audioPrompt}
        onPromptChange={setAudioPrompt}
        audioMergeMode={audioMergeMode}
        onMergeModeChange={(v) => setAudioMergeMode(v as "replace" | "mix")}
        onApply={handleSetAudio}
        onUploadAudio={(file) => {
          if (audioDialogVariant?.id) {
            handleUploadAudio(audioDialogVariant.id, file);
          }
        }}
        isGenerating={isGeneratingAudio}
      />
    </div>
  );
}
