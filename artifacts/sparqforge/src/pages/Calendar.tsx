import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Filter, Clock, Send, RotateCcw, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

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

  const entriesByHour = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    for (const entry of entries) {
      const d = new Date(entry.scheduledAt);
      const key = `${d.getDay()}-${d.getHours()}`;
      if (!map[key]) map[key] = [];
      map[key].push(entry);
    }
    return map;
  }, [entries]);

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
        description: `Moved to ${newDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      });
    } catch {
      toast({ variant: "destructive", title: "Failed to reschedule" });
    }
  }, [year, month, toast]);

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const daysShort = ["S", "M", "T", "W", "T", "F", "S"];
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const weekDays = useMemo(() => {
    const dayOfWeek = currentDate.getDay();
    const startOfWeek = new Date(year, month, currentDate.getDate() - dayOfWeek);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate, year, month]);

  const weekLabel = useMemo(() => {
    if (viewMode !== "week" || weekDays.length === 0) return "";
    const start = weekDays[0];
    const end = weekDays[6];
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }, [viewMode, weekDays]);

  const hours = Array.from({ length: 15 }, (_, i) => i + 8);

  const selectedDayEntries = useMemo(() => {
    if (selectedDay === null) return [];
    return entriesByDay[selectedDay] || [];
  }, [selectedDay, entriesByDay]);

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
                onClick={() => handleEntryClick(entry)}
                className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] font-medium cursor-grab active:cursor-grabbing transition-colors border hover:brightness-110"
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
          <div className="grid grid-cols-[40px_repeat(7,1fr)] sm:grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background/50">
            <div className="py-2 sm:py-3 text-center text-xs font-semibold text-muted-foreground" />
            {weekDays.map((d, i) => {
              const isToday = d.toDateString() === today.toDateString();
              return (
                <div key={i} className={`py-2 sm:py-3 text-center ${isToday ? 'bg-primary/5' : ''}`}>
                  <div className="text-[10px] sm:text-xs font-semibold text-muted-foreground uppercase">
                    <span className="hidden sm:inline">{days[d.getDay()]}</span>
                    <span className="sm:hidden">{daysShort[d.getDay()]}</span>
                  </div>
                  <div className={`text-sm sm:text-lg font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{d.getDate()}</div>
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto">
            {hours.map(hour => (
              <div key={hour} className="grid grid-cols-[40px_repeat(7,1fr)] sm:grid-cols-[60px_repeat(7,1fr)] border-b border-border min-h-[48px] sm:min-h-[60px]">
                <div className="p-0.5 sm:p-1 text-[9px] sm:text-[10px] text-muted-foreground text-right pr-1 sm:pr-2 pt-1">
                  {hour > 12 ? `${hour - 12}PM` : hour === 12 ? "12PM" : `${hour}AM`}
                </div>
                {weekDays.map((d, dayIdx) => {
                  const key = `${d.getDay()}-${hour}`;
                  const slotEntries = entriesByHour[key] || [];
                  return (
                    <div key={dayIdx} className="border-l border-border p-0.5 sm:p-1 space-y-1 hover:bg-muted/20 transition-colors">
                      {slotEntries.map(entry => renderEntryCard(entry))}
                    </div>
                  );
                })}
              </div>
            ))}
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
