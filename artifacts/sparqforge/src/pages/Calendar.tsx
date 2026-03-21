import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Filter, Clock, Send, RotateCcw, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastAction } from "@/components/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useGetBrands } from "@workspace/api-client-react";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface CalendarEntry {
  id: string;
  campaignId: string;
  variantId: string;
  platform: string;
  socialAccountId?: string | null;
  scheduledAt: string;
  publishedAt?: string | null;
  publishStatus: string;
  publishError?: string | null;
  retryCount?: number;
  campaignName: string;
  brandId: string;
  brandName: string;
  brandColor: string;
  caption: string;
  aspectRatio: string;
  compositedImageUrl?: string | null;
}

interface PendingReschedule {
  entryId: string;
  entry: CalendarEntry;
  newDate: Date;
}

const PLATFORM_LABELS: Record<string, { label: string; icon: string }> = {
  instagram_feed: { label: "IG Feed", icon: "instagram" },
  instagram_story: { label: "IG Story", icon: "instagram" },
  twitter: { label: "X/Twitter", icon: "twitter" },
  linkedin: { label: "LinkedIn", icon: "linkedin" },
  tiktok: { label: "TikTok", icon: "tiktok" },
};

const STATUS_CONFIG: Record<string, { color: string; bgColor: string; label: string }> = {
  scheduled: { color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/20", label: "Scheduled" },
  publishing: { color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/20", label: "Publishing" },
  published: { color: "text-green-400", bgColor: "bg-green-500/10 border-green-500/20", label: "Published" },
  failed: { color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/20", label: "Failed" },
};

const HOUR_START = 8;
const HOUR_END = 22;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => i + HOUR_START);
const HOUR_HEIGHT = 60;

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return "12AM";
  if (hour === 12) return "12PM";
  return hour > 12 ? `${hour - 12}PM` : `${hour}AM`;
}

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [brandFilter, setBrandFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const { data: brands } = useGetBrands();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<PendingReschedule | null>(null);

  const touchDragRef = useRef<{
    entry: CalendarEntry;
    startX: number;
    startY: number;
    ghostEl: HTMLDivElement | null;
    isDragging: boolean;
    lastTarget: Element | null;
  } | null>(null);
  const didTouchDragRef = useRef(false);
  const [nowIndicatorTop, setNowIndicatorTop] = useState<number | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  const fetchEntries = useCallback(() => {
    let start: Date, end: Date;
    if (viewMode === "month") {
      start = new Date(year, month, 1);
      end = new Date(year, month + 1, 0, 23, 59, 59);
    } else {
      const dayOfWeek = currentDate.getDay();
      start = new Date(year, month, currentDate.getDate() - dayOfWeek);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59);
    }

    setIsLoading(true);

    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
    });
    if (brandFilter !== "all") {
      params.set("brandId", brandFilter);
    }

    fetch(`/api/calendar-entries?${params}`)
      .then(res => res.json())
      .then(data => {
        setEntries(data || []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [year, month, currentDate, brandFilter, viewMode]);

  useMemo(() => {
    fetchEntries();
  }, [fetchEntries]);

  const entriesByDay = useMemo(() => {
    const map: Record<number, CalendarEntry[]> = {};
    for (const entry of entries) {
      const d = new Date(entry.scheduledAt).getDate();
      if (!map[d]) map[d] = [];
      map[d].push(entry);
    }
    return map;
  }, [entries]);

  const weekDays = useMemo(() => {
    const dayOfWeek = currentDate.getDay();
    const startOfWeek = new Date(year, month, currentDate.getDate() - dayOfWeek);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate, year, month]);

  const isCurrentWeek = useMemo(() => {
    if (viewMode !== "week" || weekDays.length === 0) return false;
    const todayStr = today.toDateString();
    return weekDays.some(d => d.toDateString() === todayStr);
  }, [viewMode, weekDays, today]);

  useEffect(() => {
    if (!isCurrentWeek || viewMode !== "week") {
      setNowIndicatorTop(null);
      return;
    }
    const updateNow = () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      if (h < HOUR_START || h > HOUR_END) {
        setNowIndicatorTop(null);
        return;
      }
      const top = (h - HOUR_START) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
      setNowIndicatorTop(top);
    };
    updateNow();
    const interval = setInterval(updateNow, 60000);
    return () => clearInterval(interval);
  }, [isCurrentWeek, viewMode]);

  const prevMonth = () => {
    if (viewMode === "week") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    } else {
      setCurrentDate(new Date(year, month - 1, 1));
    }
  };
  const nextMonth = () => {
    if (viewMode === "week") {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    } else {
      setCurrentDate(new Date(year, month + 1, 1));
    }
  };
  const goToday = () => setCurrentDate(new Date());

  const handleEntryClick = (entry: CalendarEntry) => {
    if (didTouchDragRef.current) {
      didTouchDragRef.current = false;
      return;
    }
    setLocation(`/?campaign=${entry.campaignId}`);
  };

  const handlePublishNow = async (e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    setPublishingIds(prev => new Set(prev).add(entryId));
    try {
      const resp = await fetch(`${API_BASE}/api/calendar-entries/${entryId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed" }));
        toast({ variant: "destructive", title: "Publish failed", description: err.error });
      } else {
        toast({ title: "Publishing initiated" });
        setEntries(prev => prev.map(e =>
          e.id === entryId ? { ...e, publishStatus: "publishing" } : e
        ));
      }
    } catch {
      toast({ variant: "destructive", title: "Publish failed" });
    } finally {
      setPublishingIds(prev => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  };

  const handleRetry = async (e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    setPublishingIds(prev => new Set(prev).add(entryId));
    try {
      const resp = await fetch(`${API_BASE}/api/calendar-entries/${entryId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed" }));
        toast({ variant: "destructive", title: "Retry failed", description: err.error });
      } else {
        toast({ title: "Retry initiated" });
        setEntries(prev => prev.map(e =>
          e.id === entryId ? { ...e, publishStatus: "publishing", publishError: null } : e
        ));
      }
    } catch {
      toast({ variant: "destructive", title: "Retry failed" });
    } finally {
      setPublishingIds(prev => {
        const next = new Set(prev);
        next.delete(entryId);
        return next;
      });
    }
  };

  const commitReschedule = useCallback(async (entryId: string, newDate: Date) => {
    const resp = await fetch(`${API_BASE}/api/calendar-entries/${entryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledAt: newDate.toISOString() }),
    });

    if (!resp.ok) {
      toast({ variant: "destructive", title: "Failed to reschedule" });
      return;
    }

    setEntries(prev => prev.map(entry =>
      entry.id === entryId
        ? { ...entry, scheduledAt: newDate.toISOString() }
        : entry
    ));

    toast({
      title: "Rescheduled",
      description: `Moved to ${newDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${newDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    });
  }, [toast]);

  useEffect(() => {
    if (!pendingReschedule) return;
    const { entryId, entry, newDate } = pendingReschedule;
    const dateLabel = newDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeLabel = newDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    toast({
      title: "Reschedule?",
      description: `Move "${entry.campaignName}" to ${dateLabel} at ${timeLabel}?`,
      action: (
        <ToastAction altText="Confirm reschedule" onClick={() => {
          commitReschedule(entryId, newDate);
        }}>Confirm</ToastAction>
      ),
      duration: 10000,
    });
    setPendingReschedule(null);
  }, [pendingReschedule, commitReschedule, toast]);

  const handleDragStart = useCallback((e: React.DragEvent, entry: CalendarEntry) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ entryId: entry.id, scheduledAt: entry.scheduledAt }));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, dayNum: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverDay(dayNum);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverDay(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetDay: number) => {
    e.preventDefault();
    setDragOverDay(null);

    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json"));
      const { entryId, scheduledAt } = data as { entryId: string; scheduledAt: string };

      const oldDate = new Date(scheduledAt);
      const newDate = new Date(year, month, targetDay, oldDate.getHours(), oldDate.getMinutes(), oldDate.getSeconds());

      if (oldDate.getDate() === targetDay && oldDate.getMonth() === month && oldDate.getFullYear() === year) {
        return;
      }

      const entry = entries.find(e => e.id === entryId);
      if (entry) {
        setPendingReschedule({ entryId, entry, newDate });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to reschedule" });
    }
  }, [year, month, toast, entries]);

  const handleWeekDragOver = useCallback((e: React.DragEvent, slotKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSlot(slotKey);
  }, []);

  const handleWeekDragLeave = useCallback(() => {
    setDragOverSlot(null);
  }, []);

  const handleWeekDrop = useCallback(async (e: React.DragEvent, dayDate: Date, hour: number) => {
    e.preventDefault();
    setDragOverSlot(null);

    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json"));
      const { entryId, scheduledAt } = data as { entryId: string; scheduledAt: string };

      const oldDate = new Date(scheduledAt);
      const newDate = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, oldDate.getMinutes(), oldDate.getSeconds());

      if (oldDate.getTime() === newDate.getTime()) return;

      const entry = entries.find(e => e.id === entryId);
      if (entry) {
        setPendingReschedule({ entryId, entry, newDate });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to reschedule" });
    }
  }, [toast, entries]);

  const createTouchGhost = useCallback((entry: CalendarEntry): HTMLDivElement => {
    const ghost = document.createElement("div");
    ghost.style.position = "fixed";
    ghost.style.zIndex = "9999";
    ghost.style.pointerEvents = "none";
    ghost.style.opacity = "0.85";
    ghost.style.width = "140px";
    ghost.style.padding = "6px 8px";
    ghost.style.borderRadius = "6px";
    ghost.style.fontSize = "11px";
    ghost.style.fontWeight = "600";
    ghost.style.backgroundColor = entry.brandColor + "30";
    ghost.style.border = `2px solid ${entry.brandColor}`;
    ghost.style.color = entry.brandColor;
    ghost.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
    ghost.style.transform = "translate(-50%, -50%)";
    const pl = PLATFORM_LABELS[entry.platform] || { label: entry.platform };
    ghost.textContent = `${pl.label}: ${entry.campaignName?.slice(0, 15) || "Untitled"}`;
    document.body.appendChild(ghost);
    return ghost;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, entry: CalendarEntry) => {
    const touch = e.touches[0];
    touchDragRef.current = {
      entry,
      startX: touch.clientX,
      startY: touch.clientY,
      ghostEl: null,
      isDragging: false,
      lastTarget: null,
    };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const ref = touchDragRef.current;
    if (!ref) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - ref.startX);
    const dy = Math.abs(touch.clientY - ref.startY);

    if (!ref.isDragging && (dx > 10 || dy > 10)) {
      ref.isDragging = true;
      didTouchDragRef.current = true;
      ref.ghostEl = createTouchGhost(ref.entry);
      e.preventDefault();
    }

    if (ref.isDragging && ref.ghostEl) {
      e.preventDefault();
      ref.ghostEl.style.left = `${touch.clientX}px`;
      ref.ghostEl.style.top = `${touch.clientY}px`;

      const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      if (elemBelow) {
        const dropTarget = elemBelow.closest("[data-drop-day]") || elemBelow.closest("[data-drop-slot]");
        if (ref.lastTarget && ref.lastTarget !== dropTarget) {
          ref.lastTarget.classList.remove("ring-2", "ring-primary/40", "bg-primary/10");
        }
        if (dropTarget) {
          dropTarget.classList.add("ring-2", "ring-primary/40", "bg-primary/10");
          ref.lastTarget = dropTarget;
        }
      }
    }
  }, [createTouchGhost]);

  const cleanupTouchDrag = useCallback(() => {
    const ref = touchDragRef.current;
    if (!ref) return;
    touchDragRef.current = null;
    if (ref.lastTarget) {
      ref.lastTarget.classList.remove("ring-2", "ring-primary/40", "bg-primary/10");
    }
    if (ref.ghostEl) {
      document.body.removeChild(ref.ghostEl);
    }
  }, []);

  const handleTouchCancel = useCallback(() => {
    cleanupTouchDrag();
  }, [cleanupTouchDrag]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const ref = touchDragRef.current;
    if (!ref) return;

    const wasDragging = ref.isDragging;
    cleanupTouchDrag();

    if (!wasDragging) return;

    const touch = e.changedTouches[0];
    const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elemBelow) return;

    const dropDayEl = elemBelow.closest("[data-drop-day]");
    const dropSlotEl = elemBelow.closest("[data-drop-slot]");

    const oldDate = new Date(ref.entry.scheduledAt);

    if (dropSlotEl) {
      const slotData = dropSlotEl.getAttribute("data-drop-slot");
      if (slotData) {
        const [dayStr, hourStr] = slotData.split("|");
        const [slotYear, slotMonth, slotDay] = dayStr.split("-").map(Number);
        const hour = parseInt(hourStr, 10);
        const newDate = new Date(slotYear, slotMonth, slotDay, hour, oldDate.getMinutes(), oldDate.getSeconds());
        if (oldDate.getTime() !== newDate.getTime()) {
          setPendingReschedule({ entryId: ref.entry.id, entry: ref.entry, newDate });
        }
      }
    } else if (dropDayEl) {
      const targetDay = parseInt(dropDayEl.getAttribute("data-drop-day") || "", 10);
      if (!isNaN(targetDay)) {
        const newDate = new Date(year, month, targetDay, oldDate.getHours(), oldDate.getMinutes(), oldDate.getSeconds());
        if (oldDate.getDate() !== targetDay || oldDate.getMonth() !== month || oldDate.getFullYear() !== year) {
          setPendingReschedule({ entryId: ref.entry.id, entry: ref.entry, newDate });
        }
      }
    }
  }, [year, month]);

  const weekLabel = useMemo(() => {
    if (viewMode !== "week" || weekDays.length === 0) return "";
    const start = weekDays[0];
    const end = weekDays[6];
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }, [viewMode, weekDays]);

  const selectedDayEntries = useMemo(() => {
    if (selectedDay === null) return [];
    return entriesByDay[selectedDay] || [];
  }, [selectedDay, entriesByDay]);

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const daysShort = ["S", "M", "T", "W", "T", "F", "S"];
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const renderStatusBadge = (entry: CalendarEntry) => {
    const config = STATUS_CONFIG[entry.publishStatus] || STATUS_CONFIG.scheduled;
    return (
      <Badge variant="outline" className={`text-[8px] px-1 py-0 ${config.bgColor} ${config.color} border`}>
        {entry.publishStatus === "publishing" && <Loader2 size={8} className="mr-0.5 animate-spin" />}
        {entry.publishStatus === "published" && <CheckCircle2 size={8} className="mr-0.5" />}
        {entry.publishStatus === "failed" && <AlertCircle size={8} className="mr-0.5" />}
        {config.label}
      </Badge>
    );
  };

  const renderEntryCard = (entry: CalendarEntry, compact = false) => {
    const pl = PLATFORM_LABELS[entry.platform] || { label: entry.platform, icon: "twitter" };
    const time = new Date(entry.scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const isProcessing = publishingIds.has(entry.id);
    const canPublish = entry.socialAccountId && entry.publishStatus === "scheduled";
    const canRetry = entry.publishStatus === "failed";

    if (compact) {
      return (
        <TooltipProvider key={entry.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, entry)}
                onTouchStart={(e) => handleTouchStart(e, entry)}
                onTouchMove={(e) => handleTouchMove(e)}
                onTouchEnd={(e) => handleTouchEnd(e)}
                onTouchCancel={handleTouchCancel}
                onClick={() => handleEntryClick(entry)}
                className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] font-medium cursor-grab active:cursor-grabbing transition-colors border hover:brightness-110 touch-none"
                style={{
                  backgroundColor: `${entry.brandColor}15`,
                  borderColor: `${entry.brandColor}30`,
                  borderLeftWidth: "3px",
                  borderLeftColor: entry.brandColor,
                }}
              >
                <PlatformIcon platform={pl.icon} className="w-3 h-3 opacity-70" />
                <span className="truncate" style={{ color: entry.brandColor }}>{entry.campaignName?.slice(0, 12) || "Untitled"}</span>
                <span className="hidden sm:inline">{renderStatusBadge(entry)}</span>
                <span className="text-muted-foreground ml-auto shrink-0">{time}</span>
                {canPublish && (
                  <button
                    onClick={(e) => handlePublishNow(e, entry.id)}
                    disabled={isProcessing}
                    className="p-0.5 rounded hover:bg-primary/20 text-primary shrink-0"
                    title="Publish Now"
                  >
                    {isProcessing ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                  </button>
                )}
                {canRetry && (
                  <button
                    onClick={(e) => handleRetry(e, entry.id)}
                    disabled={isProcessing}
                    className="p-0.5 rounded hover:bg-red-500/20 text-red-400 shrink-0"
                    title="Retry"
                  >
                    {isProcessing ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                  </button>
                )}
              </div>
            </TooltipTrigger>
            {entry.publishStatus === "failed" && entry.publishError && (
              <TooltipContent side="top" className="max-w-[300px] text-xs">
                <p className="font-medium text-red-400">Publish Error:</p>
                <p className="text-muted-foreground">{entry.publishError}</p>
                {entry.retryCount != null && entry.retryCount > 0 && (
                  <p className="text-muted-foreground mt-1">Retry attempts: {entry.retryCount}/3</p>
                )}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      <TooltipProvider key={entry.id}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              onClick={() => handleEntryClick(entry)}
              className="flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors hover:brightness-110"
              style={{
                backgroundColor: `${entry.brandColor}08`,
                borderColor: `${entry.brandColor}25`,
                borderLeftWidth: "3px",
                borderLeftColor: entry.brandColor,
              }}
            >
              {entry.compositedImageUrl && (
                <img
                  src={`${API_BASE}${entry.compositedImageUrl}`}
                  alt=""
                  className="w-8 h-8 rounded object-cover shrink-0 border border-border/30"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <PlatformIcon platform={pl.icon} className="w-3 h-3 opacity-70" />
                  <span className="text-[10px] text-muted-foreground">{pl.label}</span>
                  {renderStatusBadge(entry)}
                </div>
                <p className="text-xs font-medium truncate" style={{ color: entry.brandColor }}>
                  {entry.campaignName || "Untitled"}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock size={9} className="text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{time}</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {canPublish && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 text-[9px] px-1.5 bg-primary/10 border-primary/20 text-primary hover:bg-primary/20"
                      onClick={(e) => handlePublishNow(e, entry.id)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? <Loader2 size={9} className="mr-0.5 animate-spin" /> : <Send size={9} className="mr-0.5" />}
                      Publish Now
                    </Button>
                  )}
                  {canRetry && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 text-[9px] px-1.5 bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                      onClick={(e) => handleRetry(e, entry.id)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? <Loader2 size={9} className="mr-0.5 animate-spin" /> : <RotateCcw size={9} className="mr-0.5" />}
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </TooltipTrigger>
          {entry.publishStatus === "failed" && entry.publishError && (
            <TooltipContent side="top" className="max-w-[300px] text-xs">
              <p className="font-medium text-red-400">Publish Error:</p>
              <p className="text-muted-foreground">{entry.publishError}</p>
              {entry.retryCount != null && entry.retryCount > 0 && (
                <p className="text-muted-foreground mt-1">Retry attempts: {entry.retryCount}/3</p>
              )}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderWeekEntryCard = (entry: CalendarEntry) => {
    const pl = PLATFORM_LABELS[entry.platform] || { label: entry.platform, icon: "twitter" };
    const time = new Date(entry.scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const config = STATUS_CONFIG[entry.publishStatus] || STATUS_CONFIG.scheduled;

    return (
      <div
        key={entry.id}
        draggable
        onDragStart={(e) => handleDragStart(e, entry)}
        onTouchStart={(e) => handleTouchStart(e, entry)}
        onTouchMove={(e) => handleTouchMove(e)}
        onTouchEnd={(e) => handleTouchEnd(e)}
        onTouchCancel={handleTouchCancel}
        onClick={() => handleEntryClick(entry)}
        className="absolute left-0.5 right-0.5 sm:left-1 sm:right-1 rounded px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium cursor-grab active:cursor-grabbing transition-all border hover:brightness-110 hover:shadow-md overflow-hidden touch-none z-10"
        style={{
          backgroundColor: `${entry.brandColor}20`,
          borderColor: `${entry.brandColor}40`,
          borderLeftWidth: "3px",
          borderLeftColor: entry.brandColor,
          top: `${((new Date(entry.scheduledAt).getMinutes()) / 60) * HOUR_HEIGHT}px`,
          minHeight: "22px",
          height: "auto",
          maxHeight: `${HOUR_HEIGHT - 4}px`,
        }}
      >
        <div className="flex items-center gap-0.5 sm:gap-1">
          <PlatformIcon platform={pl.icon} className="w-2.5 h-2.5 sm:w-3 sm:h-3 opacity-70 shrink-0" />
          <span className="truncate" style={{ color: entry.brandColor }}>{entry.campaignName?.slice(0, 10) || "Untitled"}</span>
        </div>
        <div className="flex items-center gap-0.5 mt-0.5">
          <span className="text-muted-foreground text-[8px] sm:text-[9px]">{time}</span>
          <span className={`text-[7px] sm:text-[8px] ${config.color}`}>{config.label}</span>
        </div>
      </div>
    );
  };

  const weekEntriesByDayHour = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    for (const entry of entries) {
      const d = new Date(entry.scheduledAt);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const hourKey = `${dayKey}-${d.getHours()}`;
      if (!map[hourKey]) map[hourKey] = [];
      map[hourKey].push(entry);
    }
    return map;
  }, [entries]);

  return (
    <div className="flex flex-col h-full overflow-hidden p-3 sm:p-6 max-w-[1400px] mx-auto w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-6 shrink-0 gap-3">
        <div>
          <h1 className="text-xl sm:text-3xl font-bold text-foreground">Content Calendar</h1>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm hidden sm:block">Schedule and review upcoming posts. Drag entries to reschedule.</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <Button variant="outline" size="sm" onClick={goToday} className="bg-card border-border text-xs sm:text-sm">
            Today
          </Button>
          <div className="flex items-center bg-card border border-border rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground" onClick={prevMonth}><ChevronLeft size={16} /></Button>
            <span className="font-semibold text-xs sm:text-sm px-2 sm:px-4 min-w-[100px] sm:min-w-[160px] text-center">
              {viewMode === "week" ? weekLabel : monthName}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8 text-muted-foreground" onClick={nextMonth}><ChevronRight size={16} /></Button>
          </div>
          <div className="flex bg-card border border-border rounded-lg p-0.5">
            <Button
              variant={viewMode === "month" ? "default" : "ghost"}
              size="sm"
              className={`h-7 text-xs ${viewMode === "month" ? "bg-primary text-primary-foreground" : ""}`}
              onClick={() => { setViewMode("month"); setSelectedDay(null); }}
            >
              Month
            </Button>
            <Button
              variant={viewMode === "week" ? "default" : "ghost"}
              size="sm"
              className={`h-7 text-xs ${viewMode === "week" ? "bg-primary text-primary-foreground" : ""}`}
              onClick={() => { setViewMode("week"); setSelectedDay(null); }}
            >
              Week
            </Button>
          </div>
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-[120px] sm:w-[160px] bg-card border-border text-xs sm:text-sm">
              <Filter size={14} className="mr-1 sm:mr-2 hidden sm:inline" />
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
      </div>

      {viewMode === "month" ? (
        <>
          <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-lg">
            <div className="grid grid-cols-7 border-b border-border bg-background/50">
              {days.map((day, i) => (
                <div key={day} className="py-2 sm:py-3 text-center text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{daysShort[i]}</span>
                </div>
              ))}
            </div>

            <div className="flex-1 grid grid-cols-7 overflow-y-auto" style={{ gridTemplateRows: `repeat(${totalCells / 7}, minmax(48px, 1fr))` }}>
              {Array.from({ length: totalCells }).map((_, i) => {
                const dayNum = i - firstDay + 1;
                const isValid = dayNum >= 1 && dayNum <= daysInMonth;
                const isToday = isCurrentMonth && dayNum === todayDate;
                const dayEntries = isValid ? (entriesByDay[dayNum] || []) : [];
                const isDragOver = dragOverDay === dayNum;
                const isSelected = selectedDay === dayNum;

                return (
                  <div
                    key={i}
                    data-drop-day={isValid ? dayNum : undefined}
                    className={`border-r border-b border-border p-1 sm:p-2 min-h-[48px] sm:min-h-[100px] transition-colors ${!isValid ? 'bg-background/40 opacity-40' : 'hover:bg-muted/30 cursor-pointer'} ${isToday ? 'bg-primary/5' : ''} ${isDragOver && isValid ? 'bg-primary/10 ring-2 ring-inset ring-primary/40' : ''} ${isSelected ? 'ring-2 ring-inset ring-primary/60 bg-primary/10' : ''}`}
                    onClick={() => isValid && dayEntries.length > 0 && setSelectedDay(isSelected ? null : dayNum)}
                    onDragOver={isValid ? (e) => handleDragOver(e, dayNum) : undefined}
                    onDragLeave={isValid ? handleDragLeave : undefined}
                    onDrop={isValid ? (e) => handleDrop(e, dayNum) : undefined}
                  >
                    {isValid && (
                      <>
                        <span className={`text-[10px] sm:text-sm font-medium inline-flex items-center justify-center ${isToday ? 'bg-primary text-primary-foreground w-5 h-5 sm:w-7 sm:h-7 rounded-full text-[10px] sm:text-sm' : 'text-muted-foreground'}`}>
                          {dayNum}
                        </span>

                        <div className="mt-0.5 sm:mt-1 space-y-0.5 sm:space-y-1">
                          <div className="hidden sm:block space-y-1">
                            {dayEntries.slice(0, 3).map(entry => renderEntryCard(entry, true))}
                            {dayEntries.length > 3 && (
                              <div className="text-[10px] text-muted-foreground pl-1">
                                +{dayEntries.length - 3} more
                              </div>
                            )}
                          </div>
                          {dayEntries.length > 0 && (
                            <div className="sm:hidden flex gap-0.5 flex-wrap">
                              {dayEntries.slice(0, 3).map(entry => (
                                <div
                                  key={entry.id}
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: entry.brandColor }}
                                />
                              ))}
                              {dayEntries.length > 3 && (
                                <span className="text-[8px] text-muted-foreground">+{dayEntries.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedDay !== null && selectedDayEntries.length > 0 && (
            <div className="sm:hidden mt-3 bg-card border border-border rounded-xl p-3 max-h-[30vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-foreground">
                  {new Date(year, month, selectedDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setSelectedDay(null)}>Close</Button>
              </div>
              <div className="space-y-2">
                {selectedDayEntries.map(entry => renderEntryCard(entry))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-lg">
          <div className="grid grid-cols-[40px_repeat(7,1fr)] sm:grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background/50 sticky top-0 z-20">
            <div className="py-2 sm:py-3 text-center text-xs font-semibold text-muted-foreground" />
            {weekDays.map((d, i) => {
              const isDayToday = d.toDateString() === today.toDateString();
              return (
                <div key={i} className={`py-2 sm:py-3 text-center border-l border-border ${isDayToday ? 'bg-primary/5' : ''}`}>
                  <div className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase">
                    <span className="hidden sm:inline">{days[d.getDay()]}</span>
                    <span className="sm:hidden">{daysShort[d.getDay()]}</span>
                  </div>
                  <div className={`text-sm sm:text-lg font-bold ${isDayToday ? 'text-primary' : 'text-foreground'}`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto relative">
            <div className="relative" style={{ height: `${HOURS.length * HOUR_HEIGHT}px` }}>
              {HOURS.map((hour, hourIdx) => (
                <div
                  key={hour}
                  className="absolute left-0 right-0 grid grid-cols-[40px_repeat(7,1fr)] sm:grid-cols-[60px_repeat(7,1fr)]"
                  style={{ top: `${hourIdx * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                >
                  <div className="relative text-[9px] sm:text-[10px] text-muted-foreground text-right pr-1 sm:pr-2">
                    <span className="absolute top-[-6px] right-1 sm:right-2">{formatHour(hour)}</span>
                  </div>
                  {weekDays.map((d, dayIdx) => {
                    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                    const hourKey = `${dayKey}-${hour}`;
                    const slotEntries = weekEntriesByDayHour[hourKey] || [];
                    const slotKey = `${dayIdx}-${hour}`;
                    const isDayToday = d.toDateString() === today.toDateString();
                    const isEvenHour = hour % 2 === 0;
                    const isDragOverThis = dragOverSlot === slotKey;

                    return (
                      <div
                        key={dayIdx}
                        data-drop-slot={`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${hour}`}
                        className={`border-l border-t border-border relative transition-colors ${isEvenHour ? 'bg-muted/5' : ''} ${isDayToday ? 'bg-primary/[0.02]' : ''} ${isDragOverThis ? 'bg-primary/10 ring-1 ring-inset ring-primary/30' : ''}`}
                        style={{ height: `${HOUR_HEIGHT}px` }}
                        onDragOver={(e) => handleWeekDragOver(e, slotKey)}
                        onDragLeave={handleWeekDragLeave}
                        onDrop={(e) => handleWeekDrop(e, d, hour)}
                      >
                        {slotEntries.map(entry => renderWeekEntryCard(entry))}
                      </div>
                    );
                  })}
                </div>
              ))}

              {nowIndicatorTop !== null && (
                <div
                  className="absolute left-[40px] sm:left-[60px] right-0 z-30 pointer-events-none flex items-center"
                  style={{ top: `${nowIndicatorTop}px` }}
                >
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shrink-0" />
                  <div className="flex-1 h-[2px] bg-red-500/70" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="mt-3 sm:mt-4 flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-muted-foreground flex-wrap">
          <span className="font-semibold">{entries.length} scheduled posts {viewMode === "month" ? "this month" : "this week"}</span>
          <span className="hidden sm:inline">|</span>
          {brands?.map(b => {
            const count = entries.filter(e => e.brandId === b.id).length;
            if (count === 0) return null;
            return (
              <span key={b.id} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.colorPrimary }} />
                {b.name}: {count}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
