export interface RejectCategory {
  slug: string;
  label: string;
  description: string;
}

export const REJECT_CATEGORIES: RejectCategory[] = [
  {
    slug: "off_brand",
    label: "Off-Brand",
    description: "Colors, voice, or visual style doesn't match brand guidelines",
  },
  {
    slug: "image_quality",
    label: "Image Quality",
    description: "Artifacts, wrong composition, poor lighting, or visual defects",
  },
  {
    slug: "caption_issues",
    label: "Caption Issues",
    description: "Tone, length, grammar, or hashtag problems",
  },
  {
    slug: "headline_issues",
    label: "Headline Issues",
    description: "Overlay text is wrong, illegible, or poorly positioned",
  },
  {
    slug: "platform_mismatch",
    label: "Platform Mismatch",
    description: "Content doesn't suit the target platform's format or audience",
  },
  {
    slug: "trademark_violation",
    label: "Trademark/Legal",
    description: "Missing or incorrect trademark usage, banned terms, legal issues",
  },
  {
    slug: "other",
    label: "Other",
    description: "Provide details in the comment below",
  },
];

export function formatRejectComment(category: string, comment: string): string {
  return `[CATEGORY:${category}] ${comment}`;
}

export function parseRejectComment(raw: string): {
  category: string | null;
  comment: string;
} {
  const match = raw.match(/^\[CATEGORY:([^\]]+)\]\s*([\s\S]*)$/);
  if (match) {
    return { category: match[1], comment: match[2] };
  }
  return { category: null, comment: raw };
}
