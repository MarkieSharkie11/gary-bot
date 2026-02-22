# Contributing to GaryBot

Thanks for helping improve GaryBot! Here's what you need to know before submitting a pull request.

## Getting Started

```bash
npm install
node crawl.js   # crawl knowledge base sources
node index.js   # start the bot
```

You'll need a `.env` file with `DISCORD_TOKEN` and `ANTHROPIC_API_KEY`. See the [README](README.md) for full setup details.

## Pull Request Process

1. Create a feature branch from `main`.
2. Make your changes.
3. **Update `CHANGELOG.md`** with a summary of your changes (see below).
4. **Update `todo.md`** if your PR completes, adds, or modifies any planned tasks (see below).
5. Open a pull request with a clear description of what changed and why.

## Changelog

Every pull request **must** include an update to `CHANGELOG.md`. This keeps collaborators informed about what's changed.

### Format

- Add entries under a heading for today's date (`## YYYY-MM-DD`).
- If a section for today's date already exists, add to it.
- Group entries by category: `Added`, `Changed`, `Fixed`, or `Removed`.
- Link to your PR number when available.
- Keep each entry to one line.

### Example

```markdown
## 2026-02-23

### Added
- New `/admin-reset` command to reset rate limits ([#11](https://github.com/MarkieSharkie11/gary-bot/pull/11))

### Fixed
- Fixed crawler skipping valid rivian.com pages ([#12](https://github.com/MarkieSharkie11/gary-bot/pull/12))
```

## Todo List

Every pull request should update `todo.md` when applicable:

- **Completed a task?** Move it to the **Completed** section and check the box (`[x]`)
- **Adding new planned work?** Add it to the appropriate category with a clear description
- **Partially finished a task?** Note the remaining work in the description

This keeps the team aligned on what's done, what's in progress, and what's coming next.

## Project Structure

- `index.js` — Bot logic: Discord client, RAG search, rate limiting, conversation memory, admin commands
- `crawl.js` — Web crawler for riviantrackr.com, rivianroamer.com, and rivian.com
- `data/` — Crawled knowledge base JSON files (do not edit manually)
