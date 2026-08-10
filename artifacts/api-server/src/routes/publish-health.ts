import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  calendarEntriesTable,
  creativesTable,
  socialAccountsTable,
  publishAlertsTable,
} from "@workspace/db";
import { MAX_RETRIES } from "../services/publish-constants";
import { isEmailConfigured } from "../services/email";
import { groupFailures } from "../services/publish-failures";

const router: IRouter = Router();

/**
 * Publish health summary.
 *
 * Phase 10 item 4 changed the shape of this response. It used to return the
 * vendor's raw error string and leave the client to render it beside a Retry
 * button, which meant offering a retry that could not possibly work on roughly
 * half of the failures this build produces. It now returns a typed failure per
 * entry and a GROUPED view, where each group is one problem with exactly one
 * action. See services/publish-failures.ts for the classification and why each
 * kind gets the action it does.
 *
 * `failures` is kept alongside `groups` because the alert digest and the older
 * surfaces read it, and changing them was not this item's job.
 *
 * Read-only. Retrying is a separate, write-gated action
 * (POST /calendar-entries/:id/retry).
 */
router.get("/publish-health", async (_req, res): Promise<void> => {
  const failures = await db
    .select({
      id: calendarEntriesTable.id,
      creativeId: calendarEntriesTable.creativeId,
      platform: calendarEntriesTable.platform,
      scheduledAt: calendarEntriesTable.scheduledAt,
      publishError: calendarEntriesTable.publishError,
      retryCount: calendarEntriesTable.retryCount,
      socialAccountId: calendarEntriesTable.socialAccountId,
      alertedAt: calendarEntriesTable.alertedAt,
      updatedAt: calendarEntriesTable.updatedAt,
      creativeName: creativesTable.name,
      // The brand, so a "connect an account" action can land on the right one
      // rather than on a Settings page that asks which brand you meant.
      brandId: creativesTable.brandId,
      accountName: socialAccountsTable.accountName,
    })
    .from(calendarEntriesTable)
    .innerJoin(creativesTable, eq(calendarEntriesTable.creativeId, creativesTable.id))
    .leftJoin(socialAccountsTable, eq(calendarEntriesTable.socialAccountId, socialAccountsTable.id))
    .where(eq(calendarEntriesTable.publishStatus, "failed"))
    .orderBy(desc(calendarEntriesTable.updatedAt))
    .limit(50);

  const shaped = failures.map((f) => ({
    ...f,
    permanent: (f.retryCount ?? 0) >= MAX_RETRIES || !f.socialAccountId,
  }));

  const alerts = await db
    .select({
      id: publishAlertsTable.id,
      socialAccountId: publishAlertsTable.socialAccountId,
      entryCount: publishAlertsTable.entryCount,
      channel: publishAlertsTable.channel,
      recipientCount: publishAlertsTable.recipientCount,
      status: publishAlertsTable.status,
      summary: publishAlertsTable.summary,
      sentAt: publishAlertsTable.sentAt,
      accountName: socialAccountsTable.accountName,
    })
    .from(publishAlertsTable)
    .leftJoin(socialAccountsTable, eq(publishAlertsTable.socialAccountId, socialAccountsTable.id))
    .orderBy(desc(publishAlertsTable.sentAt))
    .limit(10);

  res.json({
    failedCount: shaped.length,
    permanentCount: shaped.filter((f) => f.permanent).length,
    /**
     * One entry per PROBLEM, ordered so whatever needs a person is first.
     * Six posts stuck behind one disconnected account is one row here, which
     * is the whole point: the surface leads with the fix, not with the count.
     */
    groups: groupFailures(shaped),
    failures: shaped,
    alerts,
    emailConfigured: isEmailConfigured(),
  });
});

export default router;
