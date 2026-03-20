import { useState, useEffect, useMemo, useCallback } from "react";
import { MoreHorizontal, MessageSquare, Clock, Eye, CheckCircle, Send, X, ChevronRight, ThumbsUp, ThumbsDown, Image as ImageIcon, CalendarIcon, RefreshCw } from "lucide-react";
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
    } else {
      setVariants([]);
    }
  }, [expandedCampaignId, fetchVariants]);

  const handleStatusChange = (campaignId: string, newStatus: string) => {
    updateCampaign.mutate(
      { id: campaignId, data: { status: newStatus } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
          toast({ title: `Campaign moved to ${newStatus.replace(/_/g, " ")}` });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Failed to update", description: err.message });
        },
      }
    );
  };

  const handleApprove = () => {
    if (!expandedCampaignId) return;
    updateCampaign.mutate(
      { id: expandedCampaignId, data: { status: "approved", reviewedBy: "current_user", reviewComment: "Approved" } as any },
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
      { id: expandedCampaignId, data: { status: "draft", reviewedBy: "current_user", reviewComment: rejectComment } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
          toast({ title: "Campaign returned with feedback" });
          setExpandedCampaignId(null);
        },
      }
    );
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

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 w-full">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Review Queue</h1>
          <p className="text-muted-foreground mt-1">Approve and provide feedback on generated campaigns.</p>
        </div>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-[180px] bg-card border-border">
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

      <div className="flex-1 flex gap-6 overflow-hidden">
        <div className={`flex gap-6 overflow-x-auto pb-4 hide-scrollbar transition-all duration-300 ${expandedCampaignId ? 'w-[340px] shrink-0' : 'flex-1'}`}>
          {COLUMNS.map(col => {
            const items = columnCampaigns[col.id] || [];
            return (
              <div key={col.id} className={`${expandedCampaignId ? 'w-[300px]' : 'w-[320px]'} shrink-0 flex flex-col bg-background rounded-xl border border-border`}>
                <div className={`p-4 border-b ${col.color} border-t-4 rounded-t-xl bg-card/50 flex justify-between items-center`}>
                  <h3 className="font-bold text-foreground uppercase tracking-wide text-sm">{col.title}</h3>
                  <Badge variant="secondary" className="bg-muted text-muted-foreground">{items.length}</Badge>
                </div>

                <div className="flex-1 p-3 space-y-3 overflow-y-auto">
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
                          className={`bg-card border p-4 rounded-lg shadow-sm cursor-pointer transition-all group ${isExpanded ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/50'}`}
                        >
                          <div className="flex justify-between items-start mb-3">
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

                          <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border/50">
                            <div className="flex items-center gap-1">
                              <Clock size={12} />
                              {new Date(campaign.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </div>
                            <div className="flex gap-1">
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
          <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden animate-in slide-in-from-right-5 duration-200">
            <div className="p-4 border-b border-border bg-background/50 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-bold text-lg text-foreground">{expandedCampaign.name}</h2>
                <div className="flex items-center gap-2 mt-1">
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
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedCampaignId(null)}>
                <X size={16} />
              </Button>
            </div>

            {expandedCampaign.briefText && (
              <div className="px-4 py-3 border-b border-border bg-muted/30">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Brief</span>
                <p className="text-sm text-foreground mt-1">{expandedCampaign.briefText}</p>
              </div>
            )}

            {expandedCampaign.reviewComment && (
              <div className="px-4 py-3 border-b border-border bg-amber-500/5">
                <span className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1">
                  <MessageSquare size={10} /> Previous Feedback
                </span>
                <p className="text-sm text-foreground mt-1">{expandedCampaign.reviewComment}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
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
                    return (
                      <div key={variant.id} className="bg-background border border-border rounded-lg overflow-hidden">
                        <div className="p-2.5 border-b border-border flex items-center justify-between bg-card/50">
                          <div className="flex items-center gap-2">
                            <PlatformIcon platform={label.icon} />
                            <span className="font-semibold text-xs">{label.name}</span>
                            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">{variant.aspectRatio}</span>
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

                        <div className="p-3 space-y-2">
                          {variant.headlineText && (
                            <div className="bg-primary/5 border border-primary/20 rounded px-2 py-1.5">
                              <span className="text-[10px] text-primary uppercase tracking-wider font-semibold">Headline</span>
                              <p className="text-xs font-bold text-foreground mt-0.5">{variant.headlineText}</p>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground line-clamp-4">{variant.caption}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border bg-background shrink-0 space-y-3">
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

              <div className="flex gap-2">
                {(expandedCampaign.status === "in_review" || expandedCampaign.status === "pending_review") && (
                  <>
                    {!showRejectInput ? (
                      <>
                        <Button
                          variant="outline"
                          className="flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => setShowRejectInput(true)}
                        >
                          <ThumbsDown size={14} className="mr-2" /> Request Changes
                        </Button>
                        <Button
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                          onClick={handleApprove}
                        >
                          <ThumbsUp size={14} className="mr-2" /> Approve
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
                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
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
