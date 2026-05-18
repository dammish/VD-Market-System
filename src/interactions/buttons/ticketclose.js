import {
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export default {
  // Matches ticket_close_{channelId}
  customId: 'ticket_close',

  async execute(interaction) {
    const channel = interaction.channel;
    const user = interaction.user;
    const guild = interaction.guild;

    // Only allow staff (ManageChannels) or the ticket creator to close
    const member = await guild.members.fetch(user.id);
    const isStaff = member.permissions.has(PermissionFlagsBits.ManageChannels);
    const isTicketOwner = channel.topic?.includes(user.id);

    if (!isStaff && !isTicketOwner) {
      return interaction.reply({
        content: '❌ Only the ticket creator or staff can close this ticket.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // Confirmation embed
    const confirmEmbed = new EmbedBuilder()
      .setTitle('🔒 Close Ticket?')
      .setDescription(
        `Are you sure you want to close this ticket?\n\n` +
        `The channel will be deleted in **5 seconds** unless cancelled.`
      )
      .setColor(0xed4245)
      .setFooter({ text: `Requested by ${user.tag}` })
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId(`ticket_confirm_close_${channel.id}`)
      .setLabel('Confirm Close')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('ticket_cancel_close')
      .setLabel('Cancel')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
  },
};
