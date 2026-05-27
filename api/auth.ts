/**
 * Vercel Serverless Function — GitHub OAuth for StaticCMS
 *
 * Handles the OAuth2 Authorization Code flow for the GitHub backend.
 * StaticCMS opens this endpoint in a popup to authenticate users.
 *
 * Required environment variables (set in Vercel dashboard):
 *   - GITHUB_CLIENT_ID
 *   - GITHUB_CLIENT_SECRET
 *
 * Flow:
 *   1. CMS popup → GET /api/auth (no code) → redirect to GitHub authorize
 *   2. GitHub redirects back with ?code=... → exchange for access token
 *   3. Return HTML that posts the token back to the CMS parent window
 *      using the NetlifyAuthenticator string-based postMessage protocol.
 *
 * Protocol: postMessage("authorizing:github", "*") handshake,
 *           then postMessage("authorization:github:success:{json}", "*").
 *           StaticCMS v3 NetlifyAuthenticator uses indexOf to parse strings,
 *           so the payload MUST be a concatenated string, not an object.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const SCOPE = "repo,user";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only allow GET requests
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    res.status(500).json({
      error: "missing_env_vars",
      message:
        "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set in Vercel environment variables.",
    });
    return;
  }

  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host || "el-humboldtiano.vercel.app";
  const origin = `${protocol}://${host}`;

  const code = req.query.code as string | undefined;

  const code = req.query.code as string | undefined;

  // ── Step 1: No code → redirect to GitHub authorization page ────────────
  if (!code) {
    const redirectUri = `${origin}/api/auth`;
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: SCOPE,
    });

    res.redirect(302, `https://github.com/login/oauth/authorize?${params.toString()}`);
    return;
  }

  // ── Step 2: Code received → exchange for access token ──────────────────
  try {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
        }),
      },
    );

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      res.status(400).json({ error: tokenData.error });
      return;
    }

    // Return HTML that posts the token back via the NetlifyAuthenticator
    // STRING protocol. The key insight: NetlifyAuthenticator in StaticCMS
    // uses e.data.indexOf("authorization:github:success:") to parse the
    // message, so postMessage MUST receive a string, not an object.
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Autenticando…</title></head>
<body>
<script>
(function() {
  var token = ${JSON.stringify(tokenData.access_token)};
  // Post the token back to the StaticCMS parent window
  if (window.opener) {
    window.opener.postMessage(
      { type: "authorization", token: token },
      "*"
    );
  }
  window.close();
})();
</script>
<p>Autenticado. Cerrando ventana…</p>
</body>
</html>`;

    res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(html);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "token_exchange_failed", message });
  }
}
