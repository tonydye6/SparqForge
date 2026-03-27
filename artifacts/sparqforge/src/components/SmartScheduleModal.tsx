import { useState, useEffect, useMemo } from "react";
import { Sparkles, Clock, AlertTriangle, Check, CalendarDays, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { PlatformIcon } from "@/components/ui/platform-icon";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface Proposal {
  id: string;
  creativeId: string;
  variantId: string;
  platform: string;
  proposedAt: string;
  score: number;
  rationale: string;
  status: string;
  hasConflict?: boolean;
  conflictMessage?: string;
}

interface SmartScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creativeId: string;
  creativeName: string;
  onScheduled?: () => void;
}

const PLATFORM_MAP: Record<string, { label: string; icon: string; color: string }> = {
  instagram_feed: { label: "Instagram Feed", icon: "instagram", color: "#E1306C" },
  instagram_story: { label: "Instagram Story", icon: "instagram", color: "#C13584" },
  twitter: { label: "X/Twitter", icon: "twitter", color: "#1DA1F2" },
  linkedin: { label: "LinkedIn", icon: "linkedin", color: "#0A66C2" },
  tiktok: { label: "TikTok", icon: "tiktok", color: "#ff0050" },
};

function ScoreBar({ score }: { score: number }) {
  const percentage = Math.round(score * 100);
  const color = percentage >= 80 ? "bg-green-500" : percentage >= 60 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{percentage}%</span>
    </div>
  );
}

function MiniTimeline({ proposals, timeOverrides }: { proposals: Proposal[]; timeOverrides: Record<string, string> }) {
  const days = useMemo(() => {
    const dayMap = new Map<string, { label: string; items: Array<{ platform: string; hour: number }> }>();

    for (const p of proposals) {
      const time = timeOverrides[p.id] ? new Date(timeOverrides[p.id]) : new Date(p.proposedAt);
      const dayKey = time.toISOString().split("T")[0];
      const dayLabel = time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, { label: dayLabel, items: [] });
      }
      dayMap.get(dayKey)!.items.push({ platform: p.platform, hour: time.getHours() });
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value);
  }, [proposals, timeOverrides]);

  if (days.length === 0) return null;

  return (
    <div className="bg-background/50 rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <CalendarDays size={12} className="text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">7-Day Timeline</span>
      </div>
      <div className="flex gap-1">
        {days.map((day, i) => (
          <div key={i} className="flex-1 min-w-0">
            <div className="text-[9px] text-muted-foreground text-center mb-1 truncate">{day.label}</div>
            <div className="space-y-0.5">
              {day.items.map((item, j) => {
                const config = PLATFORM_MAP[item.platform];
                return (
                  <div
                    key={j}
                    className="h-3 rounded-sm flex items-center justify-center"
                    style={{ backgroundColor: `${config?.color || "#888"}20`, borderLeft: `2px solid ${config?.color || "#888"}` }}
                    title={`${config?.label || item.platform} at ${item.hour > 12 ? item.hour - 12 : item.hour}${item.hour >= 12 ? "PM" : "AM"}`}
                  >
                    <span className="text-[7px] font-mono text-muted-foreground">
                      {item.hour > 12 ? item.hour - 12 : item.hour}{item.hour >= 12 ? "p" : "a"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SmartScheduleModal({ open, onOpenChange, creativeId, creativeName, onScheduled }: SmartScheduleModalProps) {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [timeOverrides, setTimeOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !creativeId) return;

    setIsLoading(true);
    setProposals([]);
    setSelectedIds(new Set());
    setTimeOverrides({});
    setEditingId(null);

    fetch(`${API_BASE}/api/creatives/${creativeId}/smart-schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to generate schedule");
        return res.json();
      })
      .then((data) => {
        const p = data.proposals || [];
        setProposals(p);
        setSelectedIds(new Set(p.map((pr: Proposal) => pr.id)));
      })
      .catch((err) => {
        toast({ variant: "destructive", title: "Smart Schedule failed", description: err.message });
      })
      .finally(() => setIsLoading(false));
  }, [open, creativeId]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTimeOverride = (proposalId: string, dateStr: string, timeStr: string) => {
    const combined = new Date(`${dateStr}T${timeStr}:00`).toISOString();
    setTimeOverrides((prev) => ({ ...prev, [proposalId]: combined }));
  };

  const handleConfirm = async (mode: "all" | "selected") => {
    const ids = mode === "all" ? proposals.map((p) => p.id) : Array.from(selectedIds);
    if (ids.length === 0) {
      toast({ variant: "destructive", title: "Select at least one proposal" });
      return;
    }

    setIsConfirming(true);
    try {
      const resp = await fetch(`${API_BASE}/api/smart-schedule/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalIds: ids, timeOverrides }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed to confirm" }));
        throw new Error(err.error);
      }

      const data = await resp.json();
      toast({ title: "Smart Scheduled!", description: `${data.count} post(s) added to calendar` });
      onOpenChange(false);
      onScheduled?.();
    } catch (err) {
      toast({ variant: "destructive", title: "Confirmation failed", description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setIsConfirming(false);
    }
  };

  const hasConflicts = proposals.some((p) => p.hasConflict);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Sparkles size={18} className="text-amber-400" />
            Smart Schedule
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            AI-optimized time proposals for "{creativeName}"
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex flex-col items-center gap-3">
            <div className="relative">
              <Sparkles size={24} className="text-amber-400 animate-pulse" />
            </div>
            <p className="text-sm text-muted-foreground">Analyzing optimal posting times...</p>
            <p className="text-xs text-muted-foreground">Checking calendar conflicts and platform peak hours</p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {hasConflicts && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-400">Scheduling Conflicts Detected</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Some proposed times conflict with existing calendar entries. Fallback slots were used.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {proposals.map((proposal) => {
                const config = PLATFORM_MAP[proposal.platform] || { label: proposal.platform, icon: "twitter", color: "#888" };
                const isSelected = selectedIds.has(proposal.id);
                const isEditing = editingId === proposal.id;
                const displayTime = timeOverrides[proposal.id]
                  ? new Date(timeOverrides[proposal.id])
                  : new Date(proposal.proposedAt);

                return (
                  <div
                    key={proposal.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      isSelected
                        ? "border-primary/30 bg-primary/5"
                        : "border-border bg-background/50 opacity-60"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelected(proposal.id)}
                        className="mt-1"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <PlatformIcon platform={config.icon} className="w-4 h-4" />
                          <span className="text-xs font-semibold text-foreground">{config.label}</span>
                          {proposal.hasConflict && (
                            <Badge variant="outline" className="text-[9px] bg-amber-500/10 border-amber-500/20 text-amber-400">
                              Fallback
                            </Badge>
                          )}
                          {timeOverrides[proposal.id] && (
                            <Badge variant="outline" className="text-[9px] bg-blue-500/10 border-blue-500/20 text-blue-400">
                              Modified
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mb-2">
                          <Clock size={12} className="text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">
                            {displayTime.toLocaleDateString("en-US", {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}{" "}
                            at{" "}
                            {displayTime.toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0"
                            onClick={() => setEditingId(isEditing ? null : proposal.id)}
                          >
                            <Pencil size={10} />
                          </Button>
                        </div>

                        {isEditing && (
                          <div className="flex gap-2 mb-2">
                            <Input
                              type="date"
                              className="h-7 text-xs bg-background border-border flex-1"
                              defaultValue={displayTime.toISOString().split("T")[0]}
                              onChange={(e) => {
                                const timeStr = displayTime.toTimeString().slice(0, 5);
                                handleTimeOverride(proposal.id, e.target.value, timeStr);
                              }}
                            />
                            <Input
                              type="time"
                              className="h-7 text-xs bg-background border-border w-28"
                              defaultValue={displayTime.toTimeString().slice(0, 5)}
                              onChange={(e) => {
                                const dateStr = (timeOverrides[proposal.id]
                                  ? new Date(timeOverrides[proposal.id])
                                  : displayTime
                                ).toISOString().split("T")[0];
                                handleTimeOverride(proposal.id, dateStr, e.target.value);
                              }}
                            />
                          </div>
                        )}

                        <ScoreBar score={proposal.score} />

                        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                          {proposal.rationale}
                        </p>

                        {proposal.hasConflict && proposal.conflictMessage && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <AlertTriangle size={10} className="text-amber-400" />
                            <span className="text-[10px] text-amber-400">{proposal.conflictMessage}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {proposals.length > 0 && (
              <MiniTimeline proposals={proposals} timeOverrides={timeOverrides} />
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="bg-card border-border">
            Cancel
          </Button>
          {proposals.length > 0 && (
            <>
              <Button
                variant="outline"
                onClick={() => handleConfirm("selected")}
                disabled={isConfirming || selectedIds.size === 0}
                className="bg-card border-border"
              >
                <Check size={14} className="mr-1.5" />
                Confirm Selected ({selectedIds.size})
              </Button>
              <Button
                onClick={() => handleConfirm("all")}
                disabled={isConfirming}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isConfirming ? (
                  "Scheduling..."
                ) : (
                  <>
                    <Sparkles size={14} className="mr-1.5" />
                    Confirm All ({proposals.length})
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
