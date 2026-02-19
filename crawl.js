const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DATA_DIR = path.join(__dirname, 'data');
const DELAY_MS = 1500;
const visited = new Set();

// Sites to spider (follows internal links)
const SPIDER_SITES = [
  'https://www.riviantrackr.com',
  'https://www.rivianroamer.com',
];

// URL path patterns to skip when spidering (matched against pathname)
const SKIP_PATTERNS = [
  /^\/charging\/sites\//,    // individual charging station pages
  /^\/charging\/networks\//,  // individual charging network pages
  /^\/leaderboards\//,        // leaderboard sub-pages
  /^\/forum\/members\//,      // forum member profiles
  /^\/forum\/posts\//,        // individual forum post redirects
  /^\/forum\/threads\/.*\/post-/, // specific post anchors within threads
  /^\/forum\/threads\/.*\/page-/, // paginated thread pages
  /^\/forum\/threads\/.*\/latest/, // "latest" post redirects
  /^\/forum\/threads\/\d+$/,  // numeric thread shortcuts
  /\/login/,                  // login pages
  /\/register/,               // registration pages
  /\/account\//,              // account pages
  /\/sign-in/,                // sign-in pages
];

// RSS feeds to discover pages (no link following)
const RSS_FEEDS = [
  'https://riviantrackr.com/sitemap.rss',
];

// Specific pages to fetch (no link following)
const EXTRA_PAGES = [
  'https://www.rivian.com',
  'https://rivian.com/support/support-documents',
];

const queue = SPIDER_SITES.map(site => ({ url: '/', base: site, follow: true }));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(base, urlPath) {
  const host = new URL(base).hostname.replace(/^www\./, '').replace(/\./g, '_');
  const slug = urlPath === '/'
    ? 'index'
    : urlPath.replace(/^\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${host}__${slug}`;
}

function extractLinks($, pageUrl, baseUrl) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.origin === baseUrl) {
        const clean = resolved.pathname.replace(/\/$/, '') || '/';
        links.add(clean);
      }
    } catch {
      // skip malformed URLs
    }
  });
  return links;
}

function extractContent($) {
  $('script, style, nav, footer, header, iframe, noscript').remove();
  const title = $('title').text().trim();
  const text = $('body')
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
  return { title, text };
}

async function crawlPage(urlPath, baseUrl, follow) {
  const fullUrl = baseUrl + urlPath;
  console.log(`Crawling: ${fullUrl}`);

  const res = await fetch(fullUrl, {
    headers: { 'User-Agent': 'GaryBot-Crawler/1.0' },
  });

  if (!res.ok) {
    console.log(`  Skipped (HTTP ${res.status})`);
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    console.log(`  Skipped (not HTML: ${contentType})`);
    return;
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  if (follow) {
    const links = extractLinks($, fullUrl, baseUrl);
    for (const link of links) {
      if (SKIP_PATTERNS.some(pattern => pattern.test(link))) continue;
      const key = baseUrl + link;
      if (!visited.has(key) && !queue.some(q => q.base + q.url === key)) {
        queue.push({ url: link, base: baseUrl, follow: true });
      }
    }
  }

  const { title, text } = extractContent($);

  const data = {
    url: fullUrl,
    path: urlPath,
    title,
    text,
    crawledAt: new Date().toISOString(),
  };

  const filename = slugify(baseUrl, urlPath) + '.json';
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
  console.log(`  Saved: ${filename} (${text.length} chars)`);
}

async function fetchRssUrls(feedUrl) {
  const urls = [];
  try {
    const res = await fetch(feedUrl, {
      headers: { 'User-Agent': 'GaryBot-Crawler/1.0' },
    });
    if (!res.ok) {
      console.log(`  RSS fetch failed (HTTP ${res.status}): ${feedUrl}`);
      return urls;
    }
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    $('item > link').each((_, el) => {
      const link = $(el).text().trim();
      if (link) urls.push(link);
    });
    console.log(`  RSS feed ${feedUrl} — found ${urls.length} URLs`);
  } catch (err) {
    console.log(`  Error fetching RSS ${feedUrl}: ${err.message}`);
  }
  return urls;
}

async function crawl() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Discover pages from RSS feeds
  for (const feedUrl of RSS_FEEDS) {
    const rssUrls = await fetchRssUrls(feedUrl);
    for (const pageUrl of rssUrls) {
      const parsed = new URL(pageUrl);
      const base = parsed.origin;
      const urlPath = parsed.pathname.replace(/\/$/, '') || '/';
      if (!SKIP_PATTERNS.some(pattern => pattern.test(urlPath))) {
        queue.push({ url: urlPath, base, follow: false });
      }
    }
  }

  // Add extra pages to the queue (no link following)
  for (const pageUrl of EXTRA_PAGES) {
    const parsed = new URL(pageUrl);
    const base = parsed.origin;
    const urlPath = parsed.pathname.replace(/\/$/, '') || '/';
    queue.push({ url: urlPath, base, follow: false });
  }

  console.log(`Starting crawl — ${SPIDER_SITES.length} site(s) to spider, ${RSS_FEEDS.length} RSS feed(s), ${EXTRA_PAGES.length} extra page(s)`);
  console.log(`Saving to ${DATA_DIR}\n`);

  while (queue.length > 0) {
    const { url: urlPath, base, follow } = queue.shift();
    const key = base + urlPath;
    if (visited.has(key)) continue;
    visited.add(key);

    try {
      await crawlPage(urlPath, base, follow);
    } catch (err) {
      console.log(`  Error crawling ${key}: ${err.message}`);
    }

    if (queue.length > 0) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone! Crawled ${visited.size} pages.`);
}

crawl();
