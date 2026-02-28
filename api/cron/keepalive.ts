import { Redis } from "@upstash/redis";
import { refreshAccessToken, type WithingsConfig } from "../../src/withings.js";
import { refreshWhoopAccessToken, type WhoopConfig } from "../../src/whoop.js";

const redis = new Redis({
  url: process.env.WITH_KV_REST_API_URL!,
  token: process.env.WITH_KV_REST_API_TOKEN!,
});

const WITHINGS_TOKEN_KEY = "withings_tokens";
const WHOOP_TOKEN_KEY = "whoop_tokens";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const GET = async (req: Request) => {
  // Verify this is called by Vercel Cron
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const results: string[] = [];

  // Refresh Withings tokens
  try {
    const stored = await redis.get<StoredTokens>(WITHINGS_TOKEN_KEY);
    if (stored?.refreshToken) {
      const config: WithingsConfig = {
        clientId: process.env.WITHINGS_CLIENT_ID!,
        clientSecret: process.env.WITHINGS_CLIENT_SECRET!,
        redirectUri: process.env.WITHINGS_REDIRECT_URI || "",
        refreshToken: stored.refreshToken,
      };
      const newTokens = await refreshAccessToken(config);
      await redis.set(WITHINGS_TOKEN_KEY, {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiresAt: Date.now() + newTokens.expires_in * 1000,
      });
      results.push("Withings: refreshed");
    } else {
      results.push("Withings: no tokens found");
    }
  } catch (e: any) {
    results.push(`Withings: error - ${e.message}`);
  }

  // Refresh WHOOP tokens
  try {
    const stored = await redis.get<StoredTokens>(WHOOP_TOKEN_KEY);
    if (stored?.refreshToken) {
      const config: WhoopConfig = {
        clientId: process.env.WHOOP_CLIENT_ID || "",
        clientSecret: process.env.WHOOP_CLIENT_SECRET || "",
        redirectUri: process.env.WHOOP_REDIRECT_URI || "",
        refreshToken: stored.refreshToken,
      };
      const newTokens = await refreshWhoopAccessToken(config);
      await redis.set(WHOOP_TOKEN_KEY, {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        expiresAt: Date.now() + newTokens.expires_in * 1000,
      });
      results.push("WHOOP: refreshed");
    } else {
      results.push("WHOOP: no tokens found");
    }
  } catch (e: any) {
    results.push(`WHOOP: error - ${e.message}`);
  }

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
