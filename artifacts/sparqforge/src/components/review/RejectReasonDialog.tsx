import { useState } from "react";
import { REJECT_CATEGORIES, formatRejectComment } from "@/lib/reject-reasons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface RejectReasonDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (category: string, comment: string) => void;
  variantCount: number; // 1 for single, N for bulk
}

export function RejectReasonDialog({
  open,
  onClose,
  onSubmit,
  variantCount,
}: RejectReasonDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const reset = () => {
    setSelectedCategory(null);
    setComment("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!selectedCategory || comment.length < 10) return;
    onSubmit(selectedCategory, comment);
    reset();
    onClose();
  };

  const isValid = selectedCategory !== null && comment.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>
            Reject {variantCount} variant{variantCount !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Select a reason and provide feedback so the creator can improve.
          </DialogDescription>
        </DialogHeader>

        {/* Category grid */}
        <div className="grid grid-cols-2 gap-2">
          {REJECT_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.slug;
            return (
              <button
                key={cat.slug}
                type="button"
                onClick={() => setSelectedCategory(cat.slug)}
                className={`text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                  isSelected
                    ? "border-primary ring-1 ring-primary bg-primary/5"
                    : "border-border hover:border-primary/50 bg-card"
                }`}
              >
                <span className="text-sm font-medium text-foreground block">
                  {cat.label}
                </span>
                <span className="text-xs text-muted-foreground mt-0.5 block leading-snug">
                  {cat.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Comment textarea */}
        <div className="space-y-2">
          <Label htmlFor="reject-comment">Feedback (required)</Label>
          <Textarea
            id="reject-comment"
            placeholder="Explain what needs to change..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="bg-card border-border text-sm"
          />
          {comment.length > 0 && comment.trim().length < 10 && (
            <p className="text-xs text-muted-foreground">
              At least 10 characters required ({comment.trim().length}/10)
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
