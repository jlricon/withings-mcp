import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getWeightMeasurements,
  type WithingsConfig,
} from "../src/withings.js";

function getConfig(): WithingsConfig {
  return {
    clientId: process.env.WITHINGS_CLIENT_ID!,
    clientSecret: process.env.WITHINGS_CLIENT_SECRET!,
    redirectUri: process.env.WITHINGS_REDIRECT_URI || "http://localhost:3000/callback",
    accessToken: process.env.WITHINGS_ACCESS_TOKEN,
    refreshToken: process.env.WITHINGS_REFRESH_TOKEN,
  };
}

const TOOLS = {
  get_auth_url: {
    name: "get_auth_url",
    description: "Get the Withings OAuth authorization URL",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "Optional state parameter" },
      },
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
    description: "Refresh the access token",
    inputSchema: { type: "object", properties: {} },
  },
};

async function handleToolCall(name: string, args: any): Promise<string> {
  const config = getConfig();

  switch (name) {
    case "get_auth_url": {
      const url = getAuthorizationUrl(config, args.state || crypto.randomUUID());
      return url;
    }
    case "get_weight": {
      if (!config.accessToken) return "No access token. Authorize first.";
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
      const data = await getWeightMeasurements(config.accessToken, { startDate, endDate });
      return JSON.stringify(data, null, 2);
    }
    case "get_latest_weight": {
      if (!config.accessToken) return "No access token configured.";
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const data = await getWeightMeasurements(config.accessToken, { startDate, endDate });
      if (data.length === 0) return "No measurements in last 30 days.";
      const latest = data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      return JSON.stringify(latest, null, 2);
    }
    case "refresh_token": {
      const tokens = await refreshAccessToken(config);
      return JSON.stringify({ message: "Token refreshed", ...tokens }, null, 2);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  // Handle GET for server info / SSE endpoint discovery
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
