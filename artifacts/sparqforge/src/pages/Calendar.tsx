import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Filter, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetBrands } from "@workspace/api-client-react";

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
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram_feed: "IG Feed",
  instagram_story: "IG Story",
  twitter: "X/Twitter",
  linkedin: "LinkedIn",
};

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [brandFilter, setBrandFilter] = useState("all");
  const { data: brands } = useGetBrands();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  useMemo(() => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59);
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
  }, [year, month, brandFilter]);

  const entriesByDay = useMemo(() => {
    const map: Record<number, CalendarEntry[]> = {};
    for (const entry of entries) {
      const d = new Date(entry.scheduledAt).getDate();
      if (!map[d]) map[d] = [];
      map[d].push(entry);
    }
    return map;
  }, [entries]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

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
            <span className="font-semibold text-sm px-4 min-w-[160px] text-center">{monthName}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={nextMonth}><ChevronRight size={16} /></Button>
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

      <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-lg">
        <div className="grid grid-cols-7 border-b border-border bg-background/50">
          {days.map(day => (
            <div key={day} className="py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>

        <div className={`flex-1 grid grid-cols-7`} style={{ gridTemplateRows: `repeat(${totalCells / 7}, minmax(100px, 1fr))` }}>
          {Array.from({ length: totalCells }).map((_, i) => {
            const dayNum = i - firstDay + 1;
            const isValid = dayNum >= 1 && dayNum <= daysInMonth;
            const isToday = isCurrentMonth && dayNum === todayDate;
            const dayEntries = isValid ? (entriesByDay[dayNum] || []) : [];

            return (
              <div
                key={i}
                className={`border-r border-b border-border p-2 min-h-[100px] transition-colors hover:bg-muted/30 ${!isValid ? 'bg-background/40 opacity-40' : ''}`}
              >
                {isValid && (
                  <>
                    <span className={`text-sm font-medium inline-flex items-center justify-center ${isToday ? 'bg-primary text-primary-foreground w-7 h-7 rounded-full' : 'text-muted-foreground'}`}>
                      {dayNum}
                    </span>

                    <div className="mt-1 space-y-1">
                      {dayEntries.slice(0, 3).map(entry => (
                        <div
                          key={entry.id}
                          className="text-[10px] px-1.5 py-0.5 rounded truncate font-medium cursor-pointer transition-colors border"
                          style={{
                            backgroundColor: `${entry.brandColor}15`,
                            color: entry.brandColor,
                            borderColor: `${entry.brandColor}30`,
                          }}
                          title={`${entry.campaignName} — ${PLATFORM_LABELS[entry.platform] || entry.platform}`}
                        >
                          {entry.campaignName?.slice(0, 20) || "Untitled"}
                        </div>
                      ))}
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

      {entries.length > 0 && (
        <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="font-semibold">{entries.length} scheduled posts this month</span>
          <span>•</span>
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
