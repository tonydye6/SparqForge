import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WizardStepShell } from "@/components/setup/WizardStepShell";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface StepConfigureVoiceProps {
  brandId: string | null;
  readiness: { checks?: { voice?: { passed: boolean } } } | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function StepConfigureVoice({
  brandId,
  readiness,
  onNext,
  onBack,
  onSkip,
}: StepConfigureVoiceProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [voiceDescription, setVoiceDescription] = useState("");
  const [bannedTermsInput, setBannedTermsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!brandId) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/brands/${brandId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceDescription,
          bannedTerms: bannedTermsInput
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Server error ${res.status}`);
      }

      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["brand-readiness", brandId] });
      toast({
        title: "Brand voice saved",
        description: "Your voice settings have been updated.",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      toast({
        title: "Failed to save brand voice",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardStepShell
      title="Define your brand voice"
      description="This guides AI-generated captions to match your tone"
      canNext={readiness?.checks?.voice?.passed ?? false}
      showBack={true}
      showSkip={true}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
    >
      <div className="space-y-6">
        {/* Voice Description */}
        <div className="space-y-1.5">
          <Label htmlFor="voice-description">Brand voice description</Label>
          <Textarea
            id="voice-description"
            rows={5}
            placeholder="Describe how your brand sounds — casual and playful? Professional and authoritative? Give examples of phrases you'd use."
            value={voiceDescription}
            onChange={(e) => {
              setVoiceDescription(e.target.value);
              setSaved(false);
            }}
          />
        </div>

        {/* Banned Terms */}
        <div className="space-y-1.5">
          <Label htmlFor="banned-terms">Banned terms (optional)</Label>
          <Input
            id="banned-terms"
            placeholder="e.g., cheap, discount, competitor-name"
            value={bannedTermsInput}
            onChange={(e) => {
              setBannedTermsInput(e.target.value);
              setSaved(false);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated words that should never appear in generated content
          </p>
        </div>

        {/* Save button + saved badge */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={handleSave}
            disabled={saving || !brandId}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved && (
            <Badge className="bg-green-500 text-white border-transparent">
              Saved!
            </Badge>
          )}
        </div>
      </div>
    </WizardStepShell>
  );
}
