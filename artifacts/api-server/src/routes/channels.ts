/**
 * The channels a brand can actually publish to.
 *
 * One endpoint so the Studio's stages stop each deciding this for themselves.
 * Stage 04 hardcoded four channels, stage 05 hardcoded a different four, and
 * stage 01 read the connected accounts: three surfaces, three answers, on the
 * same post. The brief's answer is the only one grounded in something real, so
 * it is now the only one.
 *
 * Its own file rather than a line in `brands.ts` because that route is bound to
 * the generated client and this is read by the Studio through `apiFetch`.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, brandsTable, socialAccountsTable } from "@workspace/db";
import { str } from "../lib/http-params.js";
import { resolveChannels, NO_CHANNELS_REASON } from "../services/channels.js";

const router: IRouter = Router();

router.get("/brands/:brandId/channels", async (req: Request, res: Response): Promise<void> => {
  const brandId = str(req.params.brandId);
  try {
    const [brand] = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .where(eq(brandsTable.id, brandId));
    if (!brand) {
      res.status(404).json({ error: "That brand no longer exists." });
      return;
    }

    /**
     * WORKSPACE-wide, not brand-scoped. Tony, 2026-08-10: every brand
     * currently publishes through the Sparq Games accounts, brand-owned
     * accounts arrive later, and the user chooses the account per post. The
     * first version scoped this to the brand, which quietly narrowed Crown U
     * to its single LinkedIn account. The brand id now only decides which
     * account is each channel's DEFAULT.
     */
    const accounts = await db
      .select({
        id: socialAccountsTable.id,
        platform: socialAccountsTable.platform,
        accountName: socialAccountsTable.accountName,
        brandId: socialAccountsTable.brandId,
      })
      .from(socialAccountsTable)
      .where(eq(socialAccountsTable.status, "connected"));

    const channels = resolveChannels(accounts, brandId);
    res.json({
      channels,
      // The sentence, not a boolean, so all three surfaces say the same thing
      // in the same words rather than each writing their own empty state.
      emptyReason: channels.length === 0 ? NO_CHANNELS_REASON : null,
    });
  } catch (err) {
    console.error("Failed to resolve a brand's channels", err);
    res.status(500).json({ error: "This brand's channels could not be read." });
  }
});

export default router;
