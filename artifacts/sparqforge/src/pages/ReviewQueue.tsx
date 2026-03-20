import { useState, useEffect, useMemo } from "react";
import { MoreHorizontal, MessageSquare, Clock, Eye, CheckCircle, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetBrands, useGetCampaigns, useUpdateCampaign } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const COLUMNS = [
  { id: "pending_review", title: "Pending Review", color: "border-t-warning" },
  { id: "in_review", title: "In Review", color: "border-t-primary" },
  { id: "approved", title: "Approved", color: "border-t-success" },
  { id: "scheduled", title: "Scheduled", color: "border-t-muted-foreground" },
];

export default function ReviewQueue() {
  const { data: brands } = useGetBrands();
  const { data: campaigns, isLoading } = useGetCampaigns();
  const updateCampaign = useUpdateCampaign();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [brandFilter, setBrandFilter] = useState("all");

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

      <div className="flex-1 flex gap-6 overflow-x-auto pb-4 hide-scrollbar">
        {COLUMNS.map(col => {
          const items = columnCampaigns[col.id] || [];
          return (
            <div key={col.id} className="w-[320px] shrink-0 flex flex-col bg-background rounded-xl border border-border">
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
                    return (
                      <div key={campaign.id} className="bg-card border border-border p-4 rounded-lg shadow-sm hover:border-primary/50 cursor-pointer transition-colors group">
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
                          <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal size={14} />
                          </button>
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
                                onClick={(e) => { e.stopPropagation(); handleStatusChange(campaign.id, "scheduled"); }}
                              >
                                <Send size={12} className="mr-1" /> Schedule
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
    </div>
  );
}
