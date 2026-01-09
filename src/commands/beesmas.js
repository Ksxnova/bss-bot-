import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config.js";
import { readData } from "../services/storage.js";

export const data = new SlashCommandBuilder()
  .setName("beesmas")
  .setDescription("Shows how long until Beesmas ends (stored date > config fallback).");

export async function execute(interaction) {
  const store = readData();
  const endISO = store.beesmasEndISO || CONFIG.beesmasEndISO;

  const end = new Date(endISO);
  const now = new Date();
  const ms = end - now;

  const embed = new EmbedBuilder().setTitle("🎄 Beesmas Countdown");

  if (isNaN(end.getTime())) {
    embed.setDescription("Beesmas end date isn't set correctly.");
  } else if (ms <= 0) {
    embed.setDescription("Beesmas has ended (based on the saved date).");
  } else {
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const mins = totalMinutes % 60;

    embed.setDescription(
      `Ends in **${days}d ${hours}h ${mins}m**\nEnd date: <t:${Math.floor(end.getTime() / 1000)}:F>`
    );
  }

  await interaction.reply({ embeds: [embed] });
}
