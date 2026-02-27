# Changelog

All notable changes to GaryBot are documented in this file.

## [Unreleased]

## 2026-02-27

### Fixed
- Fixed Railway startup crash (`ReferenceError: Cannot access 'STOP_WORDS' before initialization`) by moving `STOP_WORDS`, `stem`, and `levenshtein` declarations above `loadPages()` call

### Changed
- Upgraded knowledge base search from basic keyword matching to TF-IDF scoring, which weights rare/important terms more heavily than common ones
- Added fuzzy matching via suffix stemming (e.g. "charger" / "charging" / "charged" resolve to the same root) and Levenshtein typo correction (1–2 edits for keywords ≥ 5 chars)

## 2026-02-25

### Changed
- Tightened response length instructions: 3–4 short sentences, bulleted lists when appropriate, hard cap of 1000 characters

## 2026-02-23

### Changed
- Moved hardcoded Claude model name into `CLAUDE_MODEL` environment variable; default changed to `claude-haiku-4-5-20251001` for faster, cheaper responses

## 2026-02-22

### Changed
- Expanded conversation memory from 2 to 5 exchanges per user ([#8](https://github.com/MarkieSharkie11/gary-bot/pull/8))
- Updated README with full feature documentation ([#9](https://github.com/MarkieSharkie11/gary-bot/pull/9))

## 2026-02-21

### Fixed
- Fixed source confusion by preserving and surfacing page URLs in RAG context ([#7](https://github.com/MarkieSharkie11/gary-bot/pull/7))
- Added per-source descriptions to knowledge base context so Gary correctly attributes information

### Removed
- Removed special Discord user mention behavior ([#6](https://github.com/MarkieSharkie11/gary-bot/pull/6))

## 2026-02-20

### Added
- Admin slash commands: `/admin-crawl`, `/admin-stats`, `/admin-clear` ([#4](https://github.com/MarkieSharkie11/gary-bot/pull/4))
- Expanded `/admin-stats` with additional usage and knowledge base metrics ([#5](https://github.com/MarkieSharkie11/gary-bot/pull/5))
- Persistent Discord typing indicator while waiting for API responses ([#3](https://github.com/MarkieSharkie11/gary-bot/pull/3))

### Fixed
- Removed source bias toward RivianTrackr in bot identity and fallback suggestions ([#2](https://github.com/MarkieSharkie11/gary-bot/pull/2))

## 2026-02-19

### Added
- SPECIAL_USERS config for per-user Gary behavior overrides ([#1](https://github.com/MarkieSharkie11/gary-bot/pull/1))

### Fixed
- Fixed rate limiter counting failed API requests against user quota

### Changed
- Capped RAG search results to top 5 pages to reduce token usage

## 2026-02-18

### Added
- Per-user conversation memory for follow-up questions
- RSS feed support in crawler for broader riviantrackr.com coverage
- Refreshed crawled data with RSS-discovered riviantrackr.com pages

## 2026-02-15

### Added
- rivianroamer.com as a new data source with URL filtering for low-value pages

## 2026-02-14

### Added
- Initial release of GaryBot
- Discord bot with RAG-powered Q&A about Rivian vehicles
- Web crawler for rivian.com and riviantrackr.com
- Monthly scheduled crawl to refresh the knowledge base
- README with setup instructions and usage docs
