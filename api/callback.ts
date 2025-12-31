// OAuth callback handler for Withings
// Deploy this to Vercel and set WITHINGS_REDIRECT_URI to your Vercel URL + /api/callback

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      `<html><body><h1>Authorization Failed</h1><p>Error: ${error}</p></body></html>`,
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
  const clientId = process.env.WITHINGS_CLIENT_ID;
  const clientSecret = process.env.WITHINGS_CLIENT_SECRET;
  const redirectUri = process.env.WITHINGS_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return new Response(
      `<html><body><h1>Configuration Error</h1><p>Missing environment variables.</p></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const params = new URLSearchParams({
    action: "requesttoken",
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch("https://wbsapi.withings.net/v2/oauth2", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await response.json();

  if (data.status !== 0) {
    return new Response(
      `<html><body><h1>Token Exchange Failed</h1><pre>${JSON.stringify(data, null, 2)}</pre></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  const tokens = data.body;

  // Display tokens for the user to copy
  return new Response(
    `<html>
<head><title>Withings Authorization Complete</title>
<style>
  body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
  pre { background: #f5f5f5; padding: 15px; overflow-x: auto; border-radius: 4px; }
  code { font-size: 12px; }
  h1 { color: #333; }
  .note { color: #666; font-size: 14px; }
</style>
</head>
<body>
  <h1>✓ Authorization Complete</h1>
  <p class="note">Add these to your environment variables or Claude config:</p>
  <pre><code>WITHINGS_ACCESS_TOKEN=${tokens.access_token}
WITHINGS_REFRESH_TOKEN=${tokens.refresh_token}</code></pre>
  <p class="note">Access token expires in ${Math.round(tokens.expires_in / 3600)} hours. Use refresh_token tool to renew.</p>
</body>
</html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}

export const config = {
  runtime: "edge",
};
