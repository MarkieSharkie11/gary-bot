require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const cron = require('node-cron');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ maxRetries: 5 });
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

// Rate limiting
const USER_RATE_LIMIT = parseInt(process.env.USER_RATE_LIMIT, 10) || 10;
const GLOBAL_DAILY_LIMIT = parseInt(process.env.GLOBAL_DAILY_LIMIT, 10) || 100;
const USER_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const userRequests = new Map();   // userId -> [timestamp, ...]
let globalDailyCount = 0;
let globalDayStart = Date.now();

// Conversation memory — keyed by Discord user ID
const HISTORY_LIMIT = 10;                   // max stored messages (5 exchanges)
const IDLE_TIMEOUT_MS = 60 * 60 * 1000;    // clear after 60 minutes of inactivity
const conversationHistory = new Map();       // userId -> { messages: [], lastActivity: number }

function getConversation(userId) {
  const entry = conversationHistory.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.lastActivity >= IDLE_TIMEOUT_MS) {
    conversationHistory.delete(userId);
    return [];
  }
  return entry.messages;
}

function addToConversation(userId, userMsg, assistantMsg) {
  const entry = conversationHistory.get(userId) || { messages: [], lastActivity: 0 };
  entry.messages.push(
    { role: 'user', content: userMsg },
    { role: 'assistant', content: assistantMsg }
  );
  while (entry.messages.length > HISTORY_LIMIT) {
    entry.messages.shift();
  }
  entry.lastActivity = Date.now();
  conversationHistory.set(userId, entry);
}

function resetGlobalIfNewDay() {
  const now = Date.now();
  if (now - globalDayStart >= 24 * 60 * 60 * 1000) {
    globalDailyCount = 0;
    globalDayStart = now;
  }
}

function checkUserRate(userId) {
  const now = Date.now();
  const timestamps = userRequests.get(userId) || [];
  const recent = timestamps.filter(t => now - t < USER_WINDOW_MS);
  userRequests.set(userId, recent);
  if (recent.length >= USER_RATE_LIMIT) {
    const oldestAge = now - recent[0];
    const minutesLeft = Math.ceil((USER_WINDOW_MS - oldestAge) / 60000);
    return { allowed: false, minutesLeft };
  }
  return { allowed: true };
}

function recordUserRequest(userId) {
  const timestamps = userRequests.get(userId) || [];
  timestamps.push(Date.now());
  userRequests.set(userId, timestamps);
}

// Short descriptions for each crawled source domain
const SOURCE_DESCRIPTIONS = {
  'rivian.com':        'Official Rivian website — authoritative source for specs, pricing, and announcements.',
  'riviantrackr.com':  'RivianTrackr — a third-party Rivian news, reviews, and updates blog.',
  'rivianroamer.com':  'Rivian Roamer — a community-built dashboard for tracking R1T/R1S inventory and owner data.',
};

function getSourceDescription(url) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return SOURCE_DESCRIPTIONS[hostname] || null;
  } catch {
    return null;
  }
}

// Load crawled data from ./data/ as RAG knowledge base
const dataDir = path.join(__dirname, 'data');
let pages = [];
let tfidfIndex = null;

function loadPages() {
  const dataFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  pages = dataFiles.map(f => {
    const page = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
    return { title: page.title, text: page.text, url: page.url };
  });
  buildTfIdfIndex();
  console.log(`Loaded ${pages.length} pages into knowledge base.`);
}

loadPages();

// Re-crawl on the 1st of every month at midnight and reload pages
cron.schedule('0 0 1 * *', () => {
  console.log('Scheduled monthly crawl starting...');
  execFile('node', [path.join(__dirname, 'crawl.js')], (err, stdout, stderr) => {
    if (err) {
      console.error('Scheduled crawl failed:', err.message);
      return;
    }
    console.log(stdout);
    if (stderr) console.error(stderr);
    loadPages();
    console.log('Scheduled crawl complete — knowledge base refreshed.');
  });
});

// Clear all conversation history at midnight every day
cron.schedule('0 0 * * *', () => {
  conversationHistory.clear();
  console.log('Daily conversation history reset complete.');
});


const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'and','but','or','nor','not','no','so','if','then','than','that','this','these',
  'those','it','its','of','in','on','at','to','for','with','by','from','about',
  'what','which','who','how','when','where','why','i','me','my','you','your','we',
]);

// Strip common English suffixes to find a word's root (longest suffixes first).
// e.g. "charging" -> "charg", "charger" -> "charg", "charged" -> "charg"
function stem(word) {
  if (word.length <= 4) return word;
  if (word.endsWith('ing')  && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('tion') && word.length > 7) return word.slice(0, -4);
  if (word.endsWith('ness') && word.length > 7) return word.slice(0, -4);
  if (word.endsWith('ment') && word.length > 7) return word.slice(0, -4);
  if (word.endsWith('ers') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('er')  && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('ed')  && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('ly')  && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('es')  && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('s')   && word.length > 4) return word.slice(0, -1);
  return word;
}

// Levenshtein edit distance with early-exit once a row minimum exceeds maxDist.
function levenshtein(a, b, maxDist = Infinity) {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// TF-IDF index built once after pages load; reused on every query.
function buildTfIdfIndex() {
  const N = pages.length;
  if (N === 0) { tfidfIndex = null; return; }

  // Tokenize each page into filtered word list
  const pageTokens = pages.map(page => {
    const text = (page.title + ' ' + page.text).toLowerCase();
    const words = text.match(/\b[a-z]{2,}\b/g) || [];
    return words.filter(w => !STOP_WORDS.has(w));
  });

  // Term frequency per page: count / total_tokens
  const pageTF = pageTokens.map(tokens => {
    const total = tokens.length || 1;
    const freq = {};
    for (const token of tokens) freq[token] = (freq[token] || 0) + 1;
    const tf = {};
    for (const [term, count] of Object.entries(freq)) tf[term] = count / total;
    return tf;
  });

  // Document frequency: number of pages that contain each term
  const df = {};
  for (const tf of pageTF) {
    for (const term of Object.keys(tf)) df[term] = (df[term] || 0) + 1;
  }

  // Smoothed IDF: log((N+1)/(df+1))+1 keeps rare terms high, avoids zero
  const idf = {};
  for (const [term, docFreq] of Object.entries(df)) {
    idf[term] = Math.log((N + 1) / (docFreq + 1)) + 1;
  }

  // TF-IDF vector per page
  const pageTfIdf = pageTF.map(tf => {
    const tfidf = {};
    for (const [term, tfVal] of Object.entries(tf)) tfidf[term] = tfVal * idf[term];
    return tfidf;
  });

  // Stemmed vocabulary map for fast word-variation lookup: stem -> [terms]
  const stemmedVocab = {};
  for (const term of Object.keys(df)) {
    const s = stem(term);
    if (!stemmedVocab[s]) stemmedVocab[s] = [];
    stemmedVocab[s].push(term);
  }

  const vocabulary = Object.keys(df);
  tfidfIndex = { pageTfIdf, idf, stemmedVocab, vocabulary };
}

// Resolve a single query keyword to matching vocabulary terms + confidence weights.
// Priority: exact match > stem match > Levenshtein typo match (1-2 edits).
function expandKeyword(kw, { idf, stemmedVocab, vocabulary }) {
  if (idf[kw] !== undefined) return [{ term: kw, weight: 1.0 }];

  // Word-variation match via stemming (e.g. "charging" matches "charger")
  const stemmedKw = stem(kw);
  if (stemmedVocab[stemmedKw]) {
    return stemmedVocab[stemmedKw].map(term => ({ term, weight: 0.85 }));
  }

  // Typo tolerance via Levenshtein (only for keywords long enough to be meaningful)
  const results = [];
  if (kw.length >= 5) {
    const maxDist = kw.length <= 6 ? 1 : 2;
    for (const vocabTerm of vocabulary) {
      if (Math.abs(vocabTerm.length - kw.length) > maxDist) continue;
      const dist = levenshtein(kw, vocabTerm, maxDist);
      if (dist <= maxDist) results.push({ term: vocabTerm, weight: dist === 1 ? 0.7 : 0.5 });
    }
  }
  return results;
}

function searchPages(question) {
  const words = question.toLowerCase().match(/\b[a-z]{2,}\b/g) || [];
  const keywords = words.filter(w => !STOP_WORDS.has(w));

  if (keywords.length === 0 || !tfidfIndex) return [];

  const scored = pages.map((page, i) => {
    const tfidf = tfidfIndex.pageTfIdf[i];
    let score = 0;
    for (const kw of keywords) {
      for (const { term, weight } of expandKeyword(kw, tfidfIndex)) {
        if (tfidf[term]) score += tfidf[term] * weight;
      }
    }
    return { page, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, 5).map(s => s.page);
}

function buildSystemPrompt(relevantPages) {
  const context = relevantPages.length > 0
    ? relevantPages.map(p => {
        const desc = getSourceDescription(p.url);
        const sourceLine = desc ? `Source: ${p.url} (${desc})` : `Source: ${p.url}`;
        return `## ${p.title}\n${sourceLine}\n${p.text}`;
      }).join('\n\n')
    : '(No relevant content found in the knowledge base for this question.)';

  return `You are GaryBot, your go-to Rivian buddy. Every question you receive is about Rivian — never ask which company or brand the user means.

Personality:
- Talk like a friend at a campsite — friendly, casual, real.
- You're stoked about Rivian, EVs, road trips, the outdoors, and sustainability, but never sound like a sales pitch.
- Sprinkle in light humor — dad jokes about EVs, playful jabs at gas stations, that kind of thing.
- Use language that fits the Rivian community: adventure, family, exploration, getting off the beaten path.
- Never use corporate-speak — no "leverage," "synergize," or "ecosystem."

Answering rules:
- Answer directly in a single response. Never ask clarifying questions.
- For technical questions (specs, earnings, deliveries), be accurate and informative first, personality second.
- Respond in 3–4 short sentences. Use bulleted lists when appropriate. Never exceed 1000 characters.
- Use markdown to help users scan: **bold** key info, use bullet points for lists. Do NOT use large headings (no # or ##).
- Sprinkle in emojis where they fit naturally — keep it fun but don't overdo it.
- If you don't know something, be honest in a lighthearted way. Don't make stuff up. Suggest checking Rivian.com, the Rivian forums, or the community for more.
- Base your answers on the knowledge base below.

<knowledge_base>
${context}
</knowledge_base>`;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const adminCommands = [
  new SlashCommandBuilder()
    .setName('admin-crawl')
    .setDescription('Manually trigger a knowledge base crawl')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('admin-stats')
    .setDescription('View daily usage stats')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('admin-clear')
    .setDescription("Clear a specific user's conversation history")
    .addUserOption(option =>
      option.setName('user').setDescription('The user whose history to clear').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: adminCommands.map(c => c.toJSON()) }
    );
    console.log('Admin slash commands registered.');
  } catch (err) {
    console.error('Failed to register slash commands:', err.message);
  }
});

const processedMessages = new Set();

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 60000);

  const question = message.content
    .replace(/<@[!&]?\d+>/g, '')
    .trim();

  if (!question) {
    await message.reply("You mentioned me but didn't ask anything!");
    return;
  }

  // Global daily limit
  resetGlobalIfNewDay();
  if (globalDailyCount >= GLOBAL_DAILY_LIMIT) {
    await message.reply("Whoa, I've hit my daily limit! 🏕️ Even bots need to recharge. Try again tomorrow and I'll be good to go!");
    return;
  }

  // Per-user hourly limit
  const rateCheck = checkUserRate(message.author.id);
  if (!rateCheck.allowed) {
    await message.reply(`Hey, slow down there trailblazer! 🛑 You've used all ${USER_RATE_LIMIT} of your questions this hour. Check back in about ${rateCheck.minutesLeft} minute${rateCheck.minutesLeft === 1 ? '' : 's'} and I'll be ready to chat again!`);
    return;
  }

  // Send typing indicator immediately and keep refreshing it every 9s while
  // waiting for the API (Discord clears the indicator after ~10s of silence).
  await message.channel.sendTyping();
  const typingInterval = setInterval(() => message.channel.sendTyping(), 9000);

  try {
    const relevantPages = searchPages(question);
    console.log(`Question: "${question}" — matched ${relevantPages.length}/${pages.length} pages`);

    const history = getConversation(message.author.id);
    const messages = [...history, { role: 'user', content: question }];

    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 350,
          system: buildSystemPrompt(relevantPages),
          messages,
        });
        break;
      } catch (err) {
        if (err.status === 429 && attempt === 0) {
          console.log('Anthropic 429 — waiting 10s before retry...');
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
        throw err;
      }
    }

    clearInterval(typingInterval);
    const answer = response.content[0].text.slice(0, 2000);
    addToConversation(message.author.id, question, answer);

    // Only count successful requests against rate limits
    globalDailyCount++;
    recordUserRequest(message.author.id);

    await message.reply(answer);
  } catch (err) {
    clearInterval(typingInterval);
    console.log('Anthropic API error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    if (err.status === 429) {
      await message.reply('I\'m being rate limited. Please try again in a moment.');
    } else if (err.status === 401) {
      await message.reply('API authentication error. Check the bot configuration.');
    } else {
      await message.reply('Sorry, something went wrong while generating a response.');
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'You need Administrator permission to use this command.', ephemeral: true });
    return;
  }

  if (interaction.commandName === 'admin-crawl') {
    await interaction.deferReply({ ephemeral: true });
    execFile('node', [path.join(__dirname, 'crawl.js')], (err, stdout, stderr) => {
      if (err) {
        console.error('Manual crawl failed:', err.message);
        interaction.editReply(`Crawl failed: ${err.message}`);
        return;
      }
      if (stderr) console.error(stderr);
      console.log(stdout);
      loadPages();
      interaction.editReply(`Crawl complete! Knowledge base refreshed with **${pages.length}** pages.`);
    });
    return;
  }

  if (interaction.commandName === 'admin-stats') {
    resetGlobalIfNewDay();
    const now = Date.now();

    // Time until daily reset
    const msUntilReset = 24 * 60 * 60 * 1000 - (now - globalDayStart);
    const hoursLeft = Math.floor(msUntilReset / (60 * 60 * 1000));
    const minutesLeft = Math.floor((msUntilReset % (60 * 60 * 1000)) / 60000);

    // Unique users active in the past hour and how many are rate-limited
    let activeUsers = 0;
    let rateLimitedUsers = 0;
    for (const [, timestamps] of userRequests) {
      const recent = timestamps.filter(t => now - t < USER_WINDOW_MS);
      if (recent.length > 0) activeUsers++;
      if (recent.length >= USER_RATE_LIMIT) rateLimitedUsers++;
    }

    // Most recent crawl date from data files
    let lastCrawled = 'Unknown';
    try {
      const dataFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
      let newest = 0;
      for (const f of dataFiles) {
        const { crawledAt } = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
        if (crawledAt) {
          const t = new Date(crawledAt).getTime();
          if (t > newest) newest = t;
        }
      }
      if (newest) lastCrawled = `<t:${Math.floor(newest / 1000)}:R>`;
    } catch { /* non-fatal */ }

    const stats = [
      '**Admin Stats**',
      `- Requests today: **${globalDailyCount}** / ${GLOBAL_DAILY_LIMIT} (${GLOBAL_DAILY_LIMIT - globalDailyCount} remaining)`,
      `- Daily reset in: **${hoursLeft}h ${minutesLeft}m**`,
      `- Active users (past hour): **${activeUsers}**`,
      `- Users at rate limit: **${rateLimitedUsers}**`,
      `- Active conversations: **${conversationHistory.size}**`,
      `- Knowledge base pages: **${pages.length}**`,
      `- Last KB crawl: ${lastCrawled}`,
    ].join('\n');
    await interaction.reply({ content: stats, ephemeral: true });
    return;
  }

  if (interaction.commandName === 'admin-clear') {
    const targetUser = interaction.options.getUser('user');
    if (conversationHistory.has(targetUser.id)) {
      conversationHistory.delete(targetUser.id);
      await interaction.reply({ content: `Cleared conversation history for <@${targetUser.id}>.`, ephemeral: true });
    } else {
      await interaction.reply({ content: `No active conversation found for <@${targetUser.id}>.`, ephemeral: true });
    }
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
