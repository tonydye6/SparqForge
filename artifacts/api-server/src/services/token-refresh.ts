import { db, socialAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptToken, encryptToken } from "./token-encryption";
import { logger } from "../lib/logger";

export async function refreshExpiringTokens(): Promise<void> {
  try {
    const accounts = await db.select().from(socialAccountsTable);

    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    for (const account of accounts) {
      if (account.status === "revoked") continue;
      if (!account.tokenExpiry) continue;

      const timeUntilExpiry = account.tokenExpiry.getTime() - now;
      if (timeUntilExpiry > twentyFourHours) continue;

      logger.info(
        { platform: account.platform, accountName: account.accountName, expiresIn: Math.round(timeUntilExpiry / 1000 / 60) + " minutes" },
        "Attempting to refresh expiring token"
      );

      try {
        if (account.platform === "twitter" && account.refreshToken) {
          await refreshTwitterToken(account);
        } else if (account.platform === "linkedin" && account.refreshToken) {
          await refreshLinkedInToken(account);
        } else if (account.platform === "instagram") {
          await refreshInstagramToken(account);
        } else {
          if (timeUntilExpiry <= 0) {
            await db
              .update(socialAccountsTable)
              .set({ status: "expired", updatedAt: new Date() })
              .where(eq(socialAccountsTable.id, account.id));
          }
        }
      } catch (err) {
        logger.error({ err, platform: account.platform, accountId: account.id }, "Failed to refresh token");
        if (timeUntilExpiry <= 0) {
          await db
            .update(socialAccountsTable)
            .set({ status: "expired", updatedAt: new Date() })
            .where(eq(socialAccountsTable.id, account.id));
        }
      }
    }
  } catch (err) {
    logger.error(err, "Token refresh check failed");
  }
}

async function refreshTwitterToken(account: any): Promise<void> {
  const refreshTokenDecrypted = decryptToken(account.refreshToken);
  const clientId = process.env.X_SparqForge_X_API_Key;

  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenDecrypted,
      client_id: clientId!,
    }),
  });

  if (!response.ok) {
    throw new Error(`Twitter refresh failed: ${response.status}`);
  }

  const data = await response.json() as any;
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;

  await db
    .update(socialAccountsTable)
    .set({
      accessToken: encryptToken(data.access_token),
      refreshToken: data.refresh_token ? encryptToken(data.refresh_token) : account.refreshToken,
      tokenExpiry: expiresAt,
      status: "connected",
      updatedAt: new Date(),
    })
    .where(eq(socialAccountsTable.id, account.id));

  logger.info({ platform: "twitter", accountName: account.accountName }, "Token refreshed successfully");
}

async function refreshLinkedInToken(account: any): Promise<void> {
  const refreshTokenDecrypted = decryptToken(account.refreshToken);
  const clientId = process.env.SparqForge_LinkedIn_Client_ID;
  const clientSecret = process.env.SparqForge_LinkedIn_Client_Secret;

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenDecrypted,
      client_id: clientId!,
      client_secret: clientSecret!,
    }),
  });

  if (!response.ok) {
    throw new Error(`LinkedIn refresh failed: ${response.status}`);
  }

  const data = await response.json() as any;
  const expiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  await db
    .update(socialAccountsTable)
    .set({
      accessToken: encryptToken(data.access_token),
      refreshToken: data.refresh_token ? encryptToken(data.refresh_token) : account.refreshToken,
      tokenExpiry: expiresAt,
      status: "connected",
      updatedAt: new Date(),
    })
    .where(eq(socialAccountsTable.id, account.id));

  logger.info({ platform: "linkedin", accountName: account.accountName }, "Token refreshed successfully");
}

async function refreshInstagramToken(account: any): Promise<void> {
  const accessTokenDecrypted = decryptToken(account.accessToken);
  const appId = process.env.SparqForge_Instagram_App_ID;
  const appSecret = process.env.SparqForge_Instagram_App_Secret;

  const refreshUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  refreshUrl.searchParams.set("grant_type", "fb_exchange_token");
  refreshUrl.searchParams.set("client_id", appId!);
  refreshUrl.searchParams.set("client_secret", appSecret!);
  refreshUrl.searchParams.set("fb_exchange_token", accessTokenDecrypted);

  const response = await fetch(refreshUrl.toString());

  if (!response.ok) {
    throw new Error(`Instagram refresh failed: ${response.status}`);
  }

  const data = await response.json() as any;
  const expiresIn = data.expires_in || 5184000;

  await db
    .update(socialAccountsTable)
    .set({
      accessToken: encryptToken(data.access_token),
      tokenExpiry: new Date(Date.now() + expiresIn * 1000),
      status: "connected",
      updatedAt: new Date(),
    })
    .where(eq(socialAccountsTable.id, account.id));

  logger.info({ platform: "instagram", accountName: account.accountName }, "Token refreshed successfully");
}
