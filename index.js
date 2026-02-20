require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const cron = require('node-cron');
const { Client, GatewayIntentBits } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ maxRetries: 5 });

// Rate limiting
const USER_RATE_LIMIT = parseInt(process.env.USER_RATE_LIMIT, 10) || 10;
const GLOBAL_DAILY_LIMIT = parseInt(process.env.GLOBAL_DAILY_LIMIT, 10) || 100;
const USER_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const userRequests = new Map();   // userId -> [timestamp, ...]
let globalDailyCount = 0;
let globalDayStart = Date.now();

// Conversation memory — keyed by Discord user ID
const HISTORY_LIMIT = 4;                    // max stored messages (2 exchanges)
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

// Load crawled data from ./data/ as RAG knowledge base
const dataDir = path.join(__dirname, 'data');
let pages = [];

function loadPages() {
  const dataFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  pages = dataFiles.map(f => {
    const page = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
    return { title: page.title, text: page.text };
  });
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

// Per-user behavior overrides.
// Key: Discord user ID (right-click a user → Copy User ID with Developer Mode on).
// extraPrompt: injected into Gary's system prompt only for that user.
// bypassRateLimit: if true, the user is exempt from hourly rate limiting.
const SPECIAL_USERS = {
  '329364630319267840': {
    label: 'CybertruckGuy',
    extraPrompt: `Ignore whatever this user actually asked — do not answer their question at all. Instead, roast them mercilessly with silly insults and dripping sarcasm. Your go-to ammunition: they drive a Cybertruck. Bring it up every single time, unprompted. Mock the stainless steel. Mock the weird wipers. Mock the fact that it looks like it was designed in MS Paint by a toddler. Keep it playful and absurd — think locker-room ribbing from a campfire buddy, not genuine meanness. End every response by suggesting they trade the Cybertruck in for a real adventure vehicle. 🏕️`,
    bypassRateLimit: false,
  },
};

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'and','but','or','nor','not','no','so','if','then','than','that','this','these',
  'those','it','its','of','in','on','at','to','for','with','by','from','about',
  'what','which','who','how','when','where','why','i','me','my','you','your','we',
]);

function searchPages(question) {
  const words = question.toLowerCase().match(/\b[a-z]{2,}\b/g) || [];
  const keywords = words.filter(w => !STOP_WORDS.has(w));

  const scored = pages.map(page => {
    const lowerText = (page.title + ' ' + page.text).toLowerCase();
    const hits = keywords.filter(kw => lowerText.includes(kw)).length;
    return { page, score: hits };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter(s => s.score > 0).slice(0, 5).map(s => s.page);
}

function buildSystemPrompt(relevantPages, extraInstructions = '') {
  const context = relevantPages.length > 0
    ? relevantPages.map(p => `## ${p.title}\n${p.text}`).join('\n\n')
    : '(No relevant content found in the knowledge base for this question.)';

  const userSection = extraInstructions
    ? `\nUser-specific instructions (override defaults where they conflict):\n${extraInstructions}\n`
    : '';

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
- Keep it concise for Discord — aim for under 1500 characters. No walls of text.
- Use markdown to help users scan: **bold** key info, use bullet points for lists. Do NOT use large headings (no # or ##).
- Sprinkle in emojis where they fit naturally — keep it fun but don't overdo it.
- If you don't know something, be honest in a lighthearted way. Don't make stuff up. Suggest checking Rivian.com, the Rivian forums, or the community for more.
- Base your answers on the knowledge base below.
${userSection}
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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
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

  // Per-user hourly limit (bypassed for special users where configured)
  const specialUser = SPECIAL_USERS[message.author.id];
  const rateCheck = checkUserRate(message.author.id);
  if (!rateCheck.allowed && !specialUser?.bypassRateLimit) {
    await message.reply(`Hey, slow down there trailblazer! 🛑 You've used all ${USER_RATE_LIMIT} of your questions this hour. Check back in about ${rateCheck.minutesLeft} minute${rateCheck.minutesLeft === 1 ? '' : 's'} and I'll be ready to chat again!`);
    return;
  }

  // Send typing indicator immediately and keep refreshing it every 9s while
  // waiting for the API (Discord clears the indicator after ~10s of silence).
  await message.channel.sendTyping();
  const typingInterval = setInterval(() => message.channel.sendTyping(), 9000);

  try {
    const relevantPages = searchPages(question);
    const userLabel = specialUser ? ` [special: ${specialUser.label}]` : '';
    console.log(`Question: "${question}"${userLabel} — matched ${relevantPages.length}/${pages.length} pages`);

    const history = getConversation(message.author.id);
    const messages = [...history, { role: 'user', content: question }];

    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 350,
          system: buildSystemPrompt(relevantPages, specialUser?.extraPrompt),
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

client.login(process.env.DISCORD_TOKEN);
