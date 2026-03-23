export const API_BASE = import.meta.env.VITE_API_URL || "";

export interface GeneratedVariant {
  id?: string;
  platform: string;
  aspectRatio: string;
  rawImageUrl: string | null;
  compositedImageUrl: string | null;
  caption: string;
  headlineText: string | null;
  imageVersion?: number;
  videoUrl?: string | null;
  audioSource?: string | null;
  audioUrl?: string | null;
  mergedVideoUrl?: string | null;
}

export interface ActivityLog {
  time: string;
  text: string;
  status: "pending" | "done" | "error";
}

export interface DuplicateInfo {
  duplicate: boolean;
  campaignId?: string;
  campaignName?: string;
  createdAt?: string;
}

export interface BudgetStatus {
  threshold: number | null;
  todaySpend: number;
  remaining: number | null;
  overBudget: boolean;
  nearLimit: boolean;
}

export interface RewriteToolbarState {
  platform: string;
  selectedText: string;
  selectionStart: number;
  selectionEnd: number;
  position: { top: number; left: number };
}

export type LoadingPhase = Record<string, { caption: boolean; image: boolean }>;

export const PLATFORM_LABELS: Record<string, { name: string; platformIcon: string; ratio: string }> = {
  instagram_feed: { name: "Instagram Feed", platformIcon: "instagram", ratio: "1:1" },
  instagram_story: { name: "Instagram Story", platformIcon: "instagram", ratio: "9:16" },
  twitter: { name: "X (Twitter)", platformIcon: "twitter", ratio: "16:9" },
  linkedin: { name: "LinkedIn", platformIcon: "linkedin", ratio: "16:9" },
  tiktok: { name: "TikTok", platformIcon: "tiktok", ratio: "9:16" },
};

export const ALL_PLATFORM_KEYS = Object.keys(PLATFORM_LABELS);

export const PLAN_PLATFORM_MAP: Record<string, string[]> = {
  instagram: ["instagram_feed", "instagram_story"],
  tiktok: ["tiktok"],
  youtube: ["tiktok"],
  linkedin: ["linkedin"],
  x: ["twitter"],
  facebook: ["instagram_feed"],
  threads: ["instagram_feed"],
};
