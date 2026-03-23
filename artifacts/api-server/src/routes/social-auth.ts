import { Router } from "express";
import crypto from "crypto";
import { db, socialAccountsTable } from "@workspace/db";
import { encryptToken } from "../services/token-encryption";
import { logger } from "../lib/logger";
import type {
  TwitterTokenResponse,
  TwitterUserResponse,
  FacebookTokenResponse,
  FacebookPagesResponse,
  FacebookPageIGResponse,
  InstagramUserResponse,
  LinkedInTokenResponse,
  LinkedInProfileResponse,
} from "../types/oauth";

const router = Router();

function resolveBaseUrl(): string {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, "");
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    return `https://${devDomain}`;
  }
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const firstDomain = domains.split(",")[0].trim();
    if (firstDomain) {
      return `https://${firstDomain}`;
    }
  }
  return "http://localhost:3000";
}

function getCallbackBaseUrl(): string {
  return resolveBaseUrl();
}

function getSettingsRedirectUrl(): string {
  return `${resolveBaseUrl()}/settings?tab=accounts`;
}

const pkceStore = new Map<string, { verifier: string; expiresAt: number }>();
const oauthStateStore = new Map<string, { expiresAt: number }>();

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function createOAuthState(): string {
  const state = crypto.randomBytes(16).toString("hex");
  oauthStateStore.set(state, { expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

function validateOAuthState(state: string | undefined): boolean {
  if (!state || typeof state !== "string") return false;
  const data = oauthStateStore.get(state);
  if (!data || data.expiresAt < Date.now()) {
    oauthStateStore.delete(state as string);
    return false;
  }
  oauthStateStore.delete(state);
  return true;
}

router.get("/auth/twitter", (_req, res) => {
  const clientId = process.env.X_SparqForge_X_API_Key;
  if (!clientId) {
    return res.status(500).json({ error: "Twitter API key not configured" });
  }

  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString("hex");

  pkceStore.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });

  const callbackUrl = `${getCallbackBaseUrl()}/api/auth/twitter/callback`;
  const scopes = ["tweet.read", "tweet.write", "users.read", "offline.access"].join(" ");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  res.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
});

router.get("/auth/twitter/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || typeof code !== "string" || typeof state !== "string") {
      return res.redirect(`${getSettingsRedirectUrl()}&error=missing_params`);
    }

    const pkceData = pkceStore.get(state);
    if (!pkceData || pkceData.expiresAt < Date.now()) {
      pkceStore.delete(state as string);
      return res.redirect(`${getSettingsRedirectUrl()}&error=invalid_state`);
    }
    pkceStore.delete(state);

    const clientId = process.env.X_SparqForge_X_API_Key;
    const callbackUrl = `${getCallbackBaseUrl()}/api/auth/twitter/callback`;

    const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl,
        client_id: clientId!,
        code_verifier: pkceData.verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      logger.error({ status: tokenResponse.status, body: errBody }, "Twitter token exchange failed");
      return res.redirect(`${getSettingsRedirectUrl()}&error=token_exchange_failed`);
    }

    const tokenData: TwitterTokenResponse = await tokenResponse.json();

    const userResponse = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userResponse.ok) {
      return res.redirect(`${getSettingsRedirectUrl()}&error=user_fetch_failed`);
    }

    const userData: TwitterUserResponse = await userResponse.json();

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    await db.insert(socialAccountsTable).values({
      platform: "twitter",
      accountName: `@${userData.data.username}`,
      accountId: userData.data.id,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
      tokenExpiry: expiresAt,
      status: "connected",
    });

    res.redirect(`${getSettingsRedirectUrl()}&success=twitter`);
  } catch (err) {
    logger.error(err, "Twitter callback error");
    res.redirect(`${getSettingsRedirectUrl()}&error=callback_error`);
  }
});

router.get("/auth/instagram", (_req, res) => {
  const appId = process.env.SparqForge_Instagram_App_ID;
  if (!appId) {
    return res.status(500).json({ error: "Instagram App ID not configured" });
  }

  const state = createOAuthState();
  const callbackUrl = `${getCallbackBaseUrl()}/api/auth/instagram/callback`;
  const scopes = ["instagram_basic", "instagram_content_publish", "pages_show_list"].join(",");

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: callbackUrl,
    scope: scopes,
    response_type: "code",
    state,
  });

  res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`);
});

router.get("/auth/instagram/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!validateOAuthState(state as string | undefined)) {
      return res.redirect(`${getSettingsRedirectUrl()}&error=invalid_state`);
    }

    if (!code || typeof code !== "string") {
      return res.redirect(`${getSettingsRedirectUrl()}&error=missing_code`);
    }

    const appId = process.env.SparqForge_Instagram_App_ID;
    const appSecret = process.env.SparqForge_Instagram_App_Secret;
    const callbackUrl = `${getCallbackBaseUrl()}/api/auth/instagram/callback`;

    const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId!);
    tokenUrl.searchParams.set("redirect_uri", callbackUrl);
    tokenUrl.searchParams.set("client_secret", appSecret!);
    tokenUrl.searchParams.set("code", code);

    const tokenResp = await fetch(tokenUrl.toString());

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      logger.error({ status: tokenResp.status, body: errBody }, "Instagram token exchange failed");
      return res.redirect(`${getSettingsRedirectUrl()}&error=token_exchange_failed`);
    }

    const tokenData: FacebookTokenResponse = await tokenResp.json();

    // Facebook's token exchange API requires fb_exchange_token as a GET query parameter.
    // This is a Facebook API requirement and cannot be sent as a POST body.
    // We intentionally avoid logging the URL to prevent exposing the short-lived token.
    const longLivedUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
    longLivedUrl.searchParams.set("client_id", appId!);
    longLivedUrl.searchParams.set("client_secret", appSecret!);
    longLivedUrl.searchParams.set("fb_exchange_token", tokenData.access_token);

    const longLivedResp = await fetch(longLivedUrl.toString());
    const longLivedData: FacebookTokenResponse = await longLivedResp.json();
    const accessToken = longLivedData.access_token || tokenData.access_token;
    const expiresIn = longLivedData.expires_in || 5184000;

    const pagesResp = await fetch(
      "https://graph.facebook.com/v19.0/me/accounts",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const pagesData: FacebookPagesResponse = await pagesResp.json();

    let igAccountName = "Instagram Business";
    let igAccountId = "";

    if (pagesData.data && pagesData.data.length > 0) {
      const page = pagesData.data[0];
      const igResp = await fetch(
        `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const igData: FacebookPageIGResponse = await igResp.json();

      if (igData.instagram_business_account) {
        igAccountId = igData.instagram_business_account.id;
        const igUserResp = await fetch(
          `https://graph.facebook.com/v19.0/${igAccountId}?fields=username`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const igUserData: InstagramUserResponse = await igUserResp.json();
        igAccountName = `@${igUserData.username || "instagram_user"}`;
      }
    }

    if (!igAccountId) {
      logger.error("Could not resolve Instagram Business Account from connected Facebook pages");
      return res.redirect(`${getSettingsRedirectUrl()}&error=no_ig_business_account`);
    }

    await db.insert(socialAccountsTable).values({
      platform: "instagram",
      accountName: igAccountName,
      accountId: igAccountId,
      accessToken: encryptToken(accessToken),
      refreshToken: null,
      tokenExpiry: new Date(Date.now() + expiresIn * 1000),
      status: "connected",
    });

    res.redirect(`${getSettingsRedirectUrl()}&success=instagram`);
  } catch (err) {
    logger.error(err, "Instagram callback error");
    res.redirect(`${getSettingsRedirectUrl()}&error=callback_error`);
  }
});

router.get("/auth/linkedin", (_req, res) => {
  const clientId = process.env.SparqForge_LinkedIn_Client_ID;
  if (!clientId) {
    return res.status(500).json({ error: "LinkedIn Client ID not configured" });
  }

  const state = createOAuthState();
  const callbackUrl = `${getCallbackBaseUrl()}/api/auth/linkedin/callback`;
  const scopes = ["openid", "profile", "w_member_social", "offline_access"].join(" ");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: scopes,
    state,
  });

  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
});

router.get("/auth/linkedin/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!validateOAuthState(state as string | undefined)) {
      return res.redirect(`${getSettingsRedirectUrl()}&error=invalid_state`);
    }

    if (!code || typeof code !== "string") {
      return res.redirect(`${getSettingsRedirectUrl()}&error=missing_code`);
    }

    const clientId = process.env.SparqForge_LinkedIn_Client_ID;
    const clientSecret = process.env.SparqForge_LinkedIn_Client_Secret;
    const callbackUrl = `${getCallbackBaseUrl()}/api/auth/linkedin/callback`;

    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl,
        client_id: clientId!,
        client_secret: clientSecret!,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      logger.error({ status: tokenResponse.status, body: errBody }, "LinkedIn token exchange failed");
      return res.redirect(`${getSettingsRedirectUrl()}&error=token_exchange_failed`);
    }

    const tokenData: LinkedInTokenResponse = await tokenResponse.json();

    const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    let accountName = "LinkedIn User";
    let accountId = "";

    if (profileResponse.ok) {
      const profileData: LinkedInProfileResponse = await profileResponse.json();
      accountName = profileData.name || `${profileData.given_name || ""} ${profileData.family_name || ""}`.trim() || "LinkedIn User";
      accountId = profileData.sub || "";
    }

    if (!accountId) {
      logger.error("Could not resolve LinkedIn user identity from profile response");
      return res.redirect(`${getSettingsRedirectUrl()}&error=profile_fetch_failed`);
    }

    const fullAccountId = `urn:li:person:${accountId}`;

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    await db.insert(socialAccountsTable).values({
      platform: "linkedin",
      accountName,
      accountId: fullAccountId,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : null,
      tokenExpiry: expiresAt,
      status: "connected",
    });

    res.redirect(`${getSettingsRedirectUrl()}&success=linkedin`);
  } catch (err) {
    logger.error(err, "LinkedIn callback error");
    res.redirect(`${getSettingsRedirectUrl()}&error=callback_error`);
  }
});

export default router;
