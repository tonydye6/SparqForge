---
name: Social OAuth provider quirks
description: Meta/X/TikTok/LinkedIn dashboard + credential traps hit while wiring social account connections
---

## Meta (Instagram via Facebook Login for Business)
- Newer Meta "business" apps reject the classic scope list (`instagram_basic,instagram_content_publish,pages_show_list`) with **"Invalid Scopes"**. They require a `config_id` (Facebook Login for Business → Configurations) instead of `scope` in the dialog URL.
- **How to apply:** server prefers `SparqMake_Instagram_Config_ID` env var (resolver `getInstagramConfigId()`); falls back to scope list only when unset.
- Configuration permission dropdown is EMPTY until the permissions are first added under **Use cases → Customize**.
- Meta "App Domains" wants bare hostnames (no scheme/slash); Valid OAuth Redirect URIs want full https URLs, ONE PER ENTRY (pasting two into one field silently creates a single invalid chip → "URL Blocked").

## X (Twitter)
- OAuth2 PKCE authorize rejects the OAuth 1.0a **API Key** instantly ("Something went wrong"). It needs the **OAuth 2.0 Client ID** from User authentication settings. The legacy `X_SparqMake_X_API_Key` secret holds an API Key and is intentionally NOT an alias for clientId (canonical: `SparqMake_X_OAuth2_Client_ID` env var).
- App type "Native App" (public client) matches our secretless PKCE token exchange.
- X access tokens live ~2h; the hourly token-refresh sweep renews within 24h of expiry. Because of that, "expiring soon" UI is computed as: only warn when the account has no auto-refresh path or lastRefreshError is set.

## TikTok
- Production client key won't work until app review passes; **sandbox has its own client key/secret** (keys start with `sb`) and its own Login Kit/redirect/scope config plus explicit target users. Swap secrets to sandbox values for testing, back to production after approval.
- URL-property verification for replit.app domains: use "URL prefix" with a signature txt file served from the frontend `public/` dir (DNS option impossible); prod must be republished before clicking Verify.
- Unused products (e.g. Share Kit) on the app delay/fail review — remove before submitting.

## LinkedIn
- `offline_access` is partner-only: authorize fails with `invalid_scope_error: Unknown scope "offline_access"`. Request only `openid profile w_member_social`; tokens last ~60 days with no refresh, user reconnects.
- Standard products only allow posting as the **person**. Posting as a company page needs the **Community Management API**, which must be the ONLY product on the app → requires a second dedicated LinkedIn app, page association + admin verification, and manual review.
- LinkedIn's "Bummer" error page doesn't say why; callback must log `error`/`error_description` query params to see the real reason.

## General
- OAuth dialogs (Facebook, X) refuse to render inside the Replit preview iframe — Connect buttons must `window.open` a top-level tab; accounts list refetches on window focus.
- Both dev (picard.replit.dev) and prod (sparqmake.replit.app) callback URLs must be registered per provider.

**Why:** each of these failed with an opaque provider-side error before the cause was found; repeating them costs long user back-and-forth in external dashboards.
