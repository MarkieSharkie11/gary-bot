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

async function crawl() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Add extra pages to the queue (no link following)
  for (const pageUrl of EXTRA_PAGES) {
    const parsed = new URL(pageUrl);
    const base = parsed.origin;
    const urlPath = parsed.pathname.replace(/\/$/, '') || '/';
    queue.push({ url: urlPath, base, follow: false });
  }

  console.log(`Starting crawl — ${SPIDER_SITES.length} site(s) to spider, ${EXTRA_PAGES.length} extra page(s)`);
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
