# CLAUDE.md

## Project Overview

GaryBot is a Discord bot that answers questions about Rivian vehicles using a RAG pipeline powered by Claude. It crawls trusted Rivian sources, builds an in-memory knowledge base, and responds in a friendly, outdoorsy personality.

## Project Structure

- `index.js` — Main bot logic: Discord client, RAG search, rate limiting, conversation memory, admin commands
- `crawl.js` — Web crawler: spiders riviantrackr.com, rivianroamer.com, and specific rivian.com pages
- `data/` — Crawled knowledge base (JSON files, not manually edited)

## Development Guidelines

### Changelog

**CHANGELOG.md must be updated in every pull request.** When making changes:

- Add an entry under the current date, grouped by category: `Added`, `Changed`, `Fixed`, or `Removed`
- If today's date section already exists, add to it; otherwise create a new date heading
- Link to the PR number when available (e.g., `([#10](https://github.com/MarkieSharkie11/gary-bot/pull/10))`)
- Keep entries concise — one line per change

### Running the Bot

```bash
npm install
node crawl.js   # crawl knowledge base sources
node index.js   # start the bot
```

### Environment Variables

Required in `.env`:
- `DISCORD_TOKEN` — Discord bot token
- `ANTHROPIC_API_KEY` — Anthropic API key
- `USER_RATE_LIMIT` — Max questions per user per hour (default: 10)
- `GLOBAL_DAILY_LIMIT` — Max total API calls per day (default: 100)
