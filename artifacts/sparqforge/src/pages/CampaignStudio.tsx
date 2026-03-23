import { useState, useCallback, useRef, useEffect } from "react";
import { VariantGrid } from "@/components/campaign-studio/VariantGrid";
import { CampaignConfigPanel } from "@/components/campaign-studio/CampaignConfigPanel";
import {
  useGetBrands,
  useGetTemplates,
  useGetAssets,
  useCreateCampaign,
  type Asset
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ScheduleModal } from "@/components/ScheduleModal";
import { useSearch } from "wouter";
import { HashtagSetDialog } from "@/components/campaign-studio/HashtagSetDialog";
import { AudioSettingsDialog } from "@/components/campaign-studio/AudioSettingsDialog";
import { ActivityPanel } from "@/components/campaign-studio/ActivityPanel";
import { useBrandReadiness } from "@/hooks/useBrandReadiness";
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
      
      <CampaignConfigPanel
        remixId={remixId}
        campaignName={campaignName}
        onCampaignNameChange={setCampaignName}
        brands={brands}
        selectedBrand={selectedBrand}
        onBrandChange={(v) => { setSelectedBrand(v); setSelectedTemplate(""); }}
        templates={templates}
        selectedTemplate={selectedTemplate}
        onTemplateChange={(v) => { setSelectedTemplate(v); setDuplicateDismissed(false); }}
        subjectAssetId={subjectAssetId}
        onSubjectAssetChange={setSubjectAssetId}
        recommendedSubjects={recommendedSubjects}
        approvedVisualAssets={approvedAssets?.data?.filter(a => a.type === 'visual') || []}
        styleAssetIds={styleAssetIds}
        onToggleStyleAsset={toggleStyleAsset}
        recommendedStyles={recommendedStyles}
        contextAssetIds={contextAssetIds}
        onToggleContextAsset={toggleContextAsset}
        briefs={briefs}
        compositingAssets={compositingAssets}
        packetPreviewOpen={packetPreviewOpen}
        onPacketPreviewToggle={() => setPacketPreviewOpen(!packetPreviewOpen)}
        approvedAssets={approvedAssets}
        referenceUrl={referenceUrl}
        onReferenceUrlChange={setReferenceUrl}
        referenceStatus={referenceStatus}
        referenceError={referenceError}
        referenceAnalysis={referenceAnalysis}
        referenceScreenshots={referenceScreenshots}
        onAnalyzeUrl={handleAnalyzeUrl}
        onUploadScreenshot={handleUploadScreenshot}
        onClearReference={handleClearReference}
        briefText={briefText}
        onBriefTextChange={setBriefText}
        onBriefSelect={(val) => {
          const brief = briefs?.data?.find(b => b.id === val);
          if (brief) setBriefText(brief.content || "");
        }}
        selectedPlatforms={selectedPlatforms}
        onSelectedPlatformsChange={setSelectedPlatforms}
        onGenerate={handleGenerate}
        onGenerateVideo={handleGenerateVideo}
        isGenerating={isGenerating}
        isGeneratingVideo={isGeneratingVideo}
        generateDisabledReason={generateDisabledReason}
        budgetStatus={budgetStatus}
        estimatedCost={estimatedCost}
        campaignId={campaignId}
        hasVariants={generatedVariants.length > 0}
      />

      <VariantGrid
        refineText={refineText}
        onRefineTextChange={setRefineText}
        onRefineSubmit={() => {}}
        isGenerating={isGenerating}
        generatedVariants={generatedVariants}
        selectedBrand={selectedBrand}
        duplicateInfo={duplicateInfo}
        duplicateDismissed={duplicateDismissed}
        onDismissDuplicate={() => setDuplicateDismissed(true)}
        loadingPhase={loadingPhase}
        selectedPlatforms={selectedPlatforms}
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
