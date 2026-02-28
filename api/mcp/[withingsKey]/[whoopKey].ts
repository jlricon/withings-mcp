import { Redis } from "@upstash/redis";
import {
  getAuthorizationUrl,
  refreshAccessToken,
  getWeightMeasurements,
  type WithingsConfig,
  type TokenResponse,
} from "../../../src/withings.js";
import {
  getWhoopAuthorizationUrl,
  refreshWhoopAccessToken,
  getWhoopDailyStats,
  getWhoopWorkoutData,
  type WhoopConfig,
  type WhoopTokenResponse,
} from "../../../src/whoop.js";

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

// ===== Withings Token Management =====

async function getWithingsTokens(): Promise<StoredTokens | null> {
  try {
    const stored = await redis.get<StoredTokens>(WITHINGS_TOKEN_KEY);
    if (stored) return stored;
  } catch {
    // Redis not available
  }

  if (process.env.WITHINGS_ACCESS_TOKEN && process.env.WITHINGS_REFRESH_TOKEN) {
    return {
      accessToken: process.env.WITHINGS_ACCESS_TOKEN,
      refreshToken: process.env.WITHINGS_REFRESH_TOKEN,
      expiresAt: 0,
    };
  }
  return null;
}

async function saveWithingsTokens(tokens: TokenResponse): Promise<void> {
  const stored: StoredTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await redis.set(WITHINGS_TOKEN_KEY, stored);
}

function getWithingsConfig(tokens?: StoredTokens | null): WithingsConfig {
  return {
    clientId: process.env.WITHINGS_CLIENT_ID!,
    clientSecret: process.env.WITHINGS_CLIENT_SECRET!,
    redirectUri: process.env.WITHINGS_REDIRECT_URI || "http://localhost:3000/callback",
    accessToken: tokens?.accessToken,
    refreshToken: tokens?.refreshToken,
  };
}

async function ensureValidWithingsToken(): Promise<string | null> {
  const tokens = await getWithingsTokens();
  if (!tokens) return null;

  const isExpired = tokens.expiresAt > 0 && tokens.expiresAt < Date.now() + 5 * 60 * 1000;

  if (isExpired && tokens.refreshToken) {
    const config = getWithingsConfig(tokens);
    try {
      const newTokens = await refreshAccessToken(config);
      await saveWithingsTokens(newTokens);
      return newTokens.access_token;
    } catch {
      return null;
    }
  }

  return tokens.accessToken;
}

async function callWithingsWithAutoRefresh<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
  let accessToken = await ensureValidWithingsToken();
  if (!accessToken) throw new Error("No valid Withings access token. Please authorize first.");

  try {
    return await fn(accessToken);
  } catch (e: any) {
    if (e.message?.includes("401") || e.message?.includes("invalid") || e.message?.includes("expired")) {
      const tokens = await getWithingsTokens();
      if (tokens?.refreshToken) {
        const config = getWithingsConfig(tokens);
        const newTokens = await refreshAccessToken(config);
        await saveWithingsTokens(newTokens);
        return await fn(newTokens.access_token);
      }
    }
    throw e;
  }
}

// ===== WHOOP Token Management =====

async function getWhoopTokens(): Promise<StoredTokens | null> {
  try {
    const stored = await redis.get<StoredTokens>(WHOOP_TOKEN_KEY);
    if (stored) {
      console.log("[mcp] WHOOP tokens from Redis");
      return stored;
    }
  } catch (e) {
    console.log("[mcp] Redis not available:", e);
  }

  const accessToken = process.env.WHOOP_ACCESS_TOKEN?.trim();
  const refreshToken = process.env.WHOOP_REFRESH_TOKEN?.trim();

  if (accessToken && refreshToken) {
    console.log("[mcp] WHOOP tokens from env vars");
    return {
      accessToken,
      refreshToken,
      expiresAt: 0,
    };
  }
  console.log("[mcp] No WHOOP tokens found");
  return null;
}

async function saveWhoopTokens(tokens: WhoopTokenResponse): Promise<void> {
  const stored: StoredTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await redis.set(WHOOP_TOKEN_KEY, stored);
}

function getWhoopConfig(tokens?: StoredTokens | null): WhoopConfig {
  return {
    clientId: process.env.WHOOP_CLIENT_ID?.trim() || "",
    clientSecret: process.env.WHOOP_CLIENT_SECRET?.trim() || "",
    redirectUri: process.env.WHOOP_REDIRECT_URI?.trim() || "http://localhost:3000/callback-whoop",
    accessToken: tokens?.accessToken?.trim(),
    refreshToken: tokens?.refreshToken?.trim(),
  };
}

async function ensureValidWhoopToken(): Promise<string | null> {
  const tokens = await getWhoopTokens();
  if (!tokens) return null;

  const isExpired = tokens.expiresAt > 0 && tokens.expiresAt < Date.now() + 5 * 60 * 1000;

  if (isExpired && tokens.refreshToken) {
    const config = getWhoopConfig(tokens);
    try {
      const newTokens = await refreshWhoopAccessToken(config);
      await saveWhoopTokens(newTokens);
      return newTokens.access_token;
    } catch {
      return null;
    }
  }

  return tokens.accessToken;
}

async function callWhoopWithAutoRefresh<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
  let accessToken = await ensureValidWhoopToken();
  if (!accessToken) throw new Error("No valid WHOOP access token. Please authorize first.");

  try {
    return await fn(accessToken);
  } catch (e: any) {
    console.log("[mcp] WHOOP API error, attempting refresh:", e.message);
    // Catch 401, 404, and other auth-related errors
    if (e.message?.includes("401") || e.message?.includes("404") || e.message?.includes("invalid") || e.message?.includes("expired") || e.message?.includes("Unauthorized")) {
      const tokens = await getWhoopTokens();
      if (tokens?.refreshToken) {
        console.log("[mcp] Refreshing WHOOP token...");
        const config = getWhoopConfig(tokens);
        try {
          const newTokens = await refreshWhoopAccessToken(config);
          await saveWhoopTokens(newTokens);
          console.log("[mcp] WHOOP token refreshed, retrying...");
          return await fn(newTokens.access_token);
        } catch (refreshError: any) {
          console.error("[mcp] WHOOP token refresh failed:", refreshError.message);
          throw refreshError;
        }
      }
    }
    throw e;
  }
}

// ===== Tool Definitions =====

const TOOLS = {
  // Withings tools
  withings_get_auth_url: {
    name: "withings_get_auth_url",
    description: "Get the Withings OAuth authorization URL",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", description: "Optional state parameter" } },
    },
  },
  withings_get_weight: {
    name: "withings_get_weight",
    description: "Get weight measurements from Withings",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (ISO format)" },
        end_date: { type: "string", description: "End date (ISO format)" },
        days: { type: "number", description: "Number of days to look back" },
      },
    },
  },
  withings_get_latest_weight: {
    name: "withings_get_latest_weight",
    description: "Get the most recent weight measurement from Withings",
    inputSchema: { type: "object", properties: {} },
  },
  withings_refresh_token: {
    name: "withings_refresh_token",
    description: "Manually refresh the Withings access token",
    inputSchema: { type: "object", properties: {} },
  },
  // WHOOP tools
  whoop_get_auth_url: {
    name: "whoop_get_auth_url",
    description: "Get the WHOOP OAuth authorization URL",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", description: "Optional state parameter" } },
    },
  },
  whoop_get_daily_stats: {
    name: "whoop_get_daily_stats",
    description: "Get daily stats from WHOOP including calories burned, strain, heart rate, and recovery",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (ISO format)" },
        end_date: { type: "string", description: "End date (ISO format)" },
        days: { type: "number", description: "Number of days to look back" },
      },
    },
  },
  whoop_get_workouts: {
    name: "whoop_get_workouts",
    description: "Get workout data from WHOOP including sport, duration, strain, calories, and heart rate",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (ISO format)" },
        end_date: { type: "string", description: "End date (ISO format)" },
        days: { type: "number", description: "Number of days to look back" },
      },
    },
  },
  whoop_refresh_token: {
    name: "whoop_refresh_token",
    description: "Manually refresh the WHOOP access token",
    inputSchema: { type: "object", properties: {} },
  },
};

async function handleToolCall(name: string, args: any): Promise<string> {
  switch (name) {
    // Withings tools
    case "withings_get_auth_url": {
      const config = getWithingsConfig();
      return getAuthorizationUrl(config, args.state || crypto.randomUUID());
    }
    case "withings_get_weight": {
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      if (args.days) {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - args.days);
      } else {
        if (args.start_date) startDate = new Date(args.start_date);
        if (args.end_date) endDate = new Date(args.end_date);
      }
      const data = await callWithingsWithAutoRefresh((token) =>
        getWeightMeasurements(token, { startDate, endDate })
      );
      return JSON.stringify(data, null, 2);
    }
    case "withings_get_latest_weight": {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const data = await callWithingsWithAutoRefresh((token) =>
        getWeightMeasurements(token, { startDate, endDate })
      );
      if (data.length === 0) return "No measurements in last 30 days.";
      const latest = data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      return JSON.stringify(latest, null, 2);
    }
    case "withings_refresh_token": {
      const tokens = await getWithingsTokens();
      if (!tokens) return "No Withings tokens configured.";
      const config = getWithingsConfig(tokens);
      const newTokens = await refreshAccessToken(config);
      await saveWithingsTokens(newTokens);
      return JSON.stringify({ message: "Withings token refreshed and saved to Redis" }, null, 2);
    }

    // WHOOP tools
    case "whoop_get_auth_url": {
      const config = getWhoopConfig();
      return getWhoopAuthorizationUrl(config, args.state || crypto.randomUUID());
    }
    case "whoop_get_daily_stats": {
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      if (args.days) {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - args.days);
      } else {
        if (args.start_date) startDate = new Date(args.start_date);
        if (args.end_date) endDate = new Date(args.end_date);
      }
      const data = await callWhoopWithAutoRefresh((token) =>
        getWhoopDailyStats(token, { startDate, endDate })
      );
      return JSON.stringify(data, null, 2);
    }
    case "whoop_get_workouts": {
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      if (args.days) {
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - args.days);
      } else {
        if (args.start_date) startDate = new Date(args.start_date);
        if (args.end_date) endDate = new Date(args.end_date);
      }
      const data = await callWhoopWithAutoRefresh((token) =>
        getWhoopWorkoutData(token, { startDate, endDate })
      );
      return JSON.stringify(data, null, 2);
    }
    case "whoop_refresh_token": {
      const tokens = await getWhoopTokens();
      if (!tokens) return "No WHOOP tokens configured.";
      const config = getWhoopConfig(tokens);
      const newTokens = await refreshWhoopAccessToken(config);
      await saveWhoopTokens(newTokens);
      return JSON.stringify({ message: "WHOOP token refreshed and saved to Redis" }, null, 2);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") return new Response(null, { headers });

  // Check secret keys from URL path /api/mcp/[withingsKey]/[whoopKey]
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Expected: ["api", "mcp", withingsKey, whoopKey]

  const expectedWithingsKey = process.env.WITHINGS_MCP_SECRET_KEY?.trim();
  const expectedWhoopKey = process.env.WHOOP_MCP_SECRET_KEY?.trim();

  if (expectedWithingsKey || expectedWhoopKey) {
    const withingsKey = pathParts[2]?.trim();
    const whoopKey = pathParts[3]?.trim();

    if (expectedWithingsKey && withingsKey !== expectedWithingsKey) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid Withings key" }), { status: 401, headers });
    }
    if (expectedWhoopKey && whoopKey !== expectedWhoopKey) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid WHOOP key" }), { status: 401, headers });
    }
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "health-mcp", version: "1.0.0" },
        },
      }),
      { headers }
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    console.log("[mcp] Request:", JSON.stringify({ method: body.method, params: body.params }));
    const { method, params, id } = body;
    let result: any;

    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "health-mcp", version: "1.0.0" },
        };
        break;
      case "tools/list":
        result = { tools: Object.values(TOOLS) };
        break;
      case "tools/call":
        console.log("[mcp] Calling tool:", params.name);
        const toolResult = await handleToolCall(params.name, params.arguments || {});
        console.log("[mcp] Tool result length:", toolResult.length);
        result = { content: [{ type: "text", text: toolResult }] };
        break;
      default:
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id }),
          { headers }
        );
    }

    return new Response(JSON.stringify({ jsonrpc: "2.0", result, id }), { headers });
  } catch (error: any) {
    console.error("[mcp] Error:", error?.message || error, error?.stack);
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(error) }, id: null }),
      { status: 500, headers }
    );
  }
}

export const config = { runtime: "edge" };
