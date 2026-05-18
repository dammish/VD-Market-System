import {
  EmbedBuilder,
  PermissionFlagsBits,
} from 'discord.js';

// ─── Confirm Close ───────────────────────────────────────────────────────────
export const ticketConfirmClose = {
  customId: 'ticket_confirm_close',

  async execute(interaction) {
    const channel = interaction.channel;
    const user = interaction.user;
    const guild = interaction.guild;

    // Re-check permissions
    const member = await guild.members.fetch(user.id);
    const isStaff = member.permissions.has(PermissionFlagsBits.ManageChannels);
    const isTicketOwner = channel.topic?.includes(user.id);

    if (!isStaff && !isTicketOwner) {
      return interaction.reply({
        content: '❌ You do not have permission to close this ticket.',
        ephemeral: true,
      });
    }

    const closingEmbed = new EmbedBuilder()
      .setTitle('🔒 Ticket Closing')
      .setDescription(
        `This ticket was closed by ${user}.\n\n` +
        `The channel will be **deleted in 5 seconds**.`
      )
      .setColor(0xed4245)
      .setFooter({ text: 'VD Market Tickets' })
      .setTimestamp();

    await interaction.update({ embeds: [closingEmbed], components: [] });

    // Delete channel after 5 seconds
    setTimeout(async () => {
      try {
        await channel.delete(`Ticket closed by ${user.tag}`);
      } catch (error) {
        // Channel may have already been deleted
      }
    }, 5000);
  },
};

// ─── Cancel Close ────────────────────────────────────────────────────────────
export const ticketCancelClose = {
  customId: 'ticket_cancel_close',

  async execute(interaction) {
    const cancelEmbed = new EmbedBuilder()
      .setTitle('✅ Ticket Close Cancelled')
      .setDescription('The ticket will remain open.')
      .setColor(0x57f287)
      .setTimestamp();

    await interaction.update({ embeds: [cancelEmbed], components: [] });
  },
};
