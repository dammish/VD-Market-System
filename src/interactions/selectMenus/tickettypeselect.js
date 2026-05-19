import { createTicket } from '../../services/ticket.js';
import { errorEmbed } from '../../utils/embeds.js';
import { MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';

const TICKET_TYPES = {
  purchase: { label: 'Purchase Ticket', reason: 'Purchase enquiry', emoji: '💰' },
  support: { label: 'Support Ticket', reason: 'Support request', emoji: '🛠️' },
  suggestion: { label: 'Suggestion Ticket', reason: 'Suggestion submission', emoji: '💡' },
  partnership: { label: 'Partnership Request', reason: 'Partnership enquiry', emoji: '🤝' },
};

const CATEGORY_ID = '1505525144582488115';

function buildSelectMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_type_select')
      .setPlaceholder('Choose a ticket category...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Purchase Ticket').setDescription('Help with a purchase, payment, or order issue').setValue('purchase').setEmoji('💰'),
        new StringSelectMenuOptionBuilder().setLabel('Support Ticket').setDescription('General support, bugs, or account issues').setValue('support').setEmoji('🛠️'),
        new StringSelectMenuOptionBuilder().setLabel('Suggestion Ticket').setDescription('Submit a suggestion or feature request').setValue('suggestion').setEmoji('💡'),
        new StringSelectMenuOptionBuilder().setLabel('Partnership Request').setDescription('Inquire about partnering with VD Market').setValue('partnership').setEmoji('🤝'),
      )
  );
}

export default {
  name: 'ticket_type_select',

  async execute(interaction, client) {
    const type = interaction.values[0];
    const config = TICKET_TYPES[type];

    if (!config) {
      return interaction.reply({
        embeds: [errorEmbed('Unknown Type', 'Unknown ticket type selected.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Reset the dropdown immediately so it can be used again
    await interaction.update({ components: [buildSelectMenu()] });

    const result = await createTicket(
      interaction.guild,
      interaction.member,
      CATEGORY_ID,
      `[${config.label}] ${config.reason}`
    );

    if (result.success) {
      await interaction.followUp({ content: `Your **${config.label}** has been opened! → ${result.channel}`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.followUp({ embeds: [errorEmbed('Error', result.error || 'Failed to create ticket.')], flags: MessageFlags.Ephemeral });
    }
  },
};
