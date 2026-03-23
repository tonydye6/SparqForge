import { Check, XCircle, ThumbsUp, ThumbsDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { PlatformPreviewWrapper } from "@/components/review/PlatformPreviewWrapper";

export interface VariantComparisonViewProps {
  variants: Array<{
    id: string;
    platform: string;
    aspectRatio: string;
    caption: string;
    headlineText: string | null;
    compositedImageUrl: string | null;
    rawImageUrl: string | null;
    status: string;
    reviewerComment?: string | null;
  }>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onApprove: (variantId: string) => void;
  onReject: (variantId: string) => void;
}

const PLATFORM_LABELS: Record<string, { name: string; icon: string }> = {
  instagram_feed: { name: "Instagram Feed", icon: "instagram" },
  instagram_story: { name: "Instagram Story", icon: "instagram" },
  twitter: { name: "X (Twitter)", icon: "twitter" },
  linkedin: { name: "LinkedIn", icon: "linkedin" },
  tiktok: { name: "TikTok", icon: "tiktok" },
};

function getStatusBadge(status: string) {
  if (status === "approved") {
    return (
      <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-[10px]">
        <Check size={10} className="mr-0.5" /> Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">
        <XCircle size={10} className="mr-0.5" /> Rejected
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">
      Pending
    </Badge>
  );
}

export function VariantComparisonView({
  variants,
  selectedIds,
  onToggleSelect,
  onApprove,
  onReject,
}: VariantComparisonViewProps) {
  return (
    <div className="flex flex-row overflow-x-auto gap-0 pb-2 hide-scrollbar">
      {variants.map((variant, index) => {
        const label = PLATFORM_LABELS[variant.platform] || {
          name: variant.platform,
          icon: "twitter",
        };
        const isLast = index === variants.length - 1;
        const isPending =
          variant.status !== "approved" && variant.status !== "rejected";

        return (
          <div
            key={variant.id}
            className={`w-[280px] flex-shrink-0 flex flex-col bg-background ${
              !isLast ? "border-r border-border" : ""
            }`}
          >
            {/* Platform header */}
            <div className="p-2.5 border-b border-border flex items-center gap-2 bg-card/50">
              <PlatformIcon platform={label.icon} />
              <span className="font-semibold text-xs truncate">
                {label.name}
              </span>
              <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded ml-auto flex-shrink-0">
                {variant.aspectRatio}
              </span>
            </div>

            {/* Preview image */}
            <div className="flex justify-center p-2 border-b border-border">
              <PlatformPreviewWrapper
                platform={variant.platform}
                imageUrl={variant.compositedImageUrl || variant.rawImageUrl}
                caption={variant.caption}
                headlineText={variant.headlineText}
              />
            </div>

            {/* Caption */}
            <div className="px-2.5 pt-2 pb-1">
              <div className="max-h-32 overflow-y-auto">
                <p className="text-sm text-muted-foreground">
                  {variant.caption}
                </p>
              </div>
            </div>

            {/* Character count */}
            <div className="px-2.5 pb-2">
              <span className="text-[10px] text-muted-foreground">
                {variant.caption.length} chars
              </span>
            </div>

            {/* Status badge */}
            <div className="px-2.5 pb-2 flex items-center">
              {getStatusBadge(variant.status)}
            </div>

            {/* Action buttons */}
            {isPending && (
              <div className="px-2.5 pb-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                  onClick={() => onReject(variant.id)}
                >
                  <ThumbsDown size={12} className="mr-1" /> Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex-1 border-green-500/30 text-green-400 hover:bg-green-500/10 hover:text-green-400"
                  onClick={() => onApprove(variant.id)}
                >
                  <ThumbsUp size={12} className="mr-1" /> Approve
                </Button>
              </div>
            )}

            {/* Checkbox for bulk selection */}
            <div className="px-2.5 pb-2.5 mt-auto border-t border-border pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedIds.has(variant.id)}
                  onCheckedChange={() => onToggleSelect(variant.id)}
                />
                <span className="text-xs text-muted-foreground">Select</span>
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
