import React, { useRef, useState } from "react";
import { ImagePlus, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { WizardStepShell } from "@/components/setup/WizardStepShell";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface StepUploadAssetProps {
  brandId: string | null;
  readiness: { checks?: { approvedAssets?: { passed: boolean } } } | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

interface UploadedAsset {
  name: string;
  thumbnailUrl: string;
}

export default function StepUploadAsset({
  brandId,
  readiness,
  onNext,
  onBack,
  onSkip,
}: StepUploadAssetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  async function uploadFiles(files: FileList | File[]) {
    if (!brandId) {
      toast({
        title: "No brand selected",
        description: "Please complete the brand creation step first.",
        variant: "destructive",
      });
      return;
    }

    const fileArray = Array.from(files);

    setUploading(true);

    const uploadPromises = fileArray.map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!uploadRes.ok) {
        const body = await uploadRes.json().catch(() => ({}));
        throw new Error(body?.message ?? `Upload failed (${uploadRes.status})`);
      }

      const { url, thumbnailUrl } = await uploadRes.json();

      const assetRes = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          brandId,
          name: file.name,
          type: "visual",
          status: "approved",
          fileUrl: url,
          thumbnailUrl,
          mimeType: file.type,
          fileSizeBytes: file.size,
        }),
      });

      if (!assetRes.ok) {
        const body = await assetRes.json().catch(() => ({}));
        throw new Error(body?.message ?? `Asset creation failed (${assetRes.status})`);
      }

      return { name: file.name, thumbnailUrl: thumbnailUrl ?? url };
    });

    const results = await Promise.allSettled(uploadPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        setUploadedAssets((prev) => [
          ...prev,
          { name: result.value.name, thumbnailUrl: result.value.thumbnailUrl },
        ]);
      } else {
        const message = result.reason instanceof Error ? result.reason.message : "Upload failed";
        toast({
          title: `Failed to upload "${fileArray[i].name}"`,
          description: message,
          variant: "destructive",
        });
      }
    }

    if (results.some((r) => r.status === "fulfilled")) {
      await queryClient.invalidateQueries({ queryKey: ["brand-readiness", brandId] });
    }

    setUploading(false);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      // Reset so the same file can be re-selected
      e.target.value = "";
    }
  }

  function handleDropZoneClick() {
    inputRef.current?.click();
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  }

  const canNext = readiness?.checks?.approvedAssets?.passed ?? false;

  return (
    <WizardStepShell
      title="Upload visual assets"
      description="Add images for your first campaign — they'll be approved automatically"
      canNext={canNext}
      showBack
      showSkip
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
    >
      <div className="space-y-4">
        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
          aria-label="Upload visual asset files"
        />

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop visual assets here or click to browse"
          onClick={handleDropZoneClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleDropZoneClick();
            }
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "relative border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-background hover:border-primary/50"
          )}
        >
          {/* Spinner overlay during upload */}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-sm">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          <ImagePlus
            size={32}
            className={cn(
              "mx-auto mb-3 transition-colors",
              isDragOver ? "text-primary" : "text-muted-foreground"
            )}
          />
          <p className="text-sm font-medium text-foreground">
            Drop visual assets here or click to browse
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Accepted formats: PNG, JPEG, WebP
          </p>
        </div>

        {/* Uploaded assets thumbnail grid */}
        {uploadedAssets.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Uploaded this session
            </p>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
              {uploadedAssets.map((asset, index) => (
                <div key={index} className="relative group">
                  <div className="aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                    <img
                      src={asset.thumbnailUrl}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* Approval check badge */}
                  <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 shadow">
                    <Check size={10} className="text-white" strokeWidth={3} />
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground truncate" title={asset.name}>
                    {asset.name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WizardStepShell>
  );
}
