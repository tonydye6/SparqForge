import { apiFetch } from "@/lib/utils";
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WizardStepShell } from "@/components/setup/WizardStepShell";
import { DEFAULT_PLATFORM_RULES } from "@/lib/setup-defaults";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface StepPlatformRulesProps {
  brandId: string | null;
  readiness: { checks?: { platformRules?: { passed: boolean } } } | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

type PlatformRules = typeof DEFAULT_PLATFORM_RULES;

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function StepPlatformRules({
  brandId,
  readiness,
  onNext,
  onBack,
  onSkip,
}: StepPlatformRulesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [rules, setRules] = useState<PlatformRules>(() =>
    deepClone(DEFAULT_PLATFORM_RULES)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveRules = async (rulesToSave: PlatformRules): Promise<boolean> => {
    if (!brandId) return false;

    setSaving(true);
    try {
      const res = await apiFetch(`/api/brands/${brandId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformRules: JSON.stringify(rulesToSave) }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Server error ${res.status}`);
      }

      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["brand-readiness", brandId] });
      toast({
        title: "Platform rules saved",
        description: "Your platform rules have been updated.",
      });
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      toast({
        title: "Failed to save platform rules",
        description: message,
        variant: "destructive",
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptDefaults = async () => {
    const defaultRules = deepClone(DEFAULT_PLATFORM_RULES);
    setRules(defaultRules);
    const ok = await saveRules(defaultRules);
    if (ok) {
      onNext();
    }
  };

  const handleSaveCustom = async () => {
    await saveRules(rules);
  };

  const updateField = <
    P extends keyof PlatformRules,
    F extends keyof PlatformRules[P]
  >(
    platform: P,
    field: F,
    value: PlatformRules[P][F]
  ) => {
    setSaved(false);
    setRules((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        [field]: value,
      },
    }));
  };

  const parseNumber = (val: string): number => {
    const n = parseInt(val, 10);
    return isNaN(n) ? 0 : n;
  };

  return (
    <WizardStepShell
      title="Set platform rules"
      description="Character limits and hashtag rules for each social platform"
      canNext={readiness?.checks?.platformRules?.passed ?? false}
      showBack={true}
      showSkip={true}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
    >
      <div className="space-y-6">
        <Tabs defaultValue="twitter">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="twitter">Twitter</TabsTrigger>
            <TabsTrigger value="instagram_feed">Instagram Feed</TabsTrigger>
            <TabsTrigger value="instagram_story">Instagram Story</TabsTrigger>
            <TabsTrigger value="linkedin">LinkedIn</TabsTrigger>
            <TabsTrigger value="tiktok">TikTok</TabsTrigger>
          </TabsList>

          {/* Twitter */}
          <TabsContent value="twitter">
            <div className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="twitter-char-limit">Character limit</Label>
                <Input
                  id="twitter-char-limit"
                  type="number"
                  min={1}
                  value={rules.twitter.char_limit}
                  onChange={(e) =>
                    updateField("twitter", "char_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="twitter-hashtag-limit">Hashtag limit</Label>
                <Input
                  id="twitter-hashtag-limit"
                  type="number"
                  min={0}
                  value={rules.twitter.hashtag_limit}
                  onChange={(e) =>
                    updateField("twitter", "hashtag_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="twitter-thread-max">Thread max</Label>
                <Input
                  id="twitter-thread-max"
                  type="number"
                  min={1}
                  value={rules.twitter.thread_max}
                  onChange={(e) =>
                    updateField("twitter", "thread_max", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="twitter-media-required">Media required</Label>
                <input
                  id="twitter-media-required"
                  type="checkbox"
                  checked={rules.twitter.media_required}
                  onChange={(e) =>
                    updateField("twitter", "media_required", e.target.checked)
                  }
                  className="h-4 w-4 rounded border-input accent-primary"
                />
              </div>
            </div>
          </TabsContent>

          {/* Instagram Feed */}
          <TabsContent value="instagram_feed">
            <div className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="ig-feed-char-limit">Character limit</Label>
                <Input
                  id="ig-feed-char-limit"
                  type="number"
                  min={1}
                  value={rules.instagram_feed.char_limit}
                  onChange={(e) =>
                    updateField("instagram_feed", "char_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ig-feed-hashtag-limit">Hashtag limit</Label>
                <Input
                  id="ig-feed-hashtag-limit"
                  type="number"
                  min={0}
                  value={rules.instagram_feed.hashtag_limit}
                  onChange={(e) =>
                    updateField("instagram_feed", "hashtag_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ig-feed-hashtag-placement">Hashtag placement</Label>
                <Input
                  id="ig-feed-hashtag-placement"
                  type="text"
                  value={rules.instagram_feed.hashtag_placement}
                  onChange={(e) =>
                    updateField("instagram_feed", "hashtag_placement", e.target.value)
                  }
                  placeholder="e.g. first_comment, caption"
                />
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="ig-feed-media-required">Media required</Label>
                <input
                  id="ig-feed-media-required"
                  type="checkbox"
                  checked={rules.instagram_feed.media_required}
                  onChange={(e) =>
                    updateField("instagram_feed", "media_required", e.target.checked)
                  }
                  className="h-4 w-4 rounded border-input accent-primary"
                />
              </div>
            </div>
          </TabsContent>

          {/* Instagram Story */}
          <TabsContent value="instagram_story">
            <div className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="ig-story-char-limit">Character limit</Label>
                <Input
                  id="ig-story-char-limit"
                  type="number"
                  min={1}
                  value={rules.instagram_story.char_limit}
                  onChange={(e) =>
                    updateField("instagram_story", "char_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ig-story-max-duration">Max duration (seconds)</Label>
                <Input
                  id="ig-story-max-duration"
                  type="number"
                  min={1}
                  value={rules.instagram_story.max_duration_seconds}
                  onChange={(e) =>
                    updateField("instagram_story", "max_duration_seconds", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="ig-story-media-required">Media required</Label>
                <input
                  id="ig-story-media-required"
                  type="checkbox"
                  checked={rules.instagram_story.media_required}
                  onChange={(e) =>
                    updateField("instagram_story", "media_required", e.target.checked)
                  }
                  className="h-4 w-4 rounded border-input accent-primary"
                />
              </div>
            </div>
          </TabsContent>

          {/* LinkedIn */}
          <TabsContent value="linkedin">
            <div className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="linkedin-char-limit">Character limit</Label>
                <Input
                  id="linkedin-char-limit"
                  type="number"
                  min={1}
                  value={rules.linkedin.char_limit}
                  onChange={(e) =>
                    updateField("linkedin", "char_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="linkedin-hashtag-limit">Hashtag limit</Label>
                <Input
                  id="linkedin-hashtag-limit"
                  type="number"
                  min={0}
                  value={rules.linkedin.hashtag_limit}
                  onChange={(e) =>
                    updateField("linkedin", "hashtag_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="linkedin-professional-tone">Professional tone</Label>
                <input
                  id="linkedin-professional-tone"
                  type="checkbox"
                  checked={rules.linkedin.professional_tone}
                  onChange={(e) =>
                    updateField("linkedin", "professional_tone", e.target.checked)
                  }
                  className="h-4 w-4 rounded border-input accent-primary"
                />
              </div>
            </div>
          </TabsContent>

          {/* TikTok */}
          <TabsContent value="tiktok">
            <div className="space-y-4 pt-4">
              <div className="space-y-1.5">
                <Label htmlFor="tiktok-char-limit">Character limit</Label>
                <Input
                  id="tiktok-char-limit"
                  type="number"
                  min={1}
                  value={rules.tiktok.char_limit}
                  onChange={(e) =>
                    updateField("tiktok", "char_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tiktok-hashtag-limit">Hashtag limit</Label>
                <Input
                  id="tiktok-hashtag-limit"
                  type="number"
                  min={0}
                  value={rules.tiktok.hashtag_limit}
                  onChange={(e) =>
                    updateField("tiktok", "hashtag_limit", parseNumber(e.target.value))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tiktok-max-duration">Max duration (seconds)</Label>
                <Input
                  id="tiktok-max-duration"
                  type="number"
                  min={1}
                  value={rules.tiktok.max_duration_seconds}
                  onChange={(e) =>
                    updateField("tiktok", "max_duration_seconds", parseNumber(e.target.value))
                  }
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            type="button"
            variant="default"
            onClick={handleAcceptDefaults}
            disabled={saving || !brandId}
          >
            {saving ? "Saving…" : "Accept defaults & continue"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSaveCustom}
            disabled={saving || !brandId}
          >
            {saving ? "Saving…" : "Save custom rules"}
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
