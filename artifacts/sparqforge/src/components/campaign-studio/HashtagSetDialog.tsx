import { Loader2, X, Hash } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export interface HashtagSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hashtagSetName: string;
  onNameChange: (name: string) => void;
  hashtagsToSave: string[];
  onRemoveHashtag: (index: number) => void;
  onSave: () => void;
  isSaving: boolean;
}

export function HashtagSetDialog({
  open,
  onOpenChange,
  hashtagSetName,
  onNameChange,
  hashtagsToSave,
  onRemoveHashtag,
  onSave,
  isSaving,
}: HashtagSetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as Hashtag Set</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Set Name</label>
            <Input
              placeholder="e.g. Tournament Hype Tags"
              value={hashtagSetName}
              onChange={(e) => onNameChange(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Hashtags ({hashtagsToSave.length})</label>
            <div className="flex flex-wrap gap-1.5">
              {hashtagsToSave.map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {tag}
                  <button
                    className="ml-1 hover:text-destructive"
                    onClick={() => onRemoveHashtag(i)}
                  >
                    <X size={10} />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={onSave}
            disabled={isSaving || !hashtagSetName.trim() || hashtagsToSave.length === 0}
          >
            {isSaving ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Hash size={14} className="mr-2" />}
            Save Set
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
