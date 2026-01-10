// src/index.js
// Full "fresh" index.js including:
// ✅ Render web-port server (prevents port scan timeout)
// ✅ Auto-post + summarize updates (BSS + Revolution Macro GitHub)
// ✅ !bss Q&A command (OpenAI)
// ✅ Slash commands handler
// ✅ Beesmas live countdown message that EDITS every 60s in one channel
// ✅ Safer env handling (trims tokens/keys so Render headers don't break)

import "dotenv/config";
import http from "http";
import fs from "fs";
import path from "path";
import url from "url";
import {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
} from "discord.js";
import OpenAI from "openai";

import { CONFIG } from "./config.js";
import { checkFeeds } from "./services/feeds.js";
import { summarizePost } from "./services/summarize.js";
import { readData, writeData } from "./services/storage.js";

/* =========================
   Render Web Service Port (FREE PLAN NEEDS THIS)
========================= */
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("bss-bot online\n");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log("Web port listening on", PORT);
  });

/* =========================
   Helpers
========================= */
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function cleanSecret(raw) {
  // removes surrounding quotes + trims whitespace/newlines
  return (raw || "").replace(/^["']|["']$/g, "").trim();
}

function hasBadWhitespace(s) {
  return /[\s\r\n]/.test(s);
}

function safeLogEnv() {
  const dt = cleanSecret(process.env.DISCORD_TOKEN);
  const okDiscord = !!dt && !hasBadWhitespace(dt);
  console.log("DISCORD_TOKEN ok?", okDiscord);

  const okChannel = !!cleanSecret(process.env.UPDATES_CHANNEL_ID);
  console.log("UPDATES_CHANNEL_ID set?", okChannel);

  const bcid = cleanSecret(process.env.BEESMAS_CHANNEL_ID);
  console.log("BEESMAS_CHANNEL_ID set?", !!bcid);

  // Don't print OpenAI key; just show present/not
  const okOpenAI = !!cleanSecret(process.env.OPENAI_API_KEY);
  console.log("OPENAI_API_KEY present?", okOpenAI);
}

function parseSummaryToFields(summaryText) {
  // Expected format:
  // WHATS_NEW:
  // - ...
  // MOST_IMPORTANT:
  // - ...
  // NOTES:
  // - ...
  const lines = (summaryText || "").split("\n");
  let section = "";
  const out = { whatsNew: [], mostImportant: [], notes: [] };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const upper = line.toUpperCase();
    if (upper.startsWith("WHATS_NEW:")) {
      section = "whatsNew";
      continue;
    }
    if (upper.startsWith("MOST_IMPORTANT:")) {
      section = "mostImportant";
      continue;
    }
    if (upper.startsWith("NOTES:")) {
      section = "notes";
      continue;
    }

    if (line.startsWith("-")) {
      const item = line.replace(/^-+\s*/, "").trim();
      if (item && out[section]) out[section].push(item);
    } else {
      if (section && out[section]) out[section].push(line);
    }
  }

  // Fallback if formatting is off
  if (!out.whatsNew.length && !out.mostImportant.length && summaryText) {
    out.whatsNew = [summaryText.slice(0, 400)];
  }

  const join = (arr, maxChars) => {
    const txt = arr.map((x) => `• ${x}`).join("\n");
    return txt.length > maxChars ? txt.slice(0, maxChars - 1) + "…" : txt;
  };

  return {
    whatsNew: join(out.whatsNew, 900),
    mostImportant: join(out.mostImportant, 450),
    notes: join(out.notes, 450),
  };
}

function isRevolutionMacroPost(p) {
  const s = `${p.source || ""} ${p.title || ""} ${p.link || ""}`.toLowerCase();
  // Detect this specific repo (you gave):
  if (s.includes("github.com/nosyliam/revolution-macro")) return true;
  // fallback (if text includes the name)
  return s.includes("revolution") && s.includes("macro");
}

async function safeSend(channel, payload) {
  try {
    await channel.send(payload);
  } catch {
    // ignore
  }
}

/* =========================
   Discord Client
========================= */
const discordToken = cleanSecret(process.env.DISCORD_TOKEN);
if (!discordToken || hasBadWhitespace(discordToken)) {
  throw new Error(
    "DISCORD_TOKEN is missing or contains spaces/newlines. Fix it in Render Environment variables."
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Needed for !bss:
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

/* =========================
   OpenAI (for !bss only)
   - If key missing, bot still runs, just disables !bss answers
========================= */
const openaiKey = cleanSecret(process.env.OPENAI_API_KEY);
const openai =
  openaiKey && !hasBadWhitespace(openaiKey)
    ? new OpenAI({ apiKey: openaiKey })
    : null;

/* =========================
   Cooldown for !bss
========================= */
const cooldown = new Map(); // userId -> last timestamp
const COOLDOWN_MS = 8000;

/* =========================
   Load Slash Commands
========================= */
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath)) {
  const cmd = await import(`./commands/${file}`);
  client.commands.set(cmd.data.name, cmd);
}

/* =========================
   Beesmas Countdown Message (edits every 60s)
========================= */
async function ensureBeesmasCountdownMessage() {
  const channelId = cleanSecret(process.env.BEESMAS_CHANNEL_ID);
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const store = readData();

  const endISO = store.beesmasEndISO || CONFIG.beesmasEndISO;
  const end = new Date(endISO);
  if (isNaN(end.getTime())) return;

  const unix = Math.floor(end.getTime() / 1000);

  const content =
    `🎄 **Beesmas Countdown**\n` +
    `Ends: <t:${unix}:F>\n` +
    `Time left: <t:${unix}:R>\n` +
    `\n*This message updates every 60 seconds.*`;

  // Edit existing message if possible
  if (store.beesmasMessageId) {
    const msg = await channel.messages
      .fetch(store.beesmasMessageId)
      .catch(() => null);

    if (msg) {
      await msg.edit(content).catch(() => {});
      return;
    }

    // message gone -> recreate
    store.beesmasMessageId = null;
    writeData(store);
  }

  // Create new message and save ID
  const sent = await channel.send(content).catch(() => null);
  if (sent) {
    store.beesmasMessageId = sent.id;
    writeData(store);
  }
}

/* =========================
   !bss Answering
========================= */
async function answerBssQuestion(question) {
  if (!openai) {
    return "OpenAI is not configured on this host. Add OPENAI_API_KEY in Render Environment variables.";
  }

  const system =
    "You are a helpful Bee Swarm Simulator assistant. " +
    "Answer clearly and briefly. If unsure, say what you'd check. " +
    "Do not invent exact dates unless provided. " +
    "Prefer practical tips and short lists.";

  // Prefer Responses API, fallback to Chat Completions
  try {
    const r = await openai.responses.create({
      model: CONFIG.openaiModel || "gpt-4o-mini",
      input: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
    });

    const text =
      (r.output_text || "").trim() ||
      (r.output
        ? r.output
            .map((o) => (o.content || []).map((c) => c.text || "").join(""))
            .join("\n")
            .trim()
        : "");

    return text || "I couldn’t generate a response for that.";
  } catch {
    const c = await openai.chat.completions.create({
      model: CONFIG.openaiModel || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
    });

    return (
      c.choices?.[0]?.message?.content?.trim() || "I couldn’t generate a response."
    );
  }
}

/* =========================
   Ready
========================= */
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(
    "Guilds I am in:",
    client.guilds.cache.map((g) => `${g.name} (${g.id})`).join(", ")
  );
  safeLogEnv();

  // Beesmas message: create/edit immediately, then every 60s
  await ensureBeesmasCountdownMessage();
  setInterval(() => {
    ensureBeesmasCountdownMessage().catch(() => {});
  }, 60 * 1000);

  // Auto-post updates every N minutes
  setInterval(async () => {
    if (!CONFIG.feeds?.length) return;

    const updatesChannelId = cleanSecret(process.env.UPDATES_CHANNEL_ID);
    const channel = updatesChannelId
      ? await client.channels.fetch(updatesChannelId).catch(() => null)
      : null;

    if (!channel) return;

    const posts = await checkFeeds(CONFIG.feeds);

    for (const p of posts) {
      const summary = await summarizePost(p);
      const fields = parseSummaryToFields(summary);

      const isMacro = isRevolutionMacroPost(p);
      const prefix = isMacro ? "🧩 Revolution Macro Update" : "📰 BSS Update";

      const embed = new EmbedBuilder().setTitle(`${prefix}: ${p.title}`);

      if (fields.whatsNew)
        embed.addFields({ name: "What’s new", value: fields.whatsNew });
      if (fields.mostImportant)
        embed.addFields({ name: "Most important", value: fields.mostImportant });
      if (fields.notes)
        embed.addFields({ name: "Notes", value: fields.notes });

      embed.setDescription(p.link ? `[Open link](${p.link})` : "");
      embed.setFooter({ text: p.source || "Updates" });

      if (p.date) {
        const t = Date.parse(p.date);
        if (!Number.isNaN(t)) embed.setTimestamp(new Date(t));
      }

      await safeSend(channel, { embeds: [embed] });
    }
  }, (CONFIG.pollMinutes || 5) * 60 * 1000);
});

/* =========================
   Slash Commands Handler
========================= */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch {
    const msg = "Something went wrong running that command.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

/* =========================
   Prefix Command: !bss <question>
========================= */
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const prefix = CONFIG.prefix || "!";
  if (!message.content.startsWith(prefix)) return;

  const [cmd, ...rest] = message.content.slice(prefix.length).trim().split(/\s+/);
  if (!cmd || cmd.toLowerCase() !== "bss") return;

  const question = rest.join(" ").trim();
  if (!question) return message.reply("Use: `!bss <your question>`");

  // cooldown
  const now = Date.now();
  const last = cooldown.get(message.author.id) || 0;
  if (now - last < COOLDOWN_MS) {
    return message.reply("Slow down a bit 😭 (cooldown)");
  }
  cooldown.set(message.author.id, now);

  message.channel.sendTyping().catch(() => {});

  try {
    const answer = await answerBssQuestion(question);
    const trimmed = answer.length > 1500 ? answer.slice(0, 1500) + "…" : answer;

    const embed = new EmbedBuilder()
      .setTitle("🐝 Bee Swarm Answer")
      .setDescription(trimmed);

    await message.reply({ embeds: [embed] });
  } catch {
    await message.reply("I couldn’t answer that right now.");
  }
});

/* =========================
   Login
========================= */
client.login(discordToken);
