export const DEFAULT_PLATFORM_RULES = {
  twitter: { char_limit: 280, hashtag_limit: 3, media_required: true, thread_max: 5 },
  instagram_feed: { char_limit: 2200, hashtag_limit: 30, hashtag_placement: "first_comment", media_required: true },
  instagram_story: { char_limit: 2200, media_required: true, max_duration_seconds: 60 },
  linkedin: { char_limit: 3000, hashtag_limit: 5, professional_tone: true },
  tiktok: { char_limit: 2200, hashtag_limit: 10, max_duration_seconds: 180 },
};

export const STARTER_TEMPLATES = [
  {
    name: "Social All-Rounder",
    description: "General purpose",
    imagenPromptAddition: "professional social media post, clean modern design",
    imagenNegativeAddition: "blurry, low quality, watermark",
    claudeCaptionInstruction: { tone: "match brand voice", include_cta: true },
    recommendedAssetTypes: ["image"],
    targetAspectRatios: ["1:1", "16:9", "9:16"],
  },
  {
    name: "Launch Announcement",
    description: "For launches",
    imagenPromptAddition: "exciting announcement, bold typography, vibrant",
    imagenNegativeAddition: "blurry, cluttered, low quality",
    claudeCaptionInstruction: { tone: "exciting, launch energy", include_cta: true, urgency: "moderate" },
    recommendedAssetTypes: ["image", "video"],
    targetAspectRatios: ["1:1", "16:9"],
  },
  {
    name: "Behind the Scenes",
    description: "Casual content",
    imagenPromptAddition: "candid, authentic, behind the scenes feel",
    imagenNegativeAddition: "staged, artificial, stock photo",
    claudeCaptionInstruction: { tone: "casual, authentic", include_cta: false },
    recommendedAssetTypes: ["image", "video"],
    targetAspectRatios: ["1:1", "9:16"],
  },
];

export interface WizardStepConfig {
  id: string;
  label: string;
  description: string;
  skipMessage: string | null;
  required: boolean;
  readinessKey: string | null;
}

export const WIZARD_STEPS: WizardStepConfig[] = [
  {
    id: "create-brand",
    label: "Create Brand",
    description: "Name your brand and pick a primary color",
    skipMessage: null,
    required: true,
    readinessKey: null,
  },
  {
    id: "upload-logo",
    label: "Upload Logo",
    description: "Add your brand logo for content overlays",
    skipMessage: "Generated content won't include your logo overlay",
    required: false,
    readinessKey: "logo",
  },
  {
    id: "upload-font",
    label: "Upload Font",
    description: "Add your brand font for headlines",
    skipMessage: "Text in generated images will use system defaults",
    required: false,
    readinessKey: "fonts",
  },
  {
    id: "configure-voice",
    label: "Brand Voice",
    description: "Define how your brand sounds in captions",
    skipMessage: "AI-generated captions won't match your brand voice",
    required: false,
    readinessKey: "voice",
  },
  {
    id: "platform-rules",
    label: "Platform Rules",
    description: "Set character limits and hashtag rules per platform",
    skipMessage: "Default character limits will be applied",
    required: false,
    readinessKey: "platformRules",
  },
  {
    id: "create-template",
    label: "First Template",
    description: "Choose a starter template for content generation",
    skipMessage: "You'll need a template before generating content",
    required: false,
    readinessKey: "templates",
  },
  {
    id: "upload-asset",
    label: "Upload Assets",
    description: "Add visual assets for your first campaign",
    skipMessage: "No approved visuals available for generation",
    required: false,
    readinessKey: "approvedAssets",
  },
  {
    id: "readiness-check",
    label: "Ready!",
    description: "Review your setup and start creating",
    skipMessage: null,
    required: true,
    readinessKey: null,
  },
];
