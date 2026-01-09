import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config.js";
import { checkFeeds } from "../services/feeds.js";

export const data = new SlashCommandBuilder()
  .setName("bssupdates")
  .setDescription("Checks your configured feeds and shows any new posts.");

export async function execute(interaction) {
  await interaction.deferReply();

  const posts = await checkFeeds(CONFIG.feeds);

  if (!posts.length) {
    return interaction.editReply("No new posts found.");
  }

  const embed = new EmbedBuilder()
    .setTitle("📰 New BSS Update Posts")
    .setDescription(
      posts
        .slice(0, 5)
        .map(p => `• **${p.title}** (${p.source})\n${p.link ?? ""}`)
        .join("\n\n")
    );

  await interaction.editReply({ embeds: [embed] });
}
