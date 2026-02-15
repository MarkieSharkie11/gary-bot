# RivianTrackr Bot

A Discord bot that answers questions about Rivian. It crawls content from several trusted sources of Rivian information, then uses that knowledge base to give friendly, informed answers powered by Claude.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root with the following:

```
DISCORD_TOKEN=your_discord_bot_token
ANTHROPIC_API_KEY=your_anthropic_api_key
USER_RATE_LIMIT=10
GLOBAL_DAILY_LIMIT=100
```

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `USER_RATE_LIMIT` | Max questions per user per hour (default: 10) |
| `GLOBAL_DAILY_LIMIT` | Max total API calls per day across all users (default: 100) |

### 3. Run the crawler

```bash
node crawl.js
```

This spiders [riviantrackr.com](https://www.riviantrackr.com) and grabs a few extra pages from [rivian.com](https://www.rivian.com). Crawled content is saved as JSON files in the `data/` directory.

### 4. Start the bot

```bash
node index.js
```

## Usage

Mention the bot in any Discord channel it has access to:

```
@GaryBot what's the range on the R1S?
```

It'll search its knowledge base for relevant info and reply with a friendly, concise answer.

## Rate Limits

- **Per-user:** Each user gets a set number of questions per hour (configurable via `USER_RATE_LIMIT`). Hit the limit and the bot will let you know how long to wait.
- **Global daily:** There's a daily cap on total API calls (configurable via `GLOBAL_DAILY_LIMIT`). Once it's hit, the bot takes a break until the next day.

## Crawl Schedule

Re-run `node crawl.js` periodically to keep the knowledge base fresh with the latest content from RivianTrackr and Rivian.
