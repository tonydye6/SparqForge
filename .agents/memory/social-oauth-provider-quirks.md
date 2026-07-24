---
name: Social OAuth provider quirks
description: Meta/X dashboard + credential traps hit while wiring Instagram and X account connections
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

## General
- OAuth dialogs (Facebook, X) refuse to render inside the Replit preview iframe — Connect buttons must `window.open` a top-level tab; accounts list refetches on window focus.
- Both dev (picard.replit.dev) and prod (sparqmake.replit.app) callback URLs must be registered per provider.

**Why:** each of these failed with an opaque provider-side error before the cause was found; repeating them costs long user back-and-forth in external dashboards.
