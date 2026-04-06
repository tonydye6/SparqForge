import { Heart, MessageCircle, Repeat2, Share, MoreHorizontal, BadgeCheck } from "lucide-react";

interface TwitterPreviewFrameProps {
  imageUrl?: string;
  username?: string;
  handle?: string;
  caption?: string;
  children?: React.ReactNode;
  overlay?: React.ReactNode;
}

export function TwitterPreviewFrame({ imageUrl, username = "SparqGames", handle = "@sparqgames", caption, children, overlay }: TwitterPreviewFrameProps) {
  return (
    <div className="relative w-full max-w-[320px] mx-auto rounded-xl border border-border bg-white dark:bg-[#15202b] overflow-hidden shadow-xl">
      <div className="px-3 pt-3 pb-2">
        <div className="flex gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-primary">S</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-bold text-foreground truncate">{username}</span>
              <BadgeCheck size={12} className="text-[#1DA1F2] shrink-0" />
              <span className="text-[10px] text-muted-foreground truncate">{handle}</span>
              <span className="text-[10px] text-muted-foreground">· 2h</span>
              <MoreHorizontal size={12} className="text-muted-foreground ml-auto shrink-0" />
            </div>
            {caption && (
              <p className="text-[10px] text-foreground leading-tight mt-1 line-clamp-3">{caption.slice(0, 140)}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mx-3 mb-2 rounded-xl border border-border/50 overflow-hidden aspect-video bg-muted/30 relative">
        {imageUrl ? (
          <img src={imageUrl} alt="Twitter preview" className="w-full h-full object-cover" />
        ) : children ? (
          <div className="w-full h-full">{children}</div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-muted-foreground text-[10px]">16:9</span>
          </div>
        )}
        {overlay}
      </div>

      <div className="px-3 pb-2 flex items-center justify-between text-muted-foreground">
        <div className="flex items-center gap-1">
          <MessageCircle size={12} />
          <span className="text-[9px]">48</span>
        </div>
        <div className="flex items-center gap-1">
          <Repeat2 size={12} />
          <span className="text-[9px]">216</span>
        </div>
        <div className="flex items-center gap-1">
          <Heart size={12} />
          <span className="text-[9px]">1.2K</span>
        </div>
        <div className="flex items-center gap-1">
          <Share size={12} />
        </div>
      </div>
    </div>
  );
}
