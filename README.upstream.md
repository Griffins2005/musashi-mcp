# Musashi MCP Server

MCP (Model Context Protocol) server providing real-time prediction market intelligence from Polymarket and Kalshi.

## Features

- **8 Tools** for prediction market analysis
- **Dual Transport** support (stdio for local, HTTP+SSE for remote)
- **Authentication** via API keys
- **Rate Limiting** to prevent abuse
- **Graceful Degradation** when data sources fail
- **Real-time** data with freshness tracking

## Installation

### Local Use (Claude Desktop, Cursor)

```bash
cd mcp-server
npm install
npm run build
npm start
```

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "musashi": {
      "command": "node",
      "args": ["/path/to/musashi-github/mcp-server/dist/index.js"]
    }
  }
}
```

### Remote Deployment (Railway/Vercel/Fly.io)

#### Railway (Recommended)

1. Create new project on Railway
2. Connect GitHub repo
3. Set root directory: `mcp-server`
4. Add environment variables:
   ```
   MCP_API_KEYS=mcp_sk_your_key_here
   PORT=3000
   ```
5. Deploy

#### Docker

```bash
docker build -t musashi-mcp .
docker run -p 3000:3000 \
  -e MCP_API_KEYS=mcp_sk_your_key_here \
  musashi-mcp
```

## Available Tools

### 1. analyze_text
Match text to relevant prediction markets.

```
Input: "Bitcoin $100k by year end"
Output: Top matching markets with prices, volume, confidence scores
```

### 2. get_arbitrage
Find cross-platform arbitrage opportunities.

```
Input: minSpread=0.03 (3%)
Output: Markets with price discrepancies between Polymarket and Kalshi
```

### 3. get_movers
Track significant price movements.

```
Input: minChange=0.05 (5%)
Output: Markets with >5% price change in last hour
```

### 4. get_feed
Real-time Twitter feed from prediction market traders.

```
Input: category=crypto, minUrgency=high
Output: Recent tweets with matched markets
```

### 5. get_feed_stats
Feed statistics and distribution.

### 6. get_feed_accounts
List of tracked Twitter accounts.

### 7. get_health
API health check with data source status.

### 8. get_market_trends
(Not yet implemented)

## Environment Variables

Required for HTTP transport:

- `MCP_API_KEYS` - Comma-separated API keys (format: `mcp_sk_<32_chars>`)
- `PORT` - Server port (default: 3000)

Optional:

- `MUSASHI_API_BASE_URL` - REST API endpoint (default: https://musashi-api.vercel.app)
- `MCP_RATE_LIMIT_PER_MINUTE` - Rate limit (default: 60)
- `MCP_RATE_LIMIT_PER_HOUR` - Hourly limit (default: 1000)
- `LOG_LEVEL` - Logging level (default: info)

## API Endpoints (HTTP Transport)

- `GET /health` - Health check (public)
- `GET /mcp/capabilities` - List capabilities (public)
- `POST /mcp/session` - Create session (requires auth)
- `GET /mcp/stream/:sessionId` - SSE stream (requires auth)
- `POST /mcp/message` - Send message (requires auth)

## Rate Limits

- **Session creation:** 10 per hour per API key
- **Message sending:** 60 per minute per API key
- **Concurrent SSE streams:** 5 per API key

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in stdio mode (local)
npm start

# Run in HTTP mode (remote)
npm run start:http

# Watch mode
npm run watch
```

## Testing

```bash
# Health check
curl http://localhost:3000/health

# Capabilities
curl http://localhost:3000/mcp/capabilities

# Create session
curl -X POST http://localhost:3000/mcp/session \
  -H "Authorization: Bearer mcp_sk_test_key"

# Open SSE stream
curl -N http://localhost:3000/mcp/stream/sess_abc123 \
  -H "Authorization: Bearer mcp_sk_test_key"
```

## Architecture

```
User (claude.ai)
  → MCP Server (HTTP+SSE)
  → REST API (musashi-api.vercel.app)
  → Data Sources (Polymarket, Kalshi, Twitter)
```

## Security

- API keys use `mcp_sk_` prefix for easy detection
- Rate limiting prevents abuse
- CORS configured for claude.ai domain
- Input validation on all tool parameters
- Session expiry after 30 minutes

## Support

- GitHub: https://github.com/MusashiBot/Musashi
- Issues: https://github.com/MusashiBot/Musashi/issues
- Documentation: See MCP-INTEGRATION-GUIDE.md

## License

MIT
