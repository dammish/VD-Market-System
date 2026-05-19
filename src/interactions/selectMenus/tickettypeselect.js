import { createTicket } from '../../services/ticket.js';
import { errorEmbed } from '../../utils/embeds.js';
import { MessageFlags } from 'discord.js';

const TICKET_TYPES = {
  purchase: { label: 'Purchase Ticket', reason: 'Purchase enquiry' },
  support: { label: 'Support Ticket', reason: 'Support request' },
  suggestion: { label: 'Suggestion Ticket', reason: 'Suggestion submission' },
  partnership: { label: 'Partnership Request', reason: 'Partnership enquiry' },
};

const CATEGORY_ID = '1505525144582488115';

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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await createTicket(
      interaction.guild,
      interaction.member,
      CATEGORY_ID,
      `[${config.label}] ${config.reason}`
    );

    if (result.success) {
      await interaction.editReply({ content: `Your **${config.label}** has been opened! → ${result.channel}` });
    } else {
      await interaction.editReply({ embeds: [errorEmbed('Error', result.error || 'Failed to create ticket.')] });
    }
  },
};
