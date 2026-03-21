import { useState, useEffect, useMemo, useCallback } from "react";
import { MoreHorizontal, MessageSquare, Clock, Eye, CheckCircle, Send, X, ChevronRight, ThumbsUp, ThumbsDown, Image as ImageIcon, CalendarIcon, RefreshCw, Check, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetBrands, useGetCampaigns, useUpdateCampaign } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { TikTokPreviewFrame } from "@/components/ui/tiktok-preview-frame";
import { ScheduleModal } from "@/components/ScheduleModal";
import { useLocation } from "wouter";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface Variant {
  id: string;
  campaignId: string;
  platform: string;
  aspectRatio: string;
  rawImageUrl: string | null;
  compositedImageUrl: string | null;
  caption: string;
  headlineText: string | null;
  status: string;
}

const COLUMNS = [
  { id: "pending_review", title: "Pending Review", color: "border-t-warning" },
  { id: "in_review", title: "In Review", color: "border-t-primary" },
  { id: "approved", title: "Approved", color: "border-t-success" },
  { id: "scheduled", title: "Scheduled", color: "border-t-muted-foreground" },
];

const PLATFORM_LABELS: Record<string, { name: string; icon: string }> = {
  instagram_feed: { name: "Instagram Feed", icon: "instagram" },
  instagram_story: { name: "Instagram Story", icon: "instagram" },
  twitter: { name: "X (Twitter)", icon: "twitter" },
  linkedin: { name: "LinkedIn", icon: "linkedin" },
  tiktok: { name: "TikTok", icon: "tiktok" },
};

export default function ReviewQueue() {
  const { data: brands } = useGetBrands();
  const { data: campaigns, isLoading } = useGetCampaigns();
  const updateCampaign = useUpdateCampaign();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [brandFilter, setBrandFilter] = useState("all");
  const [, setLocation] = useLocation();

  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [variantRejectId, setVariantRejectId] = useState<string | null>(null);
  const [variantRejectComment, setVariantRejectComment] = useState("");

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleCampaign, setScheduleCampaign] = useState<{ id: string; name: string } | null>(null);

  const filteredCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return campaigns.filter(c => {
      if (brandFilter !== "all" && c.brandId !== brandFilter) return false;
      return c.status !== "draft";
    });
  }, [campaigns, brandFilter]);

  const columnCampaigns = useMemo(() => {
    const map: Record<string, typeof filteredCampaigns> = {};
    for (const col of COLUMNS) {
      map[col.id] = filteredCampaigns.filter(c => c.status === col.id);
    }
    return map;
  }, [filteredCampaigns]);

  const getBrand = (brandId: string) => brands?.find(b => b.id === brandId);

  const expandedCampaign = useMemo(() => {
    if (!expandedCampaignId || !campaigns) return null;
    return campaigns.find(c => c.id === expandedCampaignId) || null;
  }, [expandedCampaignId, campaigns]);

  const fetchVariants = useCallback(async (campaignId: string) => {
    setLoadingVariants(true);
    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${campaignId}/variants`);
      if (resp.ok) {
        const data = await resp.json();
        setVariants(data);
      }
    } catch {} finally {
      setLoadingVariants(false);
    }
  }, []);

  useEffect(() => {
    if (expandedCampaignId) {
      fetchVariants(expandedCampaignId);
      setRejectComment("");
      setShowRejectInput(false);
      setVariantRejectId(null);
      setVariantRejectComment("");
    } else {
      setVariants([]);
    }
  }, [expandedCampaignId, fetchVariants]);

  const handleStatusChange = (campaignId: string, newStatus: string) => {
    updateCampaign.mutate(
      { id: campaignId, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
          toast({ title: `Campaign moved to ${newStatus.replace(/_/g, " ")}` });
        },
        onError: (err: Error) => {
          toast({ variant: "destructive", title: "Failed to update", description: err.message });
        },
      }
    );
  };

  const handleApprove = () => {
    if (!expandedCampaignId) return;
    updateCampaign.mutate(
      { id: expandedCampaignId, data: { status: "approved", reviewedBy: "current_user", reviewComment: "Approved" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
          toast({ title: "Campaign approved!" });
          setExpandedCampaignId(null);
        },
      }
    );
  };

  const handleReject = () => {
    if (!expandedCampaignId || !rejectComment.trim()) {
      toast({ variant: "destructive", title: "Please provide feedback" });
      return;
    }
    updateCampaign.mutate(
      { id: expandedCampaignId, data: { status: "draft", reviewedBy: "current_user", reviewComment: rejectComment } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
          toast({ title: "Campaign returned with feedback" });
          setExpandedCampaignId(null);
        },
      }
    );
  };

  const handleVariantApprove = async (variantId: string) => {
    if (!expandedCampaignId) return;
    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${expandedCampaignId}/variants/${variantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", reviewerComment: "Approved" }),
      });
      if (resp.ok) {
        setVariants(prev => prev.map(v => v.id === variantId ? { ...v, status: "approved" } : v));
        toast({ title: "Variant approved" });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to approve variant" });
    }
  };

  const handleVariantReject = async (variantId: string) => {
    if (!expandedCampaignId || !variantRejectComment.trim()) {
      toast({ variant: "destructive", title: "Please provide rejection feedback" });
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${expandedCampaignId}/variants/${variantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", reviewerComment: variantRejectComment }),
      });
      if (resp.ok) {
        setVariants(prev => prev.map(v => v.id === variantId ? { ...v, status: "rejected" } : v));
        toast({ title: "Variant rejected with feedback" });
        setVariantRejectId(null);
        setVariantRejectComment("");
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to reject variant" });
    }
  };

  const handleScheduleClick = (campaign: { id: string; name: string }) => {
    setScheduleCampaign(campaign);
    setScheduleModalOpen(true);
  };

  const handleRemix = (campaign: any) => {
    const params = new URLSearchParams();
    params.set("remix", campaign.id);
    setLocation(`/?${params.toString()}`);
  };

  const variantStatusSummary = useMemo(() => {
    if (variants.length === 0) return null;
    const approved = variants.filter(v => v.status === "approved").length;
    const rejected = variants.filter(v => v.status === "rejected").length;
    const pending = variants.length - approved - rejected;
    return { approved, rejected, pending, total: variants.length };
  }, [variants]);

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 sm:p-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 shrink-0 gap-3">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-foreground">Review Queue</h1>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">Approve and provide feedback on generated campaigns.</p>
        </div>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-full sm:w-[180px] bg-card border-border">
            <SelectValue placeholder="All Brands" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Brands</SelectItem>
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

      <div className="flex-1 flex flex-col md:flex-row gap-4 md:gap-6 overflow-hidden">
        <div className={`flex flex-col md:flex-row gap-4 md:gap-6 overflow-x-auto overflow-y-auto md:overflow-y-hidden pb-4 hide-scrollbar transition-all duration-300 ${expandedCampaignId ? 'md:w-[340px] md:shrink-0 max-h-[40vh] md:max-h-none' : 'flex-1'}`}>
          {COLUMNS.map(col => {
            const items = columnCampaigns[col.id] || [];
            return (
              <div key={col.id} className={`${expandedCampaignId ? 'md:w-[300px]' : 'md:w-[320px]'} shrink-0 flex flex-col bg-background rounded-xl border border-border min-w-0`}>
                <div className={`p-3 sm:p-4 border-b ${col.color} border-t-4 rounded-t-xl bg-card/50 flex justify-between items-center`}>
                  <h3 className="font-bold text-foreground uppercase tracking-wide text-xs sm:text-sm">{col.title}</h3>
                  <Badge variant="secondary" className="bg-muted text-muted-foreground">{items.length}</Badge>
                </div>

                <div className="flex-1 p-2 sm:p-3 space-y-2 sm:space-y-3 overflow-y-auto">
                  {isLoading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="bg-card border border-border p-4 rounded-lg animate-pulse h-32" />
                    ))
                  ) : items.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      No campaigns
                    </div>
                  ) : (
                    items.map(campaign => {
                      const brand = getBrand(campaign.brandId);
                      const isExpanded = expandedCampaignId === campaign.id;
                      return (
                        <div
                          key={campaign.id}
                          onClick={() => setExpandedCampaignId(isExpanded ? null : campaign.id)}
                          className={`bg-card border p-3 sm:p-4 rounded-lg shadow-sm cursor-pointer transition-all group ${isExpanded ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/50'}`}
                        >
                          <div className="flex justify-between items-start mb-2 sm:mb-3">
                            {brand && (
                              <Badge
                                variant="outline"
                                className="text-[10px] bg-background"
                                style={{ borderColor: `${brand.colorPrimary}40`, color: brand.colorPrimary }}
                              >
                                {brand.name}
                              </Badge>
                            )}
                            <ChevronRight size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </div>

                          <h4 className="font-semibold text-sm text-foreground mb-2">{campaign.name}</h4>

                          {campaign.briefText && (
                            <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{campaign.briefText}</p>
                          )}

                          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 sm:pt-3 border-t border-border/50">
                            <div className="flex items-center gap-1">
                              <Clock size={12} />
                              {new Date(campaign.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </div>
                            <div className="flex gap-1 flex-wrap">
                              {col.id === "pending_review" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs text-primary hover:text-primary"
                                  onClick={(e) => { e.stopPropagation(); handleStatusChange(campaign.id, "in_review"); }}
                                >
                                  <Eye size={12} className="mr-1" /> Review
                                </Button>
                              )}
                              {col.id === "in_review" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs text-success hover:text-success"
                                  onClick={(e) => { e.stopPropagation(); handleStatusChange(campaign.id, "approved"); }}
                                >
                                  <CheckCircle size={12} className="mr-1" /> Approve
                                </Button>
                              )}
                              {col.id === "approved" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs text-muted-foreground"
                                  onClick={(e) => { e.stopPropagation(); handleScheduleClick({ id: campaign.id, name: campaign.name }); }}
                                >
                                  <Send size={12} className="mr-1" /> Schedule
                                </Button>
                              )}
                              {(col.id === "approved" || col.id === "scheduled") && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs text-muted-foreground"
                                  onClick={(e) => { e.stopPropagation(); handleRemix(campaign); }}
                                >
                                  <RefreshCw size={12} className="mr-1" /> Remix
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {expandedCampaignId && expandedCampaign && (
          <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden animate-in slide-in-from-right-5 duration-200 min-h-[50vh] md:min-h-0">
            <div className="p-3 sm:p-4 border-b border-border bg-background/50 flex items-center justify-between shrink-0">
              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-base sm:text-lg text-foreground truncate">{expandedCampaign.name}</h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {(() => {
                    const brand = getBrand(expandedCampaign.brandId);
                    return brand ? (
                      <Badge variant="outline" className="text-[10px]" style={{ borderColor: `${brand.colorPrimary}40`, color: brand.colorPrimary }}>
                        {brand.name}
                      </Badge>
                    ) : null;
                  })()}
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(expandedCampaign.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setExpandedCampaignId(null)}>
                <X size={16} />
              </Button>
            </div>

            {expandedCampaign.briefText && (
              <div className="px-3 sm:px-4 py-3 border-b border-border bg-muted/30">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Brief</span>
                <p className="text-sm text-foreground mt-1">{expandedCampaign.briefText}</p>
              </div>
            )}

            {expandedCampaign.reviewComment && (
              <div className="px-3 sm:px-4 py-3 border-b border-border bg-amber-500/5">
                <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1">
                  <MessageSquare size={10} /> Previous Feedback
                </span>
                <p className="text-sm text-foreground mt-1">{expandedCampaign.reviewComment}</p>
              </div>
            )}

            {variantStatusSummary && (
              <div className="px-3 sm:px-4 py-2 border-b border-border bg-background/30 flex items-center gap-3 text-xs shrink-0">
                <span className="text-muted-foreground font-medium">Variants:</span>
                {variantStatusSummary.approved > 0 && (
                  <span className="flex items-center gap-1 text-green-400">
                    <Check size={12} /> {variantStatusSummary.approved} approved
                  </span>
                )}
                {variantStatusSummary.rejected > 0 && (
                  <span className="flex items-center gap-1 text-red-400">
                    <XCircle size={12} /> {variantStatusSummary.rejected} rejected
                  </span>
                )}
                {variantStatusSummary.pending > 0 && (
                  <span className="text-muted-foreground">{variantStatusSummary.pending} pending</span>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              {loadingVariants ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-background border border-border rounded-lg h-64 animate-pulse" />
                  ))}
                </div>
              ) : variants.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <ImageIcon size={48} className="mb-4 opacity-20" />
                  <p className="text-sm">No variants generated yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {variants.map(variant => {
                    const label = PLATFORM_LABELS[variant.platform] || { name: variant.platform, icon: "twitter" };
                    const imageUrl = variant.compositedImageUrl || variant.rawImageUrl;
                    const isReviewable = expandedCampaign.status === "in_review" || expandedCampaign.status === "pending_review";
                    const isRejectingThis = variantRejectId === variant.id;

                    return (
                      <div key={variant.id} className={`bg-background border rounded-lg overflow-hidden transition-colors ${
                        variant.status === "approved" ? "border-green-500/40" :
                        variant.status === "rejected" ? "border-red-500/40" :
                        "border-border"
                      }`}>
                        <div className="p-2 sm:p-2.5 border-b border-border flex items-center justify-between bg-card/50">
                          <div className="flex items-center gap-2">
                            <PlatformIcon platform={label.icon} />
                            <span className="font-semibold text-xs">{label.name}</span>
                            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">{variant.aspectRatio}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {variant.status === "approved" && (
                              <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-[10px]">
                                <Check size={10} className="mr-0.5" /> Approved
                              </Badge>
                            )}
                            {variant.status === "rejected" && (
                              <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">
                                <XCircle size={10} className="mr-0.5" /> Rejected
                              </Badge>
                            )}
                          </div>
                        </div>

                        {variant.platform === "tiktok" ? (
                          <div className="flex justify-center py-3">
                            <TikTokPreviewFrame
                              imageUrl={imageUrl ? `${API_BASE}${imageUrl}` : undefined}
                              caption={variant.caption}
                            />
                          </div>
                        ) : imageUrl ? (
                          <img
                            src={`${API_BASE}${imageUrl}`}
                            alt={`${label.name} variant`}
                            className="w-full h-auto"
                          />
                        ) : (
                          <div className="aspect-video bg-muted/30 flex items-center justify-center">
                            <ImageIcon size={32} className="text-muted-foreground opacity-20" />
                          </div>
                        )}

                        <div className="p-2 sm:p-3 space-y-2">
                          {variant.headlineText && (
                            <div className="bg-primary/5 border border-primary/20 rounded px-2 py-1.5">
                              <span className="text-[10px] text-primary uppercase tracking-wider font-semibold">Headline</span>
                              <p className="text-xs font-bold text-foreground mt-0.5">{variant.headlineText}</p>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground line-clamp-4">{variant.caption}</p>

                          {isReviewable && variant.status !== "approved" && variant.status !== "rejected" && (
                            <>
                              {isRejectingThis ? (
                                <div className="space-y-2 pt-2 border-t border-border">
                                  <Textarea
                                    placeholder="Why is this variant being rejected? (required)"
                                    value={variantRejectComment}
                                    onChange={e => setVariantRejectComment(e.target.value)}
                                    className="bg-card border-border text-xs min-h-[60px]"
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs border-border"
                                      onClick={() => { setVariantRejectId(null); setVariantRejectComment(""); }}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs flex-1 bg-red-600 hover:bg-red-700 text-white"
                                      onClick={() => handleVariantReject(variant.id)}
                                      disabled={!variantRejectComment.trim()}
                                    >
                                      <XCircle size={12} className="mr-1" /> Reject
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2 pt-2 border-t border-border">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                                    onClick={() => setVariantRejectId(variant.id)}
                                  >
                                    <ThumbsDown size={12} className="mr-1" /> Reject
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs flex-1 bg-green-600 hover:bg-green-700 text-white"
                                    onClick={() => handleVariantApprove(variant.id)}
                                  >
                                    <ThumbsUp size={12} className="mr-1" /> Approve
                                  </Button>
                                </div>
                              )}
                            </>
                          )}

                          {(variant.status === "approved" || variant.status === "rejected") && isReviewable && (
                            <div className="pt-2 border-t border-border">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px] text-muted-foreground w-full"
                                onClick={async () => {
                                  try {
                                    const resp = await fetch(`${API_BASE}/api/campaigns/${expandedCampaignId}/variants/${variant.id}`, {
                                      method: "PUT",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ status: "generated" }),
                                    });
                                    if (resp.ok) {
                                      setVariants(prev => prev.map(v => v.id === variant.id ? { ...v, status: "generated" } : v));
                                      toast({ title: "Variant reset to pending" });
                                    }
                                  } catch {
                                    toast({ variant: "destructive", title: "Failed to reset variant" });
                                  }
                                }}
                              >
                                Reset to Pending
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-3 sm:p-4 border-t border-border bg-background shrink-0 space-y-3">
              {showRejectInput && (
                <div className="space-y-2">
                  <Textarea
                    placeholder="Provide feedback for the creator..."
                    value={rejectComment}
                    onChange={e => setRejectComment(e.target.value)}
                    className="bg-card border-border text-sm min-h-[80px]"
                  />
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                {(expandedCampaign.status === "in_review" || expandedCampaign.status === "pending_review") && (
                  <>
                    {!showRejectInput ? (
                      <>
                        <Button
                          variant="outline"
                          className="flex-1 min-w-[120px] border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => setShowRejectInput(true)}
                        >
                          <ThumbsDown size={14} className="mr-2" /> Request Changes
                        </Button>
                        <Button
                          className="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700 text-white"
                          onClick={handleApprove}
                        >
                          <ThumbsUp size={14} className="mr-2" /> Approve All
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          className="border-border"
                          onClick={() => { setShowRejectInput(false); setRejectComment(""); }}
                        >
                          Cancel
                        </Button>
                        <Button
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                          onClick={handleReject}
                          disabled={!rejectComment.trim()}
                        >
                          <ThumbsDown size={14} className="mr-2" /> Return with Feedback
                        </Button>
                      </>
                    )}
                  </>
                )}
                {expandedCampaign.status === "approved" && (
                  <Button
                    className="flex-1 min-w-[120px] bg-primary hover:bg-primary/90 text-primary-foreground"
                    onClick={() => handleScheduleClick({ id: expandedCampaign.id, name: expandedCampaign.name })}
                  >
                    <CalendarIcon size={14} className="mr-2" /> Schedule
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground"
                  onClick={() => handleRemix(expandedCampaign)}
                >
                  <RefreshCw size={14} className="mr-2" /> Remix
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {scheduleCampaign && (
        <ScheduleModal
          open={scheduleModalOpen}
          onOpenChange={setScheduleModalOpen}
          campaignId={scheduleCampaign.id}
          campaignName={scheduleCampaign.name}
          onScheduled={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
            setExpandedCampaignId(null);
          }}
        />
      )}
    </div>
  );
}
