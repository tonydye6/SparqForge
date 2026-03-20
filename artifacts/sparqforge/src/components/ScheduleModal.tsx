import { useState } from "react";
import { CalendarIcon, Clock, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface ScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  campaignName: string;
  onScheduled?: () => void;
}

export function ScheduleModal({ open, onOpenChange, campaignId, campaignName, onScheduled }: ScheduleModalProps) {
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSchedule = async () => {
    if (!date || !time) {
      toast({ variant: "destructive", title: "Select a date and time" });
      return;
    }

    const scheduledAt = new Date(`${date}T${time}:00`).toISOString();

    setIsSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE}/api/campaigns/${campaignId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed to schedule" }));
        throw new Error(err.error);
      }

      const data = await resp.json();
      toast({ title: "Scheduled!", description: `${data.count} variant(s) scheduled for ${new Date(scheduledAt).toLocaleString()}` });
      onOpenChange(false);
      onScheduled?.();
    } catch (err) {
      toast({ variant: "destructive", title: "Schedule failed", description: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <CalendarIcon size={18} className="text-primary" />
            Schedule Campaign
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Set a publish date and time for "{campaignName}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              min={minDate}
              className="bg-background border-border"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Time</label>
            <div className="relative">
              <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="bg-background border-border pl-9"
              />
            </div>
          </div>

          {date && time && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-sm">
              <span className="text-muted-foreground">All variants will be scheduled for:</span>
              <p className="font-semibold text-foreground mt-1">
                {new Date(`${date}T${time}:00`).toLocaleString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="bg-card border-border">
            Cancel
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={!date || !time || isSubmitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isSubmitting ? "Scheduling..." : <><Send size={14} className="mr-2" /> Schedule</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
