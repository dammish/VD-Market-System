import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getTicketData } from '../utils/database.js';
import { logger } from '../utils/logger.js';

const VOUCH_CHANNEL_ID = '1504208079892250634';

const vouchStartHandler = {
  name: 'vouch_start',
  async execute(interaction, client, args) {
    const [guildId, ticketId] = args;

    // Try to get the claimer from ticket data
    let defaultSeller = '';
    try {
      const ticketData = await getTicketData(guildId, ticketId);
      if (ticketData?.claimedBy) {
        const claimer = await client.users.fetch(ticketData.claimedBy).catch(() => null);
        if (claimer) defaultSeller = `<@${ticketData.claimedBy}>`;
      }
    } catch (err) {
      logger.warn(`Could not fetch claimer for vouch: ${err.message}`);
    }

    const modal = new ModalBuilder()
      .setCustomId(`vouch_submit:${guildId}:${ticketId}`)
      .setTitle('Leave a Vouch');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('seller')
          .setLabel('Seller (username or @mention)')
          .setStyle(TextInputStyle.Short)
          .setValue(defaultSeller)
          .setPlaceholder('e.g. Dammish')
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('item')
          .setLabel('Item / Service Purchased')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Discord Nitro')
          .setRequired(true)
          .setMaxLength(200)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rating')
          .setLabel('Rating (1-5)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter a number from 1 to 5')
          .setRequired(true)
          .setMaxLength(1)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('review')
          .setLabel('Review')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Write your review here...')
          .setRequired(true)
          .setMaxLength(1000)
      ),
    );

    await interaction.showModal(modal);
  },
};

const vouchSkipHandler = {
  name: 'vouch_skip',
  async execute(interaction, client, args) {
    await interaction.update({
      embeds: [new EmbedBuilder().setTitle('Vouch Skipped').setDescription('No problem! Thanks for using VD Market.').setColor(0x99aab5).setTimestamp()],
      components: [],
    });
  },
};

const vouchSubmitHandler = {
  name: 'vouch_submit',
  async execute(interaction, client, args) {
    const [guildId, ticketId] = args;

    const seller = interaction.fields.getTextInputValue('seller');
    const item = interaction.fields.getTextInputValue('item');
    const ratingRaw = interaction.fields.getTextInputValue('rating').trim();
    const review = interaction.fields.getTextInputValue('review');

    const rating = parseInt(ratingRaw, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      await interaction.reply({ content: 'Invalid rating. Please enter a number between 1 and 5.', flags: MessageFlags.Ephemeral });
      return;
    }

    const stars = '⭐'.repeat(rating);

    const vouchEmbed = new EmbedBuilder()
      .setTitle('New Vouch')
      .setColor(0xffd700)
      .addFields(
        { name: 'Buyer', value: `${interaction.user}`, inline: true },
        { name: 'Seller', value: seller, inline: true },
        { name: 'Item / Service', value: item, inline: false },
        { name: 'Rating', value: `${stars} (${rating}/5)`, inline: true },
        { name: 'Review', value: review, inline: false },
      )
      .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'VD Market' })
      .setTimestamp();

    try {
      const vouchChannel = await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
      if (vouchChannel?.isSendable()) {
        await vouchChannel.send({ embeds: [vouchEmbed] });
      } else {
        logger.warn(`Vouch channel ${VOUCH_CHANNEL_ID} not found or not sendable`);
      }
    } catch (err) {
      logger.error('Failed to send vouch to channel:', err.message);
    }

    await interaction.update({
      embeds: [new EmbedBuilder().setTitle('Vouch Submitted').setDescription('Thank you for your vouch! Your review has been posted.').setColor(0x57f287).setTimestamp()],
      components: [],
    });
  },
};

export { vouchStartHandler, vouchSkipHandler, vouchSubmitHandler };
export default [vouchStartHandler, vouchSkipHandler];
