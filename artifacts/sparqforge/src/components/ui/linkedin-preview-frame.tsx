import { ThumbsUp, MessageSquare, Repeat2, Send, MoreHorizontal, Globe } from "lucide-react";

interface LinkedInPreviewFrameProps {
  imageUrl?: string;
  username?: string;
  caption?: string;
  children?: React.ReactNode;
  overlay?: React.ReactNode;
}

export function LinkedInPreviewFrame({ imageUrl, username = "SparqGames", caption, children, overlay }: LinkedInPreviewFrameProps) {
  return (
    <div className="relative w-full max-w-[320px] mx-auto rounded-lg border border-border bg-white dark:bg-[#1b1f23] overflow-hidden shadow-xl">
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start gap-2">
          <div className="w-9 h-9 rounded-full bg-[#0A66C2]/20 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-[#0A66C2]">S</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-foreground">{username}</p>
            <p className="text-[9px] text-muted-foreground">Gaming Company · 12,450 followers</p>
            <p className="text-[9px] text-muted-foreground flex items-center gap-0.5">2h · <Globe size={8} /></p>
          </div>
          <MoreHorizontal size={14} className="text-muted-foreground shrink-0" />
        </div>
        {caption && (
          <p className="text-[10px] text-foreground leading-tight mt-2 line-clamp-3">
            {caption.slice(0, 150)}
            {caption.length > 150 && <span className="text-[#0A66C2] cursor-pointer"> ...see more</span>}
          </p>
        )}
      </div>

      <div className="w-full aspect-video bg-muted/30 relative">
        {imageUrl ? (
          <img src={imageUrl} alt="LinkedIn preview" className="w-full h-full object-cover" />
        ) : children ? (
          <div className="w-full h-full">{children}</div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-muted-foreground text-[10px]">16:9</span>
          </div>
        )}
        {overlay}
      </div>

      <div className="px-3 py-1 border-b border-border/30">
        <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="flex -space-x-1">
            <span className="w-3 h-3 rounded-full bg-[#0A66C2] inline-block border border-white dark:border-[#1b1f23]" />
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block border border-white dark:border-[#1b1f23]" />
            <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block border border-white dark:border-[#1b1f23]" />
          </span>
          <span>847 reactions · 23 comments</span>
        </div>
      </div>

      <div className="px-2 py-1 flex items-center justify-around text-muted-foreground">
        <div className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50">
          <ThumbsUp size={12} />
          <span className="text-[9px] font-medium">Like</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50">
          <MessageSquare size={12} />
          <span className="text-[9px] font-medium">Comment</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50">
          <Repeat2 size={12} />
          <span className="text-[9px] font-medium">Repost</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50">
          <Send size={12} />
          <span className="text-[9px] font-medium">Send</span>
        </div>
      </div>
    </div>
  );
}
