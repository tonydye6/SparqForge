import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Filter, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetBrands } from "@workspace/api-client-react";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { useLocation } from "wouter";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface CalendarEntry {
  id: string;
  campaignId: string;
  variantId: string;
  platform: string;
  scheduledAt: string;
  publishStatus: string;
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

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [brandFilter, setBrandFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const { data: brands } = useGetBrands();
  const [, setLocation] = useLocation();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  useMemo(() => {
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
  }, [year, month, currentDate.getDate(), brandFilter, viewMode]);

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

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

  const renderEntryCard = (entry: CalendarEntry, compact = false) => {
    const pl = PLATFORM_LABELS[entry.platform] || { label: entry.platform, icon: "twitter" };
    const time = new Date(entry.scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    if (compact) {
      return (
        <div
          key={entry.id}
          onClick={() => handleEntryClick(entry)}
          className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] font-medium cursor-pointer transition-colors border hover:brightness-110"
          style={{
            backgroundColor: `${entry.brandColor}15`,
            borderColor: `${entry.brandColor}30`,
            borderLeftWidth: "3px",
            borderLeftColor: entry.brandColor,
          }}
          title={`${entry.campaignName} — ${pl.label} at ${time}`}
        >
          <PlatformIcon platform={pl.icon} className="w-3 h-3 opacity-70" />
          <span className="truncate" style={{ color: entry.brandColor }}>{entry.campaignName?.slice(0, 16) || "Untitled"}</span>
          <span className="text-muted-foreground ml-auto shrink-0">{time}</span>
        </div>
      );
    }

    return (
      <div
        key={entry.id}
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
          </div>
          <p className="text-xs font-medium truncate" style={{ color: entry.brandColor }}>
            {entry.campaignName || "Untitled"}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <Clock size={9} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{time}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-6 max-w-[1400px] mx-auto w-full">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Content Calendar</h1>
          <p className="text-muted-foreground mt-1">Schedule and review upcoming posts.</p>
        </div>

        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={goToday} className="bg-card border-border text-sm">
            Today
          </Button>
          <div className="flex items-center bg-card border border-border rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={prevMonth}><ChevronLeft size={16} /></Button>
            <span className="font-semibold text-sm px-4 min-w-[160px] text-center">
              {viewMode === "week" ? weekLabel : monthName}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={nextMonth}><ChevronRight size={16} /></Button>
          </div>
          <div className="flex bg-card border border-border rounded-lg p-0.5">
            <Button
              variant={viewMode === "month" ? "default" : "ghost"}
              size="sm"
              className={`h-7 text-xs ${viewMode === "month" ? "bg-primary text-primary-foreground" : ""}`}
              onClick={() => setViewMode("month")}
            >
              Month
            </Button>
            <Button
              variant={viewMode === "week" ? "default" : "ghost"}
              size="sm"
              className={`h-7 text-xs ${viewMode === "week" ? "bg-primary text-primary-foreground" : ""}`}
              onClick={() => setViewMode("week")}
            >
              Week
            </Button>
          </div>
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-[160px] bg-card border-border">
              <Filter size={14} className="mr-2" />
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
        <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-lg">
          <div className="grid grid-cols-7 border-b border-border bg-background/50">
            {days.map(day => (
              <div key={day} className="py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>

          <div className="flex-1 grid grid-cols-7" style={{ gridTemplateRows: `repeat(${totalCells / 7}, minmax(100px, 1fr))` }}>
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - firstDay + 1;
              const isValid = dayNum >= 1 && dayNum <= daysInMonth;
              const isToday = isCurrentMonth && dayNum === todayDate;
              const dayEntries = isValid ? (entriesByDay[dayNum] || []) : [];

              return (
                <div
                  key={i}
                  className={`border-r border-b border-border p-2 min-h-[100px] transition-colors hover:bg-muted/30 ${!isValid ? 'bg-background/40 opacity-40' : ''} ${isToday ? 'bg-primary/5' : ''}`}
                >
                  {isValid && (
                    <>
                      <span className={`text-sm font-medium inline-flex items-center justify-center ${isToday ? 'bg-primary text-primary-foreground w-7 h-7 rounded-full' : 'text-muted-foreground'}`}>
                        {dayNum}
                      </span>

                      <div className="mt-1 space-y-1">
                        {dayEntries.slice(0, 3).map(entry => renderEntryCard(entry, true))}
                        {dayEntries.length > 3 && (
                          <div className="text-[10px] text-muted-foreground pl-1">
                            +{dayEntries.length - 3} more
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
      ) : (
        <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-lg">
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-background/50">
            <div className="py-3 text-center text-xs font-semibold text-muted-foreground" />
            {weekDays.map((d, i) => {
              const isToday = d.toDateString() === today.toDateString();
              return (
                <div key={i} className={`py-3 text-center ${isToday ? 'bg-primary/5' : ''}`}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase">{days[d.getDay()]}</div>
                  <div className={`text-lg font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{d.getDate()}</div>
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto">
            {hours.map(hour => (
              <div key={hour} className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border min-h-[60px]">
                <div className="p-1 text-[10px] text-muted-foreground text-right pr-2 pt-1">
                  {hour > 12 ? `${hour - 12}PM` : hour === 12 ? "12PM" : `${hour}AM`}
                </div>
                {weekDays.map((d, dayIdx) => {
                  const key = `${d.getDay()}-${hour}`;
                  const slotEntries = entriesByHour[key] || [];
                  return (
                    <div key={dayIdx} className="border-l border-border p-1 space-y-1 hover:bg-muted/20 transition-colors">
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
        <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-semibold">{entries.length} scheduled posts {viewMode === "month" ? "this month" : "this week"}</span>
          <span>|</span>
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
