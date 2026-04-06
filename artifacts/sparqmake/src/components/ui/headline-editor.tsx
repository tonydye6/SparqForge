import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";

interface HeadlineOverlayEditorProps {
  headline: string;
  disabled?: boolean;
  onSave: (newHeadline: string) => Promise<void>;
}

export function HeadlineOverlayEditor({ headline, disabled, onSave }: HeadlineOverlayEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(headline);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    setValue(headline);
  }, [headline]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = async () => {
    if (savingRef.current) return;
    if (value.trim() === headline || !value.trim()) {
      setEditing(false);
      setValue(headline);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(value.trim());
      setEditing(false);
    } catch {
      setValue(headline);
      setEditing(false);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  if (editing) {
    return (
      <div
        className="absolute bottom-0 left-0 right-0 z-20 p-3"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 70%, transparent 100%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 mb-1">
          {saving && <Loader2 size={10} className="animate-spin text-white/80" />}
          <span className="text-[9px] text-white/60 uppercase tracking-wider font-semibold">
            {saving ? "Saving..." : "Press Enter to save, Esc to cancel"}
          </span>
        </div>
        <input
          ref={inputRef}
          className="w-full text-sm font-extrabold text-white bg-transparent border-b border-white/40 outline-none pb-1 placeholder:text-white/30"
          style={{ textShadow: "1px 1px 3px rgba(0,0,0,0.8)" }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); handleSave(); }
            if (e.key === "Escape") { setEditing(false); setValue(headline); }
          }}
          onBlur={handleSave}
          disabled={saving}
        />
      </div>
    );
  }

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-10 p-3 ${disabled ? "" : "cursor-pointer group"}`}
      style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, transparent 100%)" }}
      onClick={() => !disabled && setEditing(true)}
    >
      <p
        className="text-sm font-extrabold text-white leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
      >
        {headline}
      </p>
      {!disabled && (
        <span className="text-[8px] text-white/0 group-hover:text-white/60 transition-colors mt-0.5 block uppercase tracking-wider">
          Click to edit
        </span>
      )}
    </div>
  );
}
