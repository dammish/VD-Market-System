import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription('Set up the ticket panel with a dropdown menu')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to post the ticket panel in (defaults to current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Title for the ticket panel embed')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('description')
        .setDescription('Description text for the ticket panel embed')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const title = interaction.options.getString('title') ?? '🎫 VD Market Support';
    const description =
      interaction.options.getString('description') ??
      'Welcome to **VD Market** support!\n\nPlease select a category below that best describes your request and a ticket will be opened for you.\n\n> 🛒 **Purchase** — Help with an order or payment\n> 🛠️ **Support** — General assistance or issues\n> 💡 **Suggestion** — Share your ideas with us\n> 🤝 **Partnership** — Collaborate or partner with us';

    // Build the dropdown menu
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_type_select')
      .setPlaceholder('📋 Choose a ticket category...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Purchase Ticket')
          .setDescription('Help with a purchase, payment, or order issue')
          .setValue('purchase')
          .setEmoji('🛒'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Support Ticket')
          .setDescription('General support, bugs, or account issues')
          .setValue('support')
          .setEmoji('🛠️'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Suggestion Ticket')
          .setDescription('Submit a suggestion or feature request')
          .setValue('suggestion')
          .setEmoji('💡'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Partnership Request')
          .setDescription('Inquire about partnering with VD Market')
          .setValue('partnership')
          .setEmoji('🤝'),
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    // Build the embed panel
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(0x5865f2)
      .setFooter({ text: 'VD Market • Select a category to open a ticket' })
      .setTimestamp();

    try {
      await channel.send({ embeds: [embed], components: [row] });
      await interaction.editReply({
        content: `✅ Ticket panel successfully posted in ${channel}!`,
      });
    } catch (error) {
      await interaction.editReply({
        content: `❌ Failed to send the ticket panel to ${channel}. Make sure I have permission to send messages there.`,
      });
    }
  },
};
