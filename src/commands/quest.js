import { SlashCommandBuilder } from "discord.js";
import { readData, writeData } from "../services/storage.js";

function getUserQuests(store, userId) {
  store.quests ??= {};
  store.quests[userId] ??= [];
  return store.quests[userId];
}

export const data = new SlashCommandBuilder()
  .setName("quest")
  .setDescription("Manage your Bee Swarm quests")
  .addSubcommand(sc =>
    sc
      .setName("add")
      .setDescription("Add a new quest")
      .addStringOption(opt =>
        opt.setName("text").setDescription("Quest description").setRequired(true)
      )
  )
  .addSubcommand(sc =>
    sc
      .setName("list")
      .setDescription("List your active quests")
  )
  .addSubcommand(sc =>
    sc
      .setName("done")
      .setDescription("Mark a quest as completed")
      .addIntegerOption(opt =>
        opt.setName("id").setDescription("Quest ID").setRequired(true)
      )
  )
  .addSubcommand(sc =>
    sc
      .setName("clear")
      .setDescription("Clear all completed quests")
  );

export async function execute(interaction) {
  const store = readData();
  const userId = interaction.user.id;
  const quests = getUserQuests(store, userId);

  const sub = interaction.options.getSubcommand();

  // ADD
  if (sub === "add") {
    const text = interaction.options.getString("text");
    const nextId = quests.length ? Math.max(...quests.map(q => q.id)) + 1 : 1;

    quests.push({
      id: nextId,
      text,
      done: false,
      archived: false,
      createdAt: Date.now()
    });

    writeData(store);
    return interaction.reply(`✅ Quest added (#${nextId})`);
  }

  // LIST
  if (sub === "list") {
    const active = quests.filter(q => !q.done && !q.archived);

    if (!active.length) {
      return interaction.reply("📭 You have no active quests.");
    }

    const lines = active.map(q => `**${q.id}.** ${q.text}`);
    return interaction.reply({
      content: `📜 **Your Quests**\n` + lines.join("\n"),
      ephemeral: true
    });
  }

  // DONE
  if (sub === "done") {
    const id = interaction.options.getInteger("id");
    const quest = quests.find(q => q.id === id && !q.archived);

    if (!quest) {
      return interaction.reply({ content: "❌ Quest not found.", ephemeral: true });
    }

    quest.done = true;
    writeData(store);
    return interaction.reply(`🎉 Quest #${id} marked as completed!`);
  }

  // CLEAR
  if (sub === "clear") {
    const before = quests.length;
    store.quests[userId] = quests.filter(q => !q.done);
    writeData(store);

    return interaction.reply(
      `🧹 Cleared ${before - store.quests[userId].length} completed quests.`
    );
  }
}
