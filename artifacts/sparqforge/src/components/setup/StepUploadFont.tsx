import React, { useRef, useState } from "react";
import { Type, Check } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { WizardStepShell } from "@/components/setup/WizardStepShell";
import { useToast } from "@/hooks/use-toast";
import { cn, apiFetch } from "@/lib/utils";

interface StepUploadFontProps {
  brandId: string | null;
  readiness: { checks?: { fonts?: { passed: boolean } } } | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

interface UploadedFont {
  name: string;
  weight: string;
}

export default function StepUploadFont({
  brandId,
  readiness,
  onNext,
  onBack,
  onSkip,
}: StepUploadFontProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadedFonts, setUploadedFonts] = useState<UploadedFont[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const ACCEPTED_EXTENSIONS = [".woff2", ".ttf", ".otf"];

  function stripExtension(filename: string): string {
    return filename.replace(/\.(woff2|ttf|otf)$/i, "");
  }

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
    const validFiles = fileArray.filter((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      return ext && ["woff2", "ttf", "otf"].includes(ext);
    });

    if (validFiles.length === 0) {
      toast({
        title: "Invalid file type",
        description: "Only .woff2, .ttf, and .otf files are supported.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    const uploadPromises = validFiles.map(async (file) => {
      const fontName = stripExtension(file.name);
      const fontWeight = "400";

      const formData = new FormData();
      formData.append("font", file);
      formData.append("fontName", fontName);
      formData.append("fontWeight", fontWeight);

      const res = await apiFetch(`/api/brands/${brandId}/fonts`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Server error ${res.status}`);
      }

      return { name: fontName, weight: fontWeight, fileName: file.name };
    });

    const results = await Promise.allSettled(uploadPromises);

    for (const result of results) {
      if (result.status === "fulfilled") {
        setUploadedFonts((prev) => [...prev, { name: result.value.name, weight: result.value.weight }]);
      } else {
        const message = result.reason instanceof Error ? result.reason.message : "Upload failed";
        const fileName = validFiles[results.indexOf(result)]?.name ?? "unknown";
        toast({
          title: `Failed to upload "${fileName}"`,
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
      // Reset input so the same file can be re-selected if needed
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

  const fontsPassed = readiness?.checks?.fonts?.passed ?? false;

  return (
    <WizardStepShell
      title="Add your brand font"
      description="Headlines in generated images will use this font"
      canNext={fontsPassed}
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
          accept={ACCEPTED_EXTENSIONS.join(",")}
          multiple
          className="hidden"
          onChange={handleFileInputChange}
          aria-label="Upload font files"
        />

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop font files here or click to browse"
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
            "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-background hover:border-primary/50"
          )}
        >
          <Type
            size={32}
            className={cn(
              "mx-auto mb-3 transition-colors",
              isDragOver ? "text-primary" : "text-muted-foreground"
            )}
          />
          <p className="text-sm font-medium text-foreground">
            {uploading ? "Uploading…" : "Drop font files here or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Accepted formats: .woff2, .ttf, .otf
          </p>
        </div>

        {/* Uploaded fonts list */}
        {uploadedFonts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Uploaded this session
            </p>
            {uploadedFonts.map((font, index) => (
              <div
                key={index}
                className="flex items-center gap-3 px-4 py-3 border border-border bg-background rounded-lg"
              >
                <Check size={16} className="text-emerald-500 shrink-0" />
                <span className="text-sm font-medium text-foreground flex-1 truncate">
                  {font.name}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  Weight {font.weight}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </WizardStepShell>
  );
}
