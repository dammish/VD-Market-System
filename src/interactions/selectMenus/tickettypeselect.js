import {
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

// Ticket type config — edit labels, colors, emojis, and staff role IDs here
const TICKET_TYPES = {
  purchase: {
    label: 'Purchase Ticket',
    emoji: '🛒',
    color: 0x57f287,       // green
    staffRoleId: null,     // set to your staff role ID e.g. '123456789'
    description: 'Thank you for reaching out about a purchase. Our team will assist you shortly.',
    categoryId: null,      // set to a category channel ID to sort tickets
  },
  support: {
    label: 'Support Ticket',
    emoji: '🛠️',
    color: 0x5865f2,       // blurple
    staffRoleId: null,
    description: 'Support ticket opened! Please describe your issue and a staff member will be with you soon.',
    categoryId: null,
  },
  suggestion: {
    label: 'Suggestion Ticket',
    emoji: '💡',
    color: 0xfee75c,       // yellow
    staffRoleId: null,
    description: 'Thanks for your suggestion! Please share your idea in detail below.',
    categoryId: null,
  },
  partnership: {
    label: 'Partnership Request',
    emoji: '🤝',
    color: 0xeb459e,       // fuchsia
    staffRoleId: null,
    description: 'Partnership request received! Please tell us about yourself and what kind of partnership you have in mind.',
    categoryId: null,
  },
};

export default {
  customId: 'ticket_type_select',

  async execute(interaction) {
    const type = interaction.values[0];
    const config = TICKET_TYPES[type];

    if (!config) {
      return interaction.reply({ content: '❌ Unknown ticket type.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const user = interaction.user;

    // Check for existing open ticket
    const existingChannel = guild.channels.cache.find(
      ch => ch.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}` &&
            ch.topic?.includes(user.id)
    );

    if (existingChannel) {
      return interaction.editReply({
        content: `⚠️ You already have an open ticket: ${existingChannel}. Please use that channel or close it before opening a new one.`,
      });
    }

    // Build permission overwrites
    const permissionOverwrites = [
      {
        id: guild.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
    ];

    // Add staff role permissions if configured
    if (config.staffRoleId) {
      const staffRole = guild.roles.cache.get(config.staffRoleId);
      if (staffRole) {
        permissionOverwrites.push({
          id: staffRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.AttachFiles,
          ],
        });
      }
    }

    // Create the ticket channel
    let ticketChannel;
    try {
      const channelOptions = {
        name: `${config.emoji.replace(/\p{Emoji}/gu, '').trim() || type}-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
        type: ChannelType.GuildText,
        topic: `Ticket for ${user.tag} (${user.id}) | Type: ${config.label}`,
        permissionOverwrites,
      };

      if (config.categoryId) {
        channelOptions.parent = config.categoryId;
      }

      ticketChannel = await guild.channels.create(channelOptions);
    } catch (error) {
      return interaction.editReply({
        content: '❌ Failed to create ticket channel. Please make sure I have the **Manage Channels** permission.',
      });
    }

    // Build the ticket embed
    const embed = new EmbedBuilder()
      .setTitle(`${config.emoji} ${config.label}`)
      .setDescription(
        `Hello ${user}! ${config.description}\n\n` +
        `> **User:** ${user.tag}\n` +
        `> **Type:** ${config.label}\n` +
        `> **Opened:** <t:${Math.floor(Date.now() / 1000)}:F>\n\n` +
        `Staff will be with you shortly. Use the button below to close this ticket when resolved.`
      )
      .setColor(config.color)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'VD Market Tickets' })
      .setTimestamp();

    // Close button
    const closeButton = new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketChannel.id}`)
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(closeButton);

    // Mention staff role if set
    const staffMention = config.staffRoleId ? `<@&${config.staffRoleId}>` : '';

    await ticketChannel.send({
      content: `${user} ${staffMention}`.trim(),
      embeds: [embed],
      components: [row],
    });

    await interaction.editReply({
      content: `✅ Your **${config.label}** has been opened! → ${ticketChannel}`,
    });
  },
};
