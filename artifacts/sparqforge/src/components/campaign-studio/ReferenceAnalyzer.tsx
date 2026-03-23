import { useRef } from "react";
import { Search, Loader2, Check, AlertCircle, Link, Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_BASE } from "./campaign-studio.types";

export interface ReferenceAnalyzerProps {
  referenceUrl: string;
  onUrlChange: (url: string) => void;
  referenceStatus: "idle" | "capturing" | "analyzing" | "done" | "error";
  referenceError: string;
  referenceAnalysis: Record<string, string> | null;
  referenceScreenshots: Array<{ url: string; viewport: string }>;
  onAnalyzeUrl: () => void;
  onUploadScreenshot: (file: File) => void;
  onClearReference: () => void;
  isGenerating: boolean;
  selectedBrand: string;
}

export function ReferenceAnalyzer({
  referenceUrl,
  onUrlChange,
  referenceStatus,
  referenceError,
  referenceAnalysis,
  referenceScreenshots,
  onAnalyzeUrl,
  onUploadScreenshot,
  onClearReference,
  isGenerating,
  selectedBrand,
}: ReferenceAnalyzerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Link size={12} className="text-primary" />
        Reference URL
      </label>
      {referenceStatus === "idle" || referenceStatus === "error" ? (
        <>
          <div className="flex gap-1.5">
            <Input
              placeholder="https://example.com"
              className="bg-background border-border text-sm flex-1"
              value={referenceUrl}
              onChange={e => onUrlChange(e.target.value)}
              disabled={isGenerating}
              onKeyDown={e => { if (e.key === "Enter") onAnalyzeUrl(); }}
            />
            <Button
              size="icon"
              className="h-9 w-9 bg-primary hover:bg-primary/90 shrink-0"
              onClick={onAnalyzeUrl}
              disabled={!referenceUrl.trim() || isGenerating || !selectedBrand}
            >
              <Search size={14} />
            </Button>
          </div>
          {referenceStatus === "error" && referenceError && (
            <div className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20">
              <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[11px] text-red-400">{referenceError}</p>
                <button
                  className="text-[11px] text-red-400 underline mt-1 hover:text-red-300"
                  onClick={onAnalyzeUrl}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          <button
            className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            onClick={() => fileInputRef.current?.click()}
            disabled={isGenerating || !selectedBrand}
          >
            <Upload size={10} />
            Or upload screenshot
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onUploadScreenshot(file);
              e.target.value = "";
            }}
          />
        </>
      ) : referenceStatus === "capturing" ? (
        <div className="flex items-center gap-2 p-3 rounded-md bg-amber-500/5 border border-amber-500/20">
          <Loader2 size={14} className="text-amber-400 animate-spin" />
          <span className="text-xs text-amber-400">Capturing page...</span>
        </div>
      ) : referenceStatus === "analyzing" ? (
        <div className="space-y-2">
          {referenceScreenshots.length > 0 && (
            <div className="w-full h-16 rounded-md overflow-hidden border border-border/50 bg-muted/30">
              <img
                src={`${API_BASE}${referenceScreenshots[0].url}`}
                alt="Reference"
                className="w-full h-full object-cover object-top opacity-60"
              />
            </div>
          )}
          <div className="flex items-center gap-2 p-2 rounded-md bg-blue-500/5 border border-blue-500/20">
            <Loader2 size={14} className="text-blue-400 animate-spin" />
            <span className="text-xs text-blue-400">Analyzing reference...</span>
          </div>
        </div>
      ) : referenceStatus === "done" ? (
        <div className="space-y-2">
          {referenceScreenshots.length > 0 && (
            <div className="w-full h-16 rounded-md overflow-hidden border border-green-500/20 bg-muted/30 relative group">
              <img
                src={`${API_BASE}${referenceScreenshots[0].url}`}
                alt="Reference"
                className="w-full h-full object-cover object-top"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-2 rounded-md bg-green-500/10 border border-green-500/20">
            <div className="flex items-center gap-2">
              <Check size={12} className="text-green-400" />
              <span className="text-xs text-green-400 font-medium">Analyzed ✓</span>
            </div>
            <button
              className="text-muted-foreground hover:text-red-400 transition-colors"
              onClick={onClearReference}
            >
              <Trash2 size={12} />
            </button>
          </div>
          {referenceAnalysis?.visual_mood && (
            <p className="text-[10px] text-muted-foreground leading-tight truncate" title={referenceAnalysis.visual_mood}>
              Mood: {referenceAnalysis.visual_mood}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
