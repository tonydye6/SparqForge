import { anthropic } from "@workspace/integrations-anthropic-ai";
import { eq } from "drizzle-orm";
import { db, refinementLogsTable, templateRecommendationsTable, type Template } from "@workspace/db";

interface RefinementRecommendation {
  field: string;
  currentValue: unknown;
  recommendedValue: unknown;
  reasoning: string;
  evidenceCount: number;
}

interface AnalysisPackage {
  templateName: string;
  totalGenerations: number;
  version: number;
  currentConfig: {
    imagenPromptAddition: string;
    imagenNegativeAddition: string;
    claudeCaptionInstruction: unknown;
    claudeHeadlineInstruction: string | null;
  };
  refinementStats: {
    totalLogs: number;
    approvals: number;
    rejections: number;
    approvalRate: number | null;
    captionEdits: number;
    headlineEdits: number;
    imageRefinements: number;
  };
  topRefinementPrompts: Array<{ prompt: string; count: number }>;
  captionEditPatterns: Array<{ original: string; edited: string }>;
  rejectionReasons: string[];
}

export async function analyzeTemplate(templateId: string, template: Template) {
  const logs = await db.select().from(refinementLogsTable)
    .where(eq(refinementLogsTable.templateId, templateId));

  if (logs.length < 3) {
    throw new Error("Insufficient refinement data. Need at least 3 logged interactions before analysis is meaningful.");
  }

  const approvals = logs.filter(l => l.editType === "approval").length;
  const rejections = logs.filter(l => l.editType === "rejection").length;
  const captionEdits = logs.filter(l => l.editType === "caption_edit").length;
  const headlineEdits = logs.filter(l => l.editType === "headline_edit").length;
  const imageRefinements = logs.filter(l => l.editType === "image_refinement").length;

  const totalDecisions = approvals + rejections;
  const approvalRate = totalDecisions > 0 ? approvals / totalDecisions : null;

  const refinementPrompts = logs
    .filter(l => l.editType === "image_refinement" && l.refinementPrompt)
    .map(l => l.refinementPrompt!);

  const promptFrequency: Record<string, number> = {};
  for (const p of refinementPrompts) {
    const normalized = p.toLowerCase().trim();
    promptFrequency[normalized] = (promptFrequency[normalized] || 0) + 1;
  }
  const topRefinementPrompts = Object.entries(promptFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([prompt, count]) => ({ prompt, count }));

  const captionEditPatterns = logs
    .filter(l => l.editType === "caption_edit" && l.originalValue && l.newValue)
    .slice(0, 20)
    .map(l => ({ original: l.originalValue!, edited: l.newValue! }));

  const rejectionReasons = logs
    .filter(l => l.editType === "rejection" && l.newValue)
    .map(l => l.newValue!);

  const analysisPackage: AnalysisPackage = {
    templateName: template.name,
    totalGenerations: template.totalGenerations,
    version: template.version,
    currentConfig: {
      imagenPromptAddition: template.imagenPromptAddition,
      imagenNegativeAddition: template.imagenNegativeAddition,
      claudeCaptionInstruction: template.claudeCaptionInstruction,
      claudeHeadlineInstruction: template.claudeHeadlineInstruction,
    },
    refinementStats: {
      totalLogs: logs.length,
      approvals,
      rejections,
      approvalRate,
      captionEdits,
      headlineEdits,
      imageRefinements,
    },
    topRefinementPrompts,
    captionEditPatterns,
    rejectionReasons,
  };

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `You are a template optimization analyst for SparqForge, an AI-powered social media content tool for Sparq Games. Your job is to analyze usage patterns and user feedback data for a specific campaign template, then produce structured recommendations to improve the template's AI generation configuration.

Your recommendations should be specific, actionable changes to template fields that would reduce the need for manual refinement and increase first-pass approval rates.

Respond ONLY with a valid JSON array of recommendation objects. Each object must have:
- "field": the template field to change (one of: "imagenPromptAddition", "imagenNegativeAddition", "claudeCaptionInstruction", "claudeHeadlineInstruction")
- "currentValue": the current value of that field
- "recommendedValue": your recommended new value
- "reasoning": a clear explanation of why this change would help, citing specific patterns from the data
- "evidenceCount": how many data points support this recommendation

If the data is insufficient for any recommendations, return an empty array [].`,
    messages: [
      {
        role: "user",
        content: `Analyze this template's refinement data and provide improvement recommendations.

TEMPLATE: "${analysisPackage.templateName}" (Version ${analysisPackage.version}, ${analysisPackage.totalGenerations} total generations)

CURRENT CONFIGURATION:
- Imagen Prompt Addition: "${analysisPackage.currentConfig.imagenPromptAddition}"
- Imagen Negative Addition: "${analysisPackage.currentConfig.imagenNegativeAddition}"
- Claude Caption Instruction: ${JSON.stringify(analysisPackage.currentConfig.claudeCaptionInstruction)}
- Claude Headline Instruction: "${analysisPackage.currentConfig.claudeHeadlineInstruction || ""}"

REFINEMENT STATISTICS:
- Total logged interactions: ${analysisPackage.refinementStats.totalLogs}
- Approvals: ${analysisPackage.refinementStats.approvals}
- Rejections: ${analysisPackage.refinementStats.rejections}
- Approval Rate: ${analysisPackage.refinementStats.approvalRate !== null ? (analysisPackage.refinementStats.approvalRate * 100).toFixed(1) + "%" : "N/A"}
- Caption Edits: ${analysisPackage.refinementStats.captionEdits}
- Headline Edits: ${analysisPackage.refinementStats.headlineEdits}
- Image Refinements: ${analysisPackage.refinementStats.imageRefinements}

TOP IMAGE REFINEMENT PROMPTS (what users typed to fix images):
${topRefinementPrompts.map(p => `- "${p.prompt}" (used ${p.count} times)`).join("\n") || "None yet"}

CAPTION EDIT PATTERNS (original AI output → human edit):
${captionEditPatterns.map(p => `- Original: "${p.original.substring(0, 200)}..." → Edited: "${p.edited.substring(0, 200)}..."`).join("\n") || "None yet"}

REJECTION REASONS:
${rejectionReasons.map(r => `- "${r}"`).join("\n") || "None yet"}

Based on this data, provide specific template configuration changes that would reduce the need for manual refinement.`,
      },
    ],
  });

  const textContent = response.content.find(c => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("No text response from Claude");
  }

  let recommendations: RefinementRecommendation[];
  try {
    const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      recommendations = [];
    } else {
      recommendations = JSON.parse(jsonMatch[0]);
    }
  } catch {
    recommendations = [];
  }

  const [saved] = await db.insert(templateRecommendationsTable).values({
    templateId,
    analysisData: analysisPackage,
    recommendations,
    status: "pending",
  }).returning();

  return saved;
}
