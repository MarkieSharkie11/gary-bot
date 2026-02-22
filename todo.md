# GaryBot Todo

Tasks planned for GaryBot. If you want to pick something up, let the team know so we avoid duplicating effort.

---

## Observability & Metrics

- [ ] **Rate Limit Metrics** — Build a way to track and surface rate limit activity (how often users are being throttled, daily API usage trends, etc.)
- [ ] **Question Log Dashboard** — Build a simple, self-hosted web tool to observe the questions people ask GaryBot in real time (similar to what Nathan built)
- [ ] **Feedback Reaction System** — Automatically add a thumbs-up/thumbs-down reaction to each bot response. Log negative reactions to a file so we can identify which questions GaryBot answers poorly over time
- [ ] **Structured Logging** — Replace scattered `console.log` calls with a proper logger (e.g. pino or winston) that supports log levels (`debug`, `info`, `warn`, `error`). Makes filtering and debugging production issues much easier

## Discord Features

- [ ] **Let Users DM Gary** — Allow users to interact with GaryBot via direct messages, not just server mentions
- [ ] **Direct-Reply Context** — If a user replies directly to a random message and asks Gary about it, use the referenced message as additional context for the response

## Crawler Improvements

- [ ] **RivianForums Guardrails** — Put specific guardrails on crawling RivianForums (Logan offered to help)
  - [ ] Only crawl specific forum sections
  - [ ] Skip member pages, sponsor pages, and other non-content pages
- [ ] **Filter Vehicle Inventory Pages** — Add URL filtering to exclude individual vehicle listing pages (e.g. `https://rivianroamer.com/inventory/*`)
- [ ] **Incremental Crawler Updates** — Instead of re-fetching every page during the monthly crawl, use HTTP conditional requests (`If-Modified-Since` / `ETag`) to skip pages that haven't changed. Speeds up crawls and reduces unnecessary network load
- [ ] **Expand the Knowledge Base** — Add new crawl sources beyond the current three sites. Good candidates:
  - [ ] r/Rivian subreddit (has an RSS feed)
  - [ ] Rivian's official newsroom / press releases
  - [ ] rivianforums.com

## AI & RAG Quality

- [ ] **Improve RAG Search Quality** — Upgrade knowledge base search from basic keyword matching to TF-IDF scoring, which weights rare/important terms more heavily. Add fuzzy matching so typos and word variations (e.g. "charger" vs "charging") still return relevant results
- [ ] **Adaptive Context Window** — Instead of always injecting 5 knowledge base pages into every prompt, set a minimum relevance score so only genuinely matching pages are included. Reduces noise and leads to more accurate answers
- [ ] **Source Citations** — Append a short list of source URLs to each response showing which knowledge base pages were used. Builds user trust and lets people explore topics further
- [ ] **Question Routing / Scope Detection** — Before calling the Claude API, check if a question is Rivian-related. For clearly off-topic questions, return a short redirect message without spending an API call
- [ ] **Configurable Model via .env** — Move the hardcoded Claude model name into an environment variable so upgrading models is a config change rather than a code edit and redeploy

## Infrastructure & Reliability

- [ ] **Input Length Guard** — Add a maximum character limit on incoming questions before they're sent to the API. Prevents edge cases where very long messages inflate token costs or cause unexpected behavior
- [ ] **Persist Conversation History** — Store conversation history to a file or lightweight database (e.g. SQLite) so conversations survive bot restarts. Currently all history lives in memory and is lost on crash or redeploy
- [ ] **Increase Conversation History Depth** — Expand conversation memory from 2 exchanges (4 messages) to 4-5 exchanges. Claude's context window can handle this at low cost, and it meaningfully improves follow-up question handling
- [ ] **Graceful Shutdown Handler** — Add shutdown signal handlers so the bot cleanly saves state before exiting. Prevents data loss during deployments or unexpected crashes

## Completed

- [x] **Admin Commands** — Added Discord slash commands for server admins to manually trigger a knowledge base crawl, view daily usage stats, or clear a user's conversation history without needing direct server access
