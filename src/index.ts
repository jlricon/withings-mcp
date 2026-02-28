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
import {
  getWhoopAuthorizationUrl,
  exchangeWhoopCodeForTokens,
  refreshWhoopAccessToken,
  getWhoopDailyStats,
  getWhoopWorkoutData,
  type WhoopConfig,
} from "./whoop.js";

// Load Withings config from environment
function getWithingsConfig(): WithingsConfig {
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

// Load WHOOP config from environment
function getWhoopConfig(): WhoopConfig {
  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const redirectUri = process.env.WHOOP_REDIRECT_URI || "http://localhost:3000/callback-whoop";
  const accessToken = process.env.WHOOP_ACCESS_TOKEN;
  const refreshToken = process.env.WHOOP_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are required");
  }

  return { clientId, clientSecret, redirectUri, accessToken, refreshToken };
}

const server = new McpServer({
  name: "health-mcp",
  version: "1.0.0",
});

// Tool: Get Withings authorization URL
server.tool(
  "withings_get_auth_url",
  "Get the Withings OAuth authorization URL. User should visit this URL to authorize the app.",
  {
    state: z.string().optional().describe("Optional state parameter for CSRF protection"),
  },
  async ({ state }) => {
    const config = getWithingsConfig();
    const url = getAuthorizationUrl(config, state || crypto.randomUUID());
    return {
      content: [{ type: "text", text: url }],
    };
  }
);

// Tool: Exchange Withings auth code for tokens
server.tool(
  "withings_exchange_code",
  "Exchange a Withings authorization code for access and refresh tokens",
  {
    code: z.string().describe("The authorization code from the OAuth callback"),
  },
  async ({ code }) => {
    const config = getWithingsConfig();
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

// Tool: Refresh Withings access token
server.tool(
  "withings_refresh_token",
  "Refresh the Withings access token using the refresh token",
  {},
  async () => {
    const config = getWithingsConfig();
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

// Tool: Get Withings weight measurements
server.tool(
  "withings_get_weight",
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
    const config = getWithingsConfig();
    if (!config.accessToken) {
      return {
        content: [
          {
            type: "text",
            text: "No access token configured. Run withings_get_auth_url first to authorize, then withings_exchange_code with the code you receive.",
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

// Tool: Get latest Withings weight
server.tool(
  "withings_get_latest_weight",
  "Get the most recent weight measurement from Withings",
  {},
  async () => {
    const config = getWithingsConfig();
    if (!config.accessToken) {
      return {
        content: [
          {
            type: "text",
            text: "No access token configured. Run withings_get_auth_url first to authorize.",
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

// ===== WHOOP Tools =====

// Tool: Get WHOOP authorization URL
server.tool(
  "whoop_get_auth_url",
  "Get the WHOOP OAuth authorization URL. User should visit this URL to authorize the app.",
  {
    state: z.string().optional().describe("Optional state parameter for CSRF protection"),
  },
  async ({ state }) => {
    const config = getWhoopConfig();
    const url = getWhoopAuthorizationUrl(config, state || crypto.randomUUID());
    return {
      content: [{ type: "text", text: url }],
    };
  }
);

// Tool: Exchange WHOOP auth code for tokens
server.tool(
  "whoop_exchange_code",
  "Exchange a WHOOP authorization code for access and refresh tokens",
  {
    code: z.string().describe("The authorization code from the OAuth callback"),
  },
  async ({ code }) => {
    const config = getWhoopConfig();
    const tokens = await exchangeWhoopCodeForTokens(config, code);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: "WHOOP tokens obtained successfully. Save these in your environment.",
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

// Tool: Refresh WHOOP access token
server.tool(
  "whoop_refresh_token",
  "Refresh the WHOOP access token using the refresh token",
  {},
  async () => {
    const config = getWhoopConfig();
    const tokens = await refreshWhoopAccessToken(config);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message: "WHOOP token refreshed successfully. Update your environment variables.",
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

// Tool: Get WHOOP daily stats (calories, strain, recovery)
server.tool(
  "whoop_get_daily_stats",
  "Get daily stats from WHOOP including calories burned, strain score, heart rate, and recovery.",
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
    const config = getWhoopConfig();
    if (!config.accessToken) {
      return {
        content: [
          {
            type: "text",
            text: "No access token configured. Run whoop_get_auth_url first to authorize, then whoop_exchange_code with the code you receive.",
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

    const stats = await getWhoopDailyStats(config.accessToken, { startDate, endDate });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(stats, null, 2),
        },
      ],
    };
  }
);

// Tool: Get WHOOP workouts
server.tool(
  "whoop_get_workouts",
  "Get workout data from WHOOP including sport type, duration, strain, calories burned, and heart rate.",
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
    const config = getWhoopConfig();
    if (!config.accessToken) {
      return {
        content: [
          {
            type: "text",
            text: "No access token configured. Run whoop_get_auth_url first to authorize, then whoop_exchange_code with the code you receive.",
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

    const workouts = await getWhoopWorkoutData(config.accessToken, { startDate, endDate });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(workouts, null, 2),
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
