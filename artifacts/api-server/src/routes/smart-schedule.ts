import { Router, type IRouter } from "express";
import { eq, and, gte, lte, ne } from "drizzle-orm";
import {
  db,
  calendarEntriesTable,
  creativesTable,
  creativeVariantsTable,
  brandsTable,
  smartScheduleProposalsTable,
} from "@workspace/db";
import { z } from "zod";
import { validateRequest } from "../middleware/validate.js";

const router: IRouter = Router();

const PLATFORM_PEAK_HOURS: Record<string, number[]> = {
  instagram_feed: [9, 11, 12, 17, 18, 19, 20],
  instagram_story: [8, 9, 12, 17, 18, 19, 20, 21],
  twitter: [8, 9, 12, 13, 17, 18],
  linkedin: [7, 8, 9, 10, 12, 17],
  tiktok: [10, 11, 12, 19, 20, 21, 22],
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram_feed: "Instagram Feed",
  instagram_story: "Instagram Story",
  twitter: "X/Twitter",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface CandidateSlot {
  date: Date;
  hour: number;
  score: number;
  rationale: string;
}

function buildCandidateSlots(
  platform: string,
  startDate: Date,
  days: number,
): CandidateSlot[] {
  const peaks = PLATFORM_PEAK_HOURS[platform] || [9, 12, 17];
  const candidates: CandidateSlot[] = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dayOfWeek = date.getDay();
    const dayLabel = DAY_LABELS[dayOfWeek];
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    for (const hour of peaks) {
      let score = 0.5;
      const reasons: string[] = [];

      if (peaks.includes(hour)) {
        score += 0.3;
        reasons.push(`${hour > 12 ? hour - 12 : hour}${hour >= 12 ? "PM" : "AM"} is a peak engagement hour for ${PLATFORM_LABELS[platform] || platform}`);
      }

      if (isWeekend && ["instagram_feed", "instagram_story", "tiktok"].includes(platform)) {
        score += 0.1;
        reasons.push(`Weekend posting tends to perform well on ${PLATFORM_LABELS[platform] || platform}`);
      } else if (!isWeekend && ["linkedin", "twitter"].includes(platform)) {
        score += 0.1;
        reasons.push(`Weekday posting is optimal for ${PLATFORM_LABELS[platform] || platform}`);
      }

      if (d < 2) {
        score += 0.05;
        reasons.push("Sooner posting captures momentum");
      }

      score = Math.min(1, score);

      const slotDate = new Date(date);
      slotDate.setHours(hour, 0, 0, 0);

      candidates.push({
        date: slotDate,
        hour,
        score: Math.round(score * 100) / 100,
        rationale: `${dayLabel}: ${reasons.join(". ")}.`,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

interface SelectedSlot {
  platform: string;
  slot: CandidateSlot;
}

function applyStaggering(
  selections: SelectedSlot[],
  platform: string,
  candidates: CandidateSlot[],
): CandidateSlot | null {
  for (const candidate of candidates) {
    let valid = true;

    for (const existing of selections) {
      const timeDiffMs = Math.abs(candidate.date.getTime() - existing.slot.date.getTime());
      const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

      if (existing.platform === platform) {
        if (timeDiffHours < 2) {
          valid = false;
          break;
        }
      } else {
        if (timeDiffHours < 1) {
          valid = false;
          break;
        }
      }
    }

    if (valid) return candidate;
  }

  return candidates[0] || null;
}

function checkConflicts(
  proposedTime: Date,
  existingEntries: { scheduledAt: Date; platform: string }[],
  platform: string,
): { hasConflict: boolean; message: string } {
  for (const entry of existingEntries) {
    const timeDiffMs = Math.abs(proposedTime.getTime() - entry.scheduledAt.getTime());
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);

    if (entry.platform === platform && timeDiffHours < 2) {
      return {
        hasConflict: true,
        message: `Conflict: Another ${PLATFORM_LABELS[platform] || platform} post is scheduled within 2 hours`,
      };
    }

    if (timeDiffHours < 1) {
      return {
        hasConflict: true,
        message: `Conflict: Another post on ${PLATFORM_LABELS[entry.platform] || entry.platform} is scheduled within 1 hour`,
      };
    }
  }

  return { hasConflict: false, message: "" };
}

router.post(
  "/creatives/:creativeId/smart-schedule",
  validateRequest({ params: z.object({ creativeId: z.string().min(1) }) }),
  async (req, res): Promise<void> => {
    const { creativeId } = req.params;

    const creative = await db
      .select()
      .from(creativesTable)
      .where(eq(creativesTable.id, creativeId))
      .then((r) => r[0]);

    if (!creative) {
      res.status(404).json({ error: "Creative not found" });
      return;
    }

    const variants = await db
      .select()
      .from(creativeVariantsTable)
      .where(eq(creativeVariantsTable.creativeId, creativeId));

    if (variants.length === 0) {
      res.status(400).json({ error: "No variants found for this creative" });
      return;
    }

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);

    const existingEntries = await db
      .select({
        scheduledAt: calendarEntriesTable.scheduledAt,
        platform: calendarEntriesTable.platform,
      })
      .from(calendarEntriesTable)
      .where(
        and(
          gte(calendarEntriesTable.scheduledAt, startDate),
          lte(calendarEntriesTable.scheduledAt, endDate),
          eq(calendarEntriesTable.publishStatus, "scheduled"),
        ),
      );

    const selections: SelectedSlot[] = [];
    const proposals: Array<{
      variantId: string;
      platform: string;
      proposedAt: Date;
      score: number;
      rationale: string;
      hasConflict: boolean;
      conflictMessage: string;
    }> = [];

    for (const variant of variants) {
      const candidates = buildCandidateSlots(variant.platform, startDate, 7);
      const selected = applyStaggering(selections, variant.platform, candidates);

      if (!selected) continue;

      selections.push({ platform: variant.platform, slot: selected });

      const conflict = checkConflicts(selected.date, existingEntries, variant.platform);

      proposals.push({
        variantId: variant.id,
        platform: variant.platform,
        proposedAt: selected.date,
        score: selected.score,
        rationale: selected.rationale,
        hasConflict: conflict.hasConflict,
        conflictMessage: conflict.message,
      });
    }

    await db
      .delete(smartScheduleProposalsTable)
      .where(
        and(
          eq(smartScheduleProposalsTable.creativeId, creativeId),
          eq(smartScheduleProposalsTable.status, "pending"),
        ),
      );

    const savedProposals = [];
    for (const p of proposals) {
      const [saved] = await db
        .insert(smartScheduleProposalsTable)
        .values({
          creativeId,
          variantId: p.variantId,
          platform: p.platform,
          proposedAt: p.proposedAt,
          score: p.score,
          rationale: p.rationale,
          status: "pending",
        })
        .returning();

      savedProposals.push({
        ...saved,
        hasConflict: p.hasConflict,
        conflictMessage: p.conflictMessage,
      });
    }

    res.json({ proposals: savedProposals });
  },
);

const ConfirmBody = z.object({
  proposalIds: z.array(z.string().min(1)).min(1),
  timeOverrides: z
    .record(z.string(), z.string().refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid datetime string",
    }))
    .optional()
    .default({}),
});

router.post(
  "/smart-schedule/confirm",
  validateRequest({ body: ConfirmBody }),
  async (req, res): Promise<void> => {
    const { proposalIds, timeOverrides } = req.body;

    const createdEntries = [];

    for (const proposalId of proposalIds) {
      const proposal = await db
        .select()
        .from(smartScheduleProposalsTable)
        .where(eq(smartScheduleProposalsTable.id, proposalId))
        .then((r) => r[0]);

      if (!proposal || proposal.status !== "pending") continue;

      const overriddenTime = timeOverrides[proposalId];
      const scheduledAt = overriddenTime
        ? new Date(overriddenTime)
        : proposal.proposedAt;

      const isModified = !!overriddenTime;
      const method = isModified ? "smart_schedule_modified" : "smart_schedule";

      const [entry] = await db
        .insert(calendarEntriesTable)
        .values({
          creativeId: proposal.creativeId,
          variantId: proposal.variantId,
          platform: proposal.platform,
          scheduledAt,
          scheduleMethod: method,
          smartScheduleRationale: proposal.rationale,
          proposalId: proposal.id,
        })
        .returning();

      await db
        .update(smartScheduleProposalsTable)
        .set({
          status: "confirmed",
          confirmedAt: new Date(),
          calendarEntryId: entry.id,
        })
        .where(eq(smartScheduleProposalsTable.id, proposalId));

      createdEntries.push(entry);
    }

    if (createdEntries.length > 0) {
      const creativeId = createdEntries[0].creativeId;
      await db
        .update(creativesTable)
        .set({ status: "scheduled", updatedAt: new Date() })
        .where(eq(creativesTable.id, creativeId));
    }

    res.json({ entries: createdEntries, count: createdEntries.length });
  },
);

router.get(
  "/smart-schedule/proposals/:creativeId",
  validateRequest({ params: z.object({ creativeId: z.string().min(1) }) }),
  async (req, res): Promise<void> => {
    const { creativeId } = req.params;

    const proposals = await db
      .select()
      .from(smartScheduleProposalsTable)
      .where(eq(smartScheduleProposalsTable.creativeId, creativeId))
      .orderBy(smartScheduleProposalsTable.proposedAt);

    res.json({ proposals });
  },
);

export default router;
