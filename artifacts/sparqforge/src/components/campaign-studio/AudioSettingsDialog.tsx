import { useRef } from "react";
import { Loader2, Music, Volume2, VolumeX, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface AudioSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audioSource: string;
  onSourceChange: (source: string) => void;
  audioPrompt: string;
  onPromptChange: (prompt: string) => void;
  audioMergeMode: string;
  onMergeModeChange: (mode: string) => void;
  onApply: () => void;
  onUploadAudio: (file: File) => void;
  isGenerating: boolean;
}

export function AudioSettingsDialog({
  open,
  onOpenChange,
  audioSource,
  onSourceChange,
  audioPrompt,
  onPromptChange,
  audioMergeMode,
  onMergeModeChange,
  onApply,
  onUploadAudio,
  isGenerating,
}: AudioSettingsDialogProps) {
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music size={18} className="text-primary" /> Audio Settings
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Audio Source</label>
            <Select value={audioSource} onValueChange={(v) => onSourceChange(v)}>
              <SelectTrigger className="bg-background border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="music">
                  <span className="flex items-center gap-2"><Music size={14} /> AI Music</span>
                </SelectItem>
                <SelectItem value="sfx">
                  <span className="flex items-center gap-2"><Volume2 size={14} /> Sound Effects</span>
                </SelectItem>
                <SelectItem value="mute">
                  <span className="flex items-center gap-2"><VolumeX size={14} /> Mute Audio</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(audioSource === "music" || audioSource === "sfx") && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {audioSource === "music" ? "Music Style / Mood" : "Sound Effect Description"}
              </label>
              <Input
                placeholder={audioSource === "music" ? "e.g. Epic orchestral gaming trailer" : "e.g. Explosion, crowd cheering"}
                value={audioPrompt}
                onChange={(e) => onPromptChange(e.target.value)}
                className="bg-background border-border"
              />
            </div>
          )}

          {audioSource !== "mute" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Mix Mode</label>
              <Select value={audioMergeMode} onValueChange={(v) => onMergeModeChange(v)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="replace">Replace original audio</SelectItem>
                  <SelectItem value="mix">Mix with original audio</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <input
              type="file"
              accept="audio/mpeg,audio/mp3,audio/wav"
              className="hidden"
              ref={audioFileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onUploadAudio(file);
                }
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => audioFileInputRef.current?.click()}
              disabled={isGenerating}
            >
              <Upload size={12} className="mr-1" /> Upload Custom Audio
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onApply}
            disabled={isGenerating || ((audioSource === "music" || audioSource === "sfx") && !audioPrompt.trim())}
          >
            {isGenerating ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Music size={14} className="mr-2" />}
            Apply Audio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
