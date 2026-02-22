# Gary Bot

A Discord bot that answers questions about Rivian. It crawls content from several trusted sources of Rivian information, then uses that knowledge base to give friendly, informed answers powered by Claude.

## How It Works

GaryBot uses a **RAG (Retrieval-Augmented Generation)** pipeline:

1. A web crawler scrapes content from trusted Rivian sources and saves it as JSON files in `data/`.
2. On startup, all pages are loaded into an in-memory knowledge base.
3. When a user asks a question, GaryBot keyword-searches the knowledge base to find the most relevant pages (up to 5).
4. Those pages — along with per-source descriptions to reduce confusion — are injected into a system prompt sent to Claude.
5. Claude replies in GaryBot's friendly, outdoorsy personality.

## Knowledge Base Sources

| Source | Type | Description |
|---|---|---|
| [riviantrackr.com](https://www.riviantrackr.com) | Full spider + RSS | Third-party Rivian news, reviews, and updates blog |
| [rivianroamer.com](https://www.rivianroamer.com) | Full spider | Community dashboard for R1T/R1S inventory and owner data |
| [rivian.com](https://www.rivian.com) | Specific pages | Official Rivian site — specs, pricing, and announcements |

The crawler skips irrelevant pages automatically (charging station detail pages, member profiles, paginated forum threads, login/account pages, etc.).

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

This spiders [riviantrackr.com](https://www.riviantrackr.com) and [rivianroamer.com](https://www.rivianroamer.com), discovers additional pages from the RivianTrackr RSS sitemap feed, and fetches a few specific pages from [rivian.com](https://www.rivian.com). Crawled content is saved as JSON files in the `data/` directory. The crawler uses a 1.5-second delay between requests to be polite to servers.

### 4. Start the bot

```bash
node index.js
```

## Usage

Mention the bot in any Discord channel it has access to:

```
@GaryBot what's the range on the R1S?
```

GaryBot will search its knowledge base for relevant content and reply with a friendly, concise answer. It shows a **typing indicator** while it's working so users know it's on the case.

## Conversation Memory

GaryBot remembers context within a conversation, so users can ask follow-up questions naturally:

- **Depth:** Stores the last **5 exchanges** (10 messages) per user.
- **Idle timeout:** Conversation context is cleared after **60 minutes of inactivity**.
- **Daily reset:** All conversation histories are wiped at **midnight each day**.

## Rate Limits

- **Per-user:** Each user gets a set number of questions per hour (configurable via `USER_RATE_LIMIT`, default 10). When the limit is hit, GaryBot replies with a friendly message telling them how many minutes to wait.
- **Global daily:** There's a daily cap on total API calls (configurable via `GLOBAL_DAILY_LIMIT`, default 100). Once it's hit, GaryBot lets users know it'll be back the next day.
- Rate limits are only counted on **successful** API responses — errors don't burn your quota.

## Automated Schedules

GaryBot runs two background jobs on a cron schedule:

| Schedule | Job |
|---|---|
| 1st of every month at midnight | Re-crawl all sources and reload the knowledge base |
| Every day at midnight | Clear all conversation histories |

## Admin Slash Commands

Server administrators get access to three slash commands (requires the **Administrator** permission):

| Command | Description |
|---|---|
| `/admin-crawl` | Manually trigger a knowledge base crawl and reload pages immediately |
| `/admin-stats` | View live usage stats (see below) |
| `/admin-clear @user` | Clear a specific user's conversation history |

### `/admin-stats` output

```
Admin Stats
- Requests today: 42 / 100 (58 remaining)
- Daily reset in: 6h 30m
- Active users (past hour): 8
- Users at rate limit: 1
- Active conversations: 5
- Knowledge base pages: 214
- Last KB crawl: 3 days ago
```

## Personality

GaryBot is designed to feel like a knowledgeable friend you'd meet at a campsite, not a corporate chatbot:

- Casual, friendly tone — road trips, the outdoors, and EVs
- Light humor (dad jokes about gas stations, etc.)
- Markdown formatting for scannability — **bold** key info, bullet points for lists
- Responses kept under ~1500 characters to fit comfortably in Discord
- Honest when it doesn't know something — suggests Rivian.com or the community for more
- Never uses corporate buzzwords ("leverage," "synergize," "ecosystem")

## Crawl Schedule

Re-run `node crawl.js` periodically to keep the knowledge base fresh, or use the `/admin-crawl` slash command to trigger a refresh without restarting the bot. The bot also auto-crawls on the **1st of every month**.
