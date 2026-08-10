import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/utils";

/**
 * The channels a post can actually publish to, for whichever stage is asking.
 *
 * WHY THIS IS A HOOK RATHER THAN A CONSTANT IN EACH STAGE. It used to be a
 * constant in each stage, and they disagreed: stage 04 listed Instagram feed,
 * X, LinkedIn and TikTok; stage 05 listed Instagram feed, Instagram story,
 * TikTok and X; stage 01 read the brand's connected accounts and listed
 * whatever was really there. So a post got LinkedIn copy that could never
 * publish and a Story crop nothing had written copy for.
 *
 * The server resolves this from connected accounts, which is the same fact the
 * publish scheduler enforces at send time, so the whole flow now agrees with
 * the thing that eventually has to be true.
 */

export interface Channel {
  platform: string;
  label: string;
  accountPlatform: string;
  aspectLabel: string;
  furnitureMapped: boolean;
  hasSafeAreas: boolean;
  hasCopyRules: boolean;
}

export function useChannels(creativeId: string): {
  channels: Channel[] | null;
  emptyReason: string | null;
} {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const creativeRes = await apiFetch(`/api/creatives/${creativeId}`);
        if (!creativeRes.ok || cancelled) return;
        const creative = await creativeRes.json();
        if (!creative?.brandId || cancelled) return;

        const res = await apiFetch(`/api/brands/${creative.brandId}/channels`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (cancelled) return;
        setChannels(body.channels ?? []);
        setEmptyReason(body.emptyReason ?? null);
      } catch {
        // Null stays null, and each stage decides what to render while it does
        // not know. Guessing a channel set here is exactly the bug this
        // replaced.
      }
    })();
    return () => { cancelled = true; };
  }, [creativeId]);

  return { channels, emptyReason };
}
