#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getWeightMeasurements,
  type WithingsConfig,
} from "./withings.js";

// Load config from environment
function getConfig(): WithingsConfig {
  const clientId = process.env.WITHINGS_CLIENT_ID;
  const clientSecret = process.env.WITHINGS_CLIENT_SECRET;
  const redirectUri = process.env.WITHINGS_REDIRECT_URI || "http://localhost:3000/callback";
  const accessToken = process.env.WITHINGS_ACCESS_TOKEN;
  const refreshToken = process.env.WITHINGS_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error("WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET are required");
  }

  return { clientId, clientSecret, redirectUri, accessToken, refreshToken };
}

const server = new McpServer({
  name: "withings",
  version: "1.0.0",
});

// Tool: Get authorization URL
server.tool(
  "get_auth_url",
  "Get the Withings OAuth authorization URL. User should visit this URL to authorize the app.",
  {
    state: z.string().optional().describe("Optional state parameter for CSRF protection"),
  },
  async ({ state }) => {
    const config = getConfig();
    const url = getAuthorizationUrl(config, state || crypto.randomUUID());
    return {
      content: [{ type: "text", text: url }],
    };
  }
);

// Tool: Exchange auth code for tokens
server.tool(
  "exchange_code",
  "Exchange an authorization code for access and refresh tokens",
  {
    code: z.string().describe("The authorization code from the OAuth callback"),
  },
  async ({ code }) => {
    const config = getConfig();
    const tokens = await exchangeCodeForTokens(config, code);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: "Tokens obtained successfully. Save these in your environment.",
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              expires_in: tokens.expires_in,
              userid: tokens.userid,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: Refresh access token
server.tool(
  "refresh_token",
  "Refresh the access token using the refresh token",
  {},
  async () => {
    const config = getConfig();
    const tokens = await refreshAccessToken(config);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: "Token refreshed successfully. Update your environment variables.",
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              expires_in: tokens.expires_in,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool: Get weight measurements
server.tool(
  "get_weight",
  "Get weight measurements from Withings. Returns weight, fat ratio, muscle mass, etc.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Start date in ISO format (e.g., 2024-01-01)"),
    end_date: z
      .string()
      .optional()
      .describe("End date in ISO format (e.g., 2024-12-31)"),
    days: z
      .number()
      .optional()
      .describe("Number of days to look back (alternative to start_date/end_date)"),
  },
  async ({ start_date, end_date, days }) => {
    const config = getConfig();
    if (!config.accessToken) {
      return {
        content: [
          {
            type: "text",
            text: "No access token configured. Run get_auth_url first to authorize, then exchange_code with the code you receive.",
          },
        ],
      };
    }

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (days) {
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
    } else {
      if (start_date) startDate = new Date(start_date);
      if (end_date) endDate = new Date(end_date);
    }

    const measurements = await getWeightMeasurements(config.accessToken, {
      startDate,
      endDate,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(measurements, null, 2),
        },
      ],
    };
  }
);

// Tool: Get latest weight
server.tool(
  "get_latest_weight",
  "Get the most recent weight measurement",
  {},
  async () => {
    const config = getConfig();
    if (!config.accessToken) {
      return {
        content: [
          {
            type: "text",
            text: "No access token configured. Run get_auth_url first to authorize.",
          },
        ],
      };
    }

    // Get last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const measurements = await getWeightMeasurements(config.accessToken, {
      startDate,
      endDate,
    });

    if (measurements.length === 0) {
      return {
        content: [{ type: "text", text: "No weight measurements found in the last 30 days." }],
      };
    }

    // Sort by date descending and get the latest
    const latest = measurements.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(latest, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
