import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { WizardStepShell } from "@/components/setup/WizardStepShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { STARTER_TEMPLATES } from "@/lib/setup-defaults";

interface StepCreateTemplateProps {
  brandId: string | null;
  readiness: { checks?: { templates?: { passed: boolean } } } | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function StepCreateTemplate({
  brandId,
  readiness,
  onNext,
  onBack,
  onSkip,
}: StepCreateTemplateProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");

  const isCustomFilled = customName.trim().length > 0 && customDescription.trim().length > 0;
  const canCreate = !creating && !!brandId && (selectedIndex !== null || (showCustom && isCustomFilled));

  const handleCreate = async () => {
    if (!brandId || !canCreate) return;

    setCreating(true);
    try {
      const body =
        showCustom && selectedIndex === null
          ? { brandId, name: customName.trim(), description: customDescription.trim(), isActive: true }
          : { brandId, ...STARTER_TEMPLATES[selectedIndex!], isActive: true };

      const res = await fetch("/api/templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message ?? `Server error ${res.status}`);
      }

      setCreated(true);
      queryClient.invalidateQueries({ queryKey: ["brand-readiness", brandId] });
      toast({
        title: "Template created!",
        description: "Your template is ready for content generation.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({
        title: "Failed to create template",
        description: message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleReset = () => {
    setCreated(false);
    setSelectedIndex(null);
    setShowCustom(false);
    setCustomName("");
    setCustomDescription("");
  };

  const handleSelectStarter = (index: number) => {
    setSelectedIndex(index);
    setShowCustom(false);
  };

  const handleShowCustom = () => {
    setShowCustom(true);
    setSelectedIndex(null);
  };

  return (
    <WizardStepShell
      title="Choose your first template"
      description="Templates control how AI generates your content"
      canNext={readiness?.checks?.templates?.passed ?? false}
      showBack={true}
      showSkip={true}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
    >
      <div className="space-y-6">
        {created ? (
          /* Post-creation state */
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <p className="text-base font-semibold text-foreground">Template created!</p>
            <p className="text-sm text-muted-foreground">
              Your template is active and ready for content generation.
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
            >
              Create another
            </button>
          </div>
        ) : (
          <>
            {/* Starter template cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STARTER_TEMPLATES.map((template, index) => {
                const isSelected = selectedIndex === index && !showCustom;
                return (
                  <Card
                    key={template.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectStarter(index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectStarter(index);
                      }
                    }}
                    className={[
                      "p-4 cursor-pointer transition-colors select-none",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isSelected
                        ? "border-primary ring-1 ring-primary bg-primary/5"
                        : "hover:border-primary/50",
                    ].join(" ")}
                  >
                    <p className="font-semibold text-sm text-foreground leading-snug">
                      {template.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                  </Card>
                );
              })}
            </div>

            {/* "or Create Custom" toggle */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">or</span>
              <button
                type="button"
                onClick={handleShowCustom}
                className={[
                  "text-sm underline-offset-4 hover:underline transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded",
                  showCustom ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                Create Custom
              </button>
            </div>

            {/* Custom template form */}
            {showCustom && (
              <div className="space-y-4 rounded-xl border border-primary/40 bg-primary/5 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="custom-template-name">Template name</Label>
                  <Input
                    id="custom-template-name"
                    placeholder="e.g. Product Spotlight"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="custom-template-description">Description</Label>
                  <Textarea
                    id="custom-template-description"
                    rows={3}
                    placeholder="Describe what this template is used for…"
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Use this template button */}
            <Button
              type="button"
              variant="default"
              disabled={!canCreate}
              onClick={handleCreate}
            >
              {creating ? "Creating…" : "Use this template"}
            </Button>
          </>
        )}
      </div>
    </WizardStepShell>
  );
}
