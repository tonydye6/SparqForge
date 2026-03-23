import { CheckSquare, XCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onApproveSelected: () => void;
  onRejectSelected: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  onApproveSelected,
  onRejectSelected,
  onSelectAll,
  onClearSelection,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const allSelected = selectedCount === totalCount;

  return (
    <div className="sticky bottom-0 bg-card border-t border-border px-4 py-3 flex items-center justify-between gap-4 z-10">
      {/* Left: checkbox + count */}
      <div className="flex items-center gap-2 shrink-0">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => {
            if (checked) {
              onSelectAll();
            } else {
              onClearSelection();
            }
          }}
        />
        <span className="text-sm text-foreground font-medium">
          {selectedCount} of {totalCount} selected
        </span>
      </div>

      {/* Center: Select All / Clear */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={onSelectAll}
          disabled={allSelected}
        >
          <CheckSquare size={14} className="mr-1" />
          Select All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={onClearSelection}
        >
          Clear
        </Button>
      </div>

      {/* Right: Approve / Reject */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={onApproveSelected}
        >
          <CheckCircle size={14} className="mr-1.5" />
          Approve Selected
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onRejectSelected}
        >
          <XCircle size={14} className="mr-1.5" />
          Reject Selected
        </Button>
      </div>
    </div>
  );
}
