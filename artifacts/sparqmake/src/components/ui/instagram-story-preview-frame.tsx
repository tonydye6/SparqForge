import { Heart, Send, ChevronUp } from "lucide-react";

interface InstagramStoryPreviewFrameProps {
  imageUrl?: string;
  username?: string;
  caption?: string;
  children?: React.ReactNode;
  overlay?: React.ReactNode;
}

export function InstagramStoryPreviewFrame({ imageUrl, username = "@sparqgames", caption, children, overlay }: InstagramStoryPreviewFrameProps) {
  return (
    <div className="relative w-full max-w-[270px] mx-auto aspect-[9/16] rounded-[2rem] border-2 border-border bg-black overflow-hidden shadow-xl">
      {imageUrl ? (
        <img src={imageUrl} alt="Instagram Story preview" className="absolute inset-0 w-full h-full object-cover" />
      ) : children ? (
        <div className="absolute inset-0">{children}</div>
      ) : (
        <div className="absolute inset-0 bg-muted/30 flex items-center justify-center">
          <span className="text-muted-foreground text-xs">9:16</span>
        </div>
      )}

      <div className="absolute top-0 left-0 right-0 px-3 pt-3 space-y-2">
        <div className="w-full h-0.5 bg-white/30 rounded-full overflow-hidden">
          <div className="w-1/3 h-full bg-white rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] p-[2px]">
            <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
              <span className="text-[7px] font-bold text-white">S</span>
            </div>
          </div>
          <p className="text-[10px] font-semibold text-white">{username}</p>
          <span className="text-[9px] text-white/50">2h</span>
        </div>
      </div>

      {overlay}

      <div className="absolute bottom-0 left-0 right-0 px-3 pb-3 space-y-2">
        {caption && (
          <p className="text-white/90 text-[10px] leading-tight line-clamp-2 drop-shadow-md">{caption.slice(0, 60)}</p>
        )}
        <div className="flex items-center gap-2">
          <div className="flex-1 border border-white/30 rounded-full px-3 py-1.5">
            <p className="text-[9px] text-white/60">Send message</p>
          </div>
          <Heart size={18} className="text-white" />
          <Send size={18} className="text-white" />
        </div>
        <div className="flex justify-center">
          <ChevronUp size={14} className="text-white/50" />
        </div>
      </div>
    </div>
  );
}
