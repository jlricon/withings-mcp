// OAuth callback handler for WHOOP
// Deploy this to Vercel and set WHOOP_REDIRECT_URI to your Vercel URL + /api/callback-whoop

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Debug: Log all environment variables (redacted) and request info
  const debug = {
    requestUrl: req.url,
    hasCode: !!code,
    hasState: !!state,
    error,
    errorDescription,
    envVars: {
      WHOOP_CLIENT_ID: process.env.WHOOP_CLIENT_ID ? `${process.env.WHOOP_CLIENT_ID.slice(0, 8)}...` : "NOT SET",
      WHOOP_CLIENT_SECRET: process.env.WHOOP_CLIENT_SECRET ? `${process.env.WHOOP_CLIENT_SECRET.slice(0, 8)}...` : "NOT SET",
      WHOOP_REDIRECT_URI: process.env.WHOOP_REDIRECT_URI || "NOT SET",
    },
  };
  console.log("WHOOP Callback Debug:", JSON.stringify(debug, null, 2));

  if (error) {
    return new Response(
      `<html><body><h1>Authorization Failed</h1><p>Error: ${error}</p><p>${errorDescription || ""}</p></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code) {
    return new Response(
      `<html><body><h1>Missing Code</h1><p>No authorization code received.</p></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // Exchange code for tokens
  const clientId = process.env.WHOOP_CLIENT_ID?.trim();
  const clientSecret = process.env.WHOOP_CLIENT_SECRET?.trim();
  const redirectUri = process.env.WHOOP_REDIRECT_URI?.trim();

  if (!clientId || !clientSecret || !redirectUri) {
    return new Response(
      `<html><body><h1>Configuration Error</h1><p>Missing WHOOP environment variables.</p></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(
      `<html><body><h1>Token Exchange Failed</h1><pre>${errorText}</pre></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const tokens = await response.json();

  // Display tokens for the user to copy
  return new Response(
    `<html>
<head><title>WHOOP Authorization Complete</title>
<style>
  body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
  pre { background: #f5f5f5; padding: 15px; overflow-x: auto; border-radius: 4px; }
  code { font-size: 12px; }
  h1 { color: #333; }
  .note { color: #666; font-size: 14px; }
</style>
</head>
<body>
  <h1>✓ WHOOP Authorization Complete</h1>
  <p class="note">Add these to your environment variables or Claude config:</p>
  <pre><code>WHOOP_ACCESS_TOKEN=${tokens.access_token}
WHOOP_REFRESH_TOKEN=${tokens.refresh_token}</code></pre>
  <p class="note">Access token expires in ${Math.round(tokens.expires_in / 3600)} hours. Use whoop_refresh_token tool to renew.</p>
</body>
</html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export const config = {
  runtime: "edge",
};
