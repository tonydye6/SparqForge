import { Heart, MessageCircle, Share2, Bookmark, Music } from "lucide-react";

interface TikTokPreviewFrameProps {
  imageUrl?: string;
  username?: string;
  caption?: string;
  children?: React.ReactNode;
}

export function TikTokPreviewFrame({ imageUrl, username = "@sparqgames", caption, children }: TikTokPreviewFrameProps) {
  return (
    <div className="relative w-full max-w-[270px] mx-auto aspect-[9/16] rounded-[2rem] border-2 border-border bg-black overflow-hidden shadow-xl">
      {imageUrl ? (
        <img src={imageUrl} alt="TikTok preview" className="absolute inset-0 w-full h-full object-cover" />
      ) : children ? (
        <div className="absolute inset-0">{children}</div>
      ) : (
        <div className="absolute inset-0 bg-muted/30 flex items-center justify-center">
          <Music size={32} className="text-muted-foreground opacity-30" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

      <div className="absolute top-3 left-0 right-0 flex justify-center">
        <div className="flex gap-4 text-white/80 text-xs font-semibold">
          <span className="opacity-60">Following</span>
          <span className="border-b-2 border-white pb-0.5">For You</span>
        </div>
      </div>

      <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4">
        <div className="w-8 h-8 rounded-full bg-white/20 border border-white/40 flex items-center justify-center">
          <span className="text-[8px] text-white font-bold">S</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Heart size={22} className="text-white" />
          <span className="text-[9px] text-white">24.5K</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <MessageCircle size={22} className="text-white" />
          <span className="text-[9px] text-white">482</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Bookmark size={20} className="text-white" />
          <span className="text-[9px] text-white">1,203</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <Share2 size={20} className="text-white" />
          <span className="text-[9px] text-white">Share</span>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 right-14 space-y-1.5">
        <p className="text-white text-xs font-bold">{username}</p>
        {caption && (
          <p className="text-white/90 text-[10px] leading-tight line-clamp-2">{caption}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1">
          <Music size={10} className="text-white" />
          <div className="overflow-hidden">
            <p className="text-white/70 text-[9px] whitespace-nowrap animate-marquee">Original Sound - sparqgames</p>
          </div>
        </div>
      </div>
    </div>
  );
}
