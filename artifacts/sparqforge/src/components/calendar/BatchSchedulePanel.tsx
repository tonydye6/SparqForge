import { useState, useEffect, useCallback } from "react";
import { X, CalendarClock, Check, ChevronsRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

export interface BatchSchedulePanelProps {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

interface Campaign {
  id: string;
  name: string;
  brandName: string;
  brandColor: string;
  variantCount: number;
}

export function BatchSchedulePanel({ open, onClose, onScheduled }: BatchSchedulePanelProps) {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [scheduleDates, setScheduleDates] = useState<Record<string, string>>({});
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Shared date/time state for "Same date/time for all"
  const [sharedDate, setSharedDate] = useState("");
  const [sharedTime, setSharedTime] = useState("09:00");

  // Stagger state
  const [staggerStartDate, setStaggerStartDate] = useState("");

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns?status=approved", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch campaigns");
      const json = await res.json();
      const data: Campaign[] = (json.data || json || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        brandName: c.brandName || c.brand?.name || "Unknown",
        brandColor: c.brandColor || c.brand?.colorPrimary || "#6366f1",
        variantCount: c.variantCount ?? c.variants?.length ?? 0,
      }));
      setCampaigns(data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load campaigns" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      fetchCampaigns();
      setSelectedCampaignIds(new Set());
      setScheduleDates({});
      setScheduleTimes({});
      setSharedDate("");
      setSharedTime("09:00");
      setStaggerStartDate("");
    }
  }, [open, fetchCampaigns]);

  const toggleCampaign = (id: string) => {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedCampaignIds.size === campaigns.length) {
      setSelectedCampaignIds(new Set());
    } else {
      setSelectedCampaignIds(new Set(campaigns.map((c) => c.id)));
    }
  };

  const applySharedDateTime = () => {
    if (!sharedDate) {
      toast({ variant: "destructive", title: "Please select a date first" });
      return;
    }
    const nextDates: Record<string, string> = { ...scheduleDates };
    const nextTimes: Record<string, string> = { ...scheduleTimes };
    selectedCampaignIds.forEach((id) => {
      nextDates[id] = sharedDate;
      nextTimes[id] = sharedTime || "09:00";
    });
    setScheduleDates(nextDates);
    setScheduleTimes(nextTimes);
    toast({ title: `Applied to ${selectedCampaignIds.size} campaigns` });
  };

  const applyStagger = () => {
    if (!staggerStartDate) {
      toast({ variant: "destructive", title: "Please select a start date" });
      return;
    }
    const ids = Array.from(selectedCampaignIds);
    const nextDates: Record<string, string> = { ...scheduleDates };
    const nextTimes: Record<string, string> = { ...scheduleTimes };
    const base = new Date(staggerStartDate + "T00:00:00");
    ids.forEach((id, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      nextDates[id] = d.toISOString().slice(0, 10);
      if (!nextTimes[id]) nextTimes[id] = "09:00";
    });
    setScheduleDates(nextDates);
    setScheduleTimes(nextTimes);
    toast({ title: `Staggered ${ids.length} campaigns starting ${staggerStartDate}` });
  };

  const selectedCount = selectedCampaignIds.size;

  const allSelectedHaveDates = selectedCount > 0 && Array.from(selectedCampaignIds).every(
    (id) => scheduleDates[id] && scheduleTimes[id]
  );

  const handleSubmit = async () => {
    if (!allSelectedHaveDates) return;
    setSubmitting(true);
    try {
      const entries = Array.from(selectedCampaignIds).map((campaignId) => {
        const date = scheduleDates[campaignId];
        const time = scheduleTimes[campaignId] || "09:00";
        const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
        return { campaignId, scheduledAt };
      });

      const res = await fetch("/api/calendar-entries/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entries }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Batch scheduling failed" }));
        throw new Error(err.error || "Batch scheduling failed");
      }

      toast({ title: `Scheduled ${entries.length} campaign${entries.length > 1 ? "s" : ""}` });
      onScheduled();
      onClose();
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Scheduling failed",
        description: err.message || "Something went wrong",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed inset-y-0 right-0 w-[400px] max-w-[90vw] bg-card border-l border-border shadow-xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <CalendarClock size={18} className="text-primary" />
            <h2 className="font-semibold text-base">Batch Schedule</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        {/* Campaign list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-12 px-4 text-muted-foreground text-sm">
              No approved unscheduled campaigns found.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Select all row */}
              <div className="flex items-center gap-3 px-4 py-2 bg-muted/30">
                <Checkbox
                  checked={selectedCampaignIds.size === campaigns.length && campaigns.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-xs text-muted-foreground font-medium">
                  {selectedCount > 0
                    ? `${selectedCount} of ${campaigns.length} selected`
                    : `Select all (${campaigns.length})`}
                </span>
              </div>

              {campaigns.map((campaign) => {
                const isSelected = selectedCampaignIds.has(campaign.id);
                return (
                  <div key={campaign.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleCampaign(campaign.id)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{campaign.name}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                            style={{
                              borderColor: campaign.brandColor + "60",
                              color: campaign.brandColor,
                            }}
                          >
                            {campaign.brandName}
                          </Badge>
                          {campaign.variantCount > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {campaign.variantCount} variant{campaign.variantCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>

                        {/* Date/time inputs for selected campaigns */}
                        {isSelected && (
                          <div className="flex items-center gap-2 mt-2">
                            <Input
                              type="date"
                              className="h-7 text-xs flex-1"
                              value={scheduleDates[campaign.id] || ""}
                              onChange={(e) =>
                                setScheduleDates((prev) => ({
                                  ...prev,
                                  [campaign.id]: e.target.value,
                                }))
                              }
                            />
                            <Input
                              type="time"
                              className="h-7 text-xs w-[100px]"
                              value={scheduleTimes[campaign.id] || "09:00"}
                              onChange={(e) =>
                                setScheduleTimes((prev) => ({
                                  ...prev,
                                  [campaign.id]: e.target.value,
                                }))
                              }
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick actions */}
        {selectedCount > 0 && (
          <div className="border-t border-border px-4 py-3 space-y-3 shrink-0 bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Quick Actions
            </p>

            {/* Same date/time for all */}
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Same date/time for all</span>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="h-7 text-xs flex-1"
                  value={sharedDate}
                  onChange={(e) => setSharedDate(e.target.value)}
                />
                <Input
                  type="time"
                  className="h-7 text-xs w-[100px]"
                  value={sharedTime}
                  onChange={(e) => setSharedTime(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={applySharedDateTime}
                >
                  <Check size={12} className="mr-1" />
                  Apply
                </Button>
              </div>
            </div>

            {/* Stagger by 1 day */}
            <div className="space-y-1.5">
              <span className="text-xs text-muted-foreground">Stagger by 1 day</span>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  className="h-7 text-xs flex-1"
                  value={staggerStartDate}
                  onChange={(e) => setStaggerStartDate(e.target.value)}
                  placeholder="Start date"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  onClick={applyStagger}
                >
                  <ChevronsRight size={12} className="mr-1" />
                  Stagger
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-border px-4 py-3 shrink-0">
          <Button
            className="w-full"
            disabled={!allSelectedHaveDates || submitting}
            onClick={handleSubmit}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                Schedule {selectedCount > 0 ? `${selectedCount} campaign${selectedCount > 1 ? "s" : ""}` : "campaigns"}
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}
