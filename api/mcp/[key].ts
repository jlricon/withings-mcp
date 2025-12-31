import { Redis } from "@upstash/redis";
import {
  getAuthorizationUrl,
  refreshAccessToken,
  getWeightMeasurements,
  type WithingsConfig,
  type TokenResponse,
} from "../../src/withings.js";

const redis = Redis.fromEnv();
const TOKEN_KEY = "withings_tokens";

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function getTokens(): Promise<StoredTokens | null> {
  try {
    const stored = await redis.get<StoredTokens>(TOKEN_KEY);
    if (stored) return stored;
  } catch {
    // Redis not available
  }

  // Fall back to env vars
  if (process.env.WITHINGS_ACCESS_TOKEN && process.env.WITHINGS_REFRESH_TOKEN) {
    return {
      accessToken: process.env.WITHINGS_ACCESS_TOKEN,
      refreshToken: process.env.WITHINGS_REFRESH_TOKEN,
      expiresAt: 0,
    };
  }
  return null;
}

async function saveTokens(tokens: TokenResponse): Promise<void> {
  const stored: StoredTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await redis.set(TOKEN_KEY, stored);
}

function getConfig(tokens?: StoredTokens | null): WithingsConfig {
  return {
    clientId: process.env.WITHINGS_CLIENT_ID!,
    clientSecret: process.env.WITHINGS_CLIENT_SECRET!,
    redirectUri: process.env.WITHINGS_REDIRECT_URI || "http://localhost:3000/callback",
    accessToken: tokens?.accessToken,
    refreshToken: tokens?.refreshToken,
  };
}

async function ensureValidToken(): Promise<string | null> {
  const tokens = await getTokens();
  if (!tokens) return null;

  const isExpired = tokens.expiresAt > 0 && tokens.expiresAt < Date.now() + 5 * 60 * 1000;

  if (isExpired && tokens.refreshToken) {
    const config = getConfig(tokens);
    try {
      const newTokens = await refreshAccessToken(config);
      await saveTokens(newTokens);
      return newTokens.access_token;
    } catch {
      return null;
    }
  }

  return tokens.accessToken;
}

async function callWithAutoRefresh<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
  let accessToken = await ensureValidToken();
  if (!accessToken) throw new Error("No valid access token. Please authorize first.");

  try {
    return await fn(accessToken);
  } catch (e: any) {
    if (e.message?.includes("401") || e.message?.includes("invalid") || e.message?.includes("expired")) {
      const tokens = await getTokens();
      if (tokens?.refreshToken) {
        const config = getConfig(tokens);
        const newTokens = await refreshAccessToken(config);
        await saveTokens(newTokens);
        return await fn(newTokens.access_token);
      }
    }
    throw e;
  }
}

const TOOLS = {
  get_auth_url: {
    name: "get_auth_url",
    description: "Get the Withings OAuth authorization URL",
    inputSchema: {
      type: "object",
      properties: { state: { type: "string", description: "Optional state parameter" } },
    },
  },
  get_weight: {
    name: "get_weight",
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
  get_latest_weight: {
    name: "get_latest_weight",
    description: "Get the most recent weight measurement",
    inputSchema: { type: "object", properties: {} },
  },
  refresh_token: {
    name: "refresh_token",
    description: "Manually refresh the access token",
    inputSchema: { type: "object", properties: {} },
  },
};

async function handleToolCall(name: string, args: any): Promise<string> {
  switch (name) {
    case "get_auth_url": {
      const config = getConfig();
      return getAuthorizationUrl(config, args.state || crypto.randomUUID());
    }
    case "get_weight": {
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
      const data = await callWithAutoRefresh((token) => getWeightMeasurements(token, { startDate, endDate }));
      return JSON.stringify(data, null, 2);
    }
    case "get_latest_weight": {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const data = await callWithAutoRefresh((token) => getWeightMeasurements(token, { startDate, endDate }));
      if (data.length === 0) return "No measurements in last 30 days.";
      const latest = data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      return JSON.stringify(latest, null, 2);
    }
    case "refresh_token": {
      const tokens = await getTokens();
      if (!tokens) return "No tokens configured.";
      const config = getConfig(tokens);
      const newTokens = await refreshAccessToken(config);
      await saveTokens(newTokens);
      return JSON.stringify({ message: "Token refreshed and saved to Redis" }, null, 2);
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

  // Check secret key from URL path /api/mcp/[key]
  const secretKey = process.env.MCP_SECRET_KEY?.trim();
  if (secretKey) {
    const url = new URL(req.url);
    const pathKey = url.pathname.split("/").pop()?.trim();
    if (pathKey !== secretKey) {
      return new Response(JSON.stringify({ error: "Unauthorized", debug: { pathKey, secretKeyLen: secretKey.length } }), { status: 401, headers });
    }
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "withings", version: "1.0.0" },
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
    const { method, params, id } = body;
    let result: any;

    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "withings", version: "1.0.0" },
        };
        break;
      case "tools/list":
        result = { tools: Object.values(TOOLS) };
        break;
      case "tools/call":
        const toolResult = await handleToolCall(params.name, params.arguments || {});
        result = { content: [{ type: "text", text: toolResult }] };
        break;
      default:
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: "Method not found" }, id }),
          { headers }
        );
    }

    return new Response(JSON.stringify({ jsonrpc: "2.0", result, id }), { headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(error) }, id: null }),
      { status: 500, headers }
    );
  }
}

export const config = { runtime: "edge" };
