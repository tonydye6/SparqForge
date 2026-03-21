import { useState, useRef, useEffect } from "react";
import { Wand2, Loader2, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RewriteToolbarProps {
  selectedText: string;
  position: { top: number; left: number };
  onRewrite: (instruction: string) => Promise<string>;
  onApply: (newText: string) => void;
  onClose: () => void;
}

export function RewriteToolbar({ selectedText, position, onRewrite, onApply, onClose }: RewriteToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!instruction.trim()) return;
    setLoading(true);
    try {
      const rewritten = await onRewrite(instruction);
      setResult(rewritten);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute z-50 bg-card border border-border rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      style={{ top: position.top, left: position.left, transform: "translateX(-50%)" }}
    >
      {!expanded && !result ? (
        <Button
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5 bg-primary hover:bg-primary/90"
          onClick={() => setExpanded(true)}
        >
          <Wand2 size={12} />
          Rewrite
        </Button>
      ) : result ? (
        <div className="p-2.5 w-[280px] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">Rewritten</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          </div>
          <p className="text-xs text-foreground bg-primary/5 border border-primary/20 rounded-md p-2 leading-relaxed">{result}</p>
          <div className="flex gap-1.5">
            <Button size="sm" className="flex-1 h-7 text-xs bg-primary hover:bg-primary/90" onClick={() => { onApply(result); onClose(); }}>
              Apply
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setResult(null); setExpanded(true); }}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-2 w-[260px] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Wand2 size={10} className="text-primary" /> Rewrite "{selectedText.slice(0, 20)}..."
            </span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          </div>
          <div className="flex gap-1.5">
            <Input
              ref={inputRef}
              placeholder="e.g. shorter, more casual, add ™"
              className="h-7 text-xs bg-background border-border"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              disabled={loading}
            />
            <Button
              size="icon"
              className="h-7 w-7 bg-primary hover:bg-primary/90 shrink-0"
              onClick={handleSubmit}
              disabled={loading || !instruction.trim()}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {["shorter", "more casual", "add CTA", "more formal"].map(suggestion => (
              <button
                key={suggestion}
                className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                onClick={() => { setInstruction(suggestion); }}
                disabled={loading}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
