# Withings MCP Server

MCP server for accessing Withings weight data.

## Setup

1. Create a Withings developer account at https://developer.withings.com
2. Create an application and get your client ID and secret
3. Deploy to Vercel: `vercel`
4. Set environment variables in Vercel dashboard
5. Set `WITHINGS_REDIRECT_URI` to `https://your-app.vercel.app/api/callback`

## Authorization

1. Use the `get_auth_url` tool to get the authorization URL
2. Visit the URL and authorize
3. You'll be redirected to the callback with your tokens
4. Add tokens to your environment/Claude config

## Claude Config

Add to your Claude config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "withings": {
      "command": "node",
      "args": ["/path/to/withings-mcp/dist/index.js"],
      "env": {
        "WITHINGS_CLIENT_ID": "your_client_id",
        "WITHINGS_CLIENT_SECRET": "your_client_secret",
        "WITHINGS_REDIRECT_URI": "https://your-app.vercel.app/api/callback",
        "WITHINGS_ACCESS_TOKEN": "your_access_token",
        "WITHINGS_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

## Tools

- `get_auth_url` - Get OAuth URL for authorization
- `exchange_code` - Exchange auth code for tokens
- `refresh_token` - Refresh expired access token
- `get_weight` - Get weight measurements with date filters
- `get_latest_weight` - Get most recent weight measurement
