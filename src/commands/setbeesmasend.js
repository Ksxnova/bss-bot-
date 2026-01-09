import { SlashCommandBuilder, PermissionsBitField } from "discord.js";
import { readData, writeData } from "../services/storage.js";

export const data = new SlashCommandBuilder()
  .setName("setbeesmasend")
  .setDescription("Admin: set the Beesmas end date/time (ISO).")
  .addStringOption(o =>
    o.setName("iso")
      .setDescription("Example: 2026-01-31T23:59:00Z")
      .setRequired(true)
  );

export async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: "Admin only.", ephemeral: true });
  }

  const iso = interaction.options.getString("iso", true);
  const d = new Date(iso);

  if (isNaN(d.getTime())) {
    return interaction.reply({ content: "That ISO date is invalid.", ephemeral: true });
  }

  const store = readData();
  store.beesmasEndISO = d.toISOString();
  writeData(store);

  return interaction.reply(`✅ Beesmas end set to <t:${Math.floor(d.getTime() / 1000)}:F>`);
}
