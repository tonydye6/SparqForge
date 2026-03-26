import { Skeleton } from "@/components/ui/skeleton";

export function CreativeStudioSkeleton() {
  return (
    <div className="flex h-full w-full bg-background overflow-hidden">
      {/* Left sidebar skeleton (~320px) */}
      <aside className="w-[320px] shrink-0 border-r border-border bg-card/50 flex flex-col z-20 shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <Skeleton className="h-6 w-40" />
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Creative name input */}
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-full" />
          </div>

          {/* Brand select */}
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>

          {/* Template select */}
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>

          {/* Asset thumbnails — 3x2 grid */}
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-md" />
              ))}
            </div>
          </div>

          {/* Brief / textarea area */}
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-[120px] w-full mt-2" />
          </div>
        </div>

        {/* Footer: platform chips + generate button */}
        <div className="p-4 border-t border-border bg-background shadow-[0_-4px_10px_rgba(0,0,0,0.2)] space-y-2">
          {/* Platform pill chips — row of 5 */}
          <div className="flex flex-wrap gap-1 mb-1">
            <Skeleton className="h-3 w-14 mb-0.5 basis-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-14 rounded-full" />
            ))}
          </div>
          {/* Generate button */}
          <Skeleton className="h-9 w-full" />
          {/* Generate Video button */}
          <Skeleton className="h-9 w-full" />
        </div>
      </aside>

      {/* Center panel (flex-1) */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Refine bar */}
        <div className="p-4 border-b border-border">
          <Skeleton className="h-9 w-full" />
        </div>

        {/* 2x2 grid of card skeletons */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-card overflow-hidden space-y-3 p-3">
                {/* 16:9 aspect ratio placeholder */}
                <Skeleton className="w-full aspect-video rounded" />
                {/* Caption lines */}
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right sidebar skeleton (~280px) */}
      <aside className="w-[280px] shrink-0 border-l border-border bg-card/50 flex flex-col z-20 shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-6 w-20 rounded" />
        </div>

        {/* Activity log */}
        <div className="flex-1 p-4 space-y-4">
          <Skeleton className="h-3 w-20" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 items-start">
                <Skeleton className="w-5 h-5 rounded-full shrink-0" />
                <Skeleton className="h-3 flex-1" />
              </div>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="p-4 border-t border-border space-y-2 bg-background">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </aside>
    </div>
  );
}
