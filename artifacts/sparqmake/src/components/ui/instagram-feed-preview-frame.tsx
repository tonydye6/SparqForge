import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal } from "lucide-react";

interface InstagramFeedPreviewFrameProps {
  imageUrl?: string;
  username?: string;
  caption?: string;
  children?: React.ReactNode;
  overlay?: React.ReactNode;
}

export function InstagramFeedPreviewFrame({ imageUrl, username = "@sparqgames", caption, children, overlay }: InstagramFeedPreviewFrameProps) {
  return (
    <div className="relative w-full max-w-[270px] mx-auto rounded-lg border border-border bg-white dark:bg-[#1a1a1a] overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] flex items-center justify-center">
          <div className="w-6 h-6 rounded-full bg-white dark:bg-[#1a1a1a] flex items-center justify-center">
            <span className="text-[7px] font-bold text-foreground">S</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-foreground truncate">{username}</p>
          <p className="text-[8px] text-muted-foreground">Sponsored</p>
        </div>
        <MoreHorizontal size={14} className="text-muted-foreground" />
      </div>

      <div className="w-full aspect-square bg-muted/30 relative">
        {imageUrl ? (
          <img src={imageUrl} alt="Instagram Feed preview" className="w-full h-full object-cover" />
        ) : children ? (
          <div className="w-full h-full">{children}</div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-muted-foreground text-[10px]">1:1</span>
          </div>
        )}
        {overlay}
      </div>

      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Heart size={16} className="text-foreground" />
            <MessageCircle size={16} className="text-foreground" />
            <Send size={16} className="text-foreground" />
          </div>
          <Bookmark size={16} className="text-foreground" />
        </div>
        <p className="text-[9px] font-semibold text-foreground">1,247 likes</p>
        {caption && (
          <p className="text-[9px] text-foreground leading-tight line-clamp-2">
            <span className="font-semibold">{username}</span>{" "}
            {caption.slice(0, 80)}{caption.length > 80 ? "..." : ""}
          </p>
        )}
      </div>
    </div>
  );
}
