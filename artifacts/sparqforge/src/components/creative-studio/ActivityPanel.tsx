import { Check, X, Loader2, Save, Download, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActivityLog } from "./creative-studio.types";

export interface ActivityPanelProps {
  activityLog: ActivityLog[];
  estimatedCost: number;
  onSaveDraft: () => void;
  isSaving: boolean;
  onDownloadAll: () => void;
  onSchedule: () => void;
  onSubmitForReview: () => void;
  hasVariants: boolean;
  creativeId: string | null;
  isGenerating: boolean;
}

export function ActivityPanel({
  activityLog,
  estimatedCost,
  onSaveDraft,
  isSaving,
  onDownloadAll,
  onSchedule,
  onSubmitForReview,
  hasVariants,
  creativeId,
  isGenerating,
}: ActivityPanelProps) {
  return (
    <aside className="w-[280px] shrink-0 border-l border-border bg-card/50 flex flex-col z-20 shadow-xl">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-bold text-foreground">Overview</h2>
        <div className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded border border-primary/20">
          Cost: ${estimatedCost.toFixed(2)}
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Activity Log</h3>
        <div className="space-y-3">
          {activityLog.map((log, i) => (
            <div key={i} className="flex gap-3 relative">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 z-10 ${
                log.status === "done" ? "bg-green-500/20 text-green-400" :
                log.status === "error" ? "bg-red-500/20 text-red-400" :
                "bg-amber-500/20 text-amber-400"
              }`}>
                {log.status === "done" ? <Check size={10} /> :
                 log.status === "error" ? <X size={10} /> :
                 <Loader2 size={10} className="animate-spin" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-foreground leading-tight">{log.text}</p>
                <p className="text-[10px] text-muted-foreground">{log.time}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 border-t border-border space-y-2 bg-background">
        <Button
          variant="outline"
          className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground"
          onClick={onSaveDraft}
          disabled={isSaving || isGenerating}
        >
          <Save size={16} className="mr-2 text-muted-foreground" />
          {isSaving ? "Saving..." : "Save Draft"}
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground"
          disabled={!hasVariants || !creativeId}
          onClick={onDownloadAll}
        >
          <Download size={16} className="mr-2 text-muted-foreground" /> Download All Assets
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start bg-card border-border hover:bg-muted hover:text-foreground"
          disabled={!hasVariants || !creativeId || isGenerating}
          onClick={onSchedule}
        >
          <CalendarIcon size={16} className="mr-2 text-muted-foreground" /> Schedule
        </Button>
        <Button
          className="w-full justify-center bg-primary hover:bg-primary/90 text-primary-foreground font-bold mt-2"
          disabled={!hasVariants || !creativeId || isGenerating}
          onClick={onSubmitForReview}
        >
          Submit for Review
        </Button>
      </div>
    </aside>
  );
}
