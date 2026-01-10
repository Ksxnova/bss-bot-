// src/index.js
import "dotenv/config";
import http from "http";

const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("bss-bot online\n");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log("Web port listening on", PORT);
  });

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

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Needed for !bss prefix command:
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// ===== OpenAI =====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ===== Simple cooldown for !bss =====
const cooldown = new Map(); // userId -> last timestamp
const COOLDOWN_MS = 8000;

// ===== Load slash commands =====
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath)) {
  const cmd = await import(`./commands/${file}`);
  client.commands.set(cmd.data.name, cmd);
}

// ===== Helpers =====
function parseSummaryToFields(summaryText) {
  // Expecting:
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
      // If model didn't use bullets, append to current section
      if (section && out[section]) out[section].push(line);
    }
  }

  // Fallback if formatting is off
  if (!out.whatsNew.length && !out.mostImportant.length && summaryText) {
    out.whatsNew = [summaryText.slice(0, 400)];
  }

  // Keep fields short enough for Discord
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

function isRevelationPost(p) {
  const s = `${p.source || ""} ${p.title || ""} ${p.link || ""}`.toLowerCase();
  // Detect THIS repo specifically:
  if (s.includes("github.com/nosyliam/revolution-macro")) return true;
  // Fallback if it’s described in text:
  return s.includes("revelation") && s.includes("macro");
}

async function answerBssQuestion(question) {
  const system =
    "You are a helpful Bee Swarm Simulator assistant. " +
    "Answer clearly and briefly. If unsure, say what you'd check. " +
    "Do not invent exact dates unless provided. " +
    "Prefer practical tips, steps, and short lists.";

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

async function safeSend(channel, payload) {
  try {
    await channel.send(payload);
  } catch {
    // ignore
  }
}

// ===== Ready =====
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(
    "Guilds I am in:",
    client.guilds.cache.map((g) => `${g.name} (${g.id})`).join(", ")
  );

  // Auto-post feed updates on an interval
  setInterval(async () => {
    if (!CONFIG.feeds?.length) return;

    const channelId = process.env.UPDATES_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const posts = await checkFeeds(CONFIG.feeds);

    for (const p of posts) {
      const summary = await summarizePost(p);
      const fields = parseSummaryToFields(summary);

      const rev = isRevelationPost(p);
      const titlePrefix = rev ? "🧩 Revolution Macro Update" : "📰 BSS Update";

      const embed = new EmbedBuilder().setTitle(`${titlePrefix}: ${p.title}`);

      if (fields.whatsNew)
        embed.addFields({ name: "What’s new", value: fields.whatsNew });
      if (fields.mostImportant)
        embed.addFields({ name: "Most important", value: fields.mostImportant });
      if (fields.notes) embed.addFields({ name: "Notes", value: fields.notes });

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

// ===== Slash commands =====
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

// ===== Prefix command: !bss <question> =====
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

// ===== Login =====
function cleanSecret(raw) {
  return (raw || "").replace(/^["']|["']$/g, "").trim();
}

const discordToken = cleanSecret(process.env.DISCORD_TOKEN);
if (!discordToken || /\s/.test(discordToken)) {
  throw new Error("DISCORD_TOKEN is missing or contains spaces/newlines on Render.");
}

client.login(discordToken);




