import {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig } from './guildConfig.js';
import { getTicketData, saveTicketData, deleteTicketData, getOpenTicketCountForUser, incrementTicketCounter } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { createEmbed, errorEmbed } from '../utils/embeds.js';
import { logTicketEvent } from '../utils/ticketLogging.js';
import { BotConfig } from '../config/bot.js';
import { ensureTypedServiceError } from '../utils/serviceErrorBoundary.js';

const VOUCH_CHANNEL_ID = '1504208079892250634';

// Ticket types that trigger a vouch DM on close
const VOUCH_TICKET_TYPES = ['Purchase Ticket', 'purchase'];

function getPriorityMap() {
  const priorities = BotConfig.tickets?.priorities || {
    none: { emoji: "⚪", color: "#95A5A6", label: "None" },
    low: { emoji: "🟢", color: "#2ECC71", label: "Low" },
    medium: { emoji: "🟡", color: "#F1C40F", label: "Medium" },
    high: { emoji: "🔴", color: "#E74C3C", label: "High" },
    urgent: { emoji: "🚨", color: "#E91E63", label: "Urgent" },
  };
  const map = {};
  for (const [key, config] of Object.entries(priorities)) {
    map[key] = {
      name: `${config.emoji} ${config.label.toUpperCase()}`,
      color: config.color,
      emoji: config.emoji,
      label: config.label,
    };
  }
  return map;
}

const PRIORITY_MAP = getPriorityMap();
const TICKET_DELETE_DELAY_MS = 3000;
const TICKET_DELETE_DELAY_SECONDS = Math.floor(TICKET_DELETE_DELAY_MS / 1000);

export async function getUserTicketCount(guildId, userId) {
  try {
    return await getOpenTicketCountForUser(guildId, userId);
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'getUserTicketCount',
      message: 'Ticket operation failed: getUserTicketCount',
      userMessage: 'Failed to count open tickets.',
      context: { guildId, userId }
    });
    logger.error('Error counting user tickets:', { guildId, userId, error: typedError.message });
    return 0;
  }
}

export async function createTicket(guild, member, categoryId, reason = 'No reason provided', priority = 'none') {
  try {
    const config = await getGuildConfig(guild.client, guild.id);
    const ticketConfig = config.tickets || {};
    const maxTicketsPerUser = config.maxTicketsPerUser ?? 3;
    const currentTicketCount = await getUserTicketCount(guild.id, member.id);

    if (currentTicketCount >= maxTicketsPerUser) {
      return {
        success: false,
        error: `You have reached the maximum number of open tickets (${maxTicketsPerUser}). Please close your existing tickets before creating a new one.`
      };
    }

    let category = categoryId ?
      guild.channels.cache.get(categoryId) :
      guild.channels.cache.find(c =>
        c.type === ChannelType.GuildCategory &&
        c.name.toLowerCase().includes('tickets')
      );

    if (!category && !categoryId) {
      category = await guild.channels.create({
        name: 'Tickets',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }],
      });
    }

    const ticketNumber = await getNextTicketNumber(guild.id);
    let channelName = `ticket-${ticketNumber}`;
    if (priority !== 'none') {
      const priorityInfo = PRIORITY_MAP[priority];
      if (priorityInfo) channelName = `${priorityInfo.emoji} ${channelName}`;
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...(config.ticketStaffRoleId ? [{
          id: config.ticketStaffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        }] : []),
      ],
    });

    const ticketData = {
      id: channel.id,
      userId: member.id,
      guildId: guild.id,
      createdAt: new Date().toISOString(),
      status: 'open',
      claimedBy: null,
      priority: priority || 'none',
      reason,
    };

    await saveTicketData(guild.id, channel.id, ticketData);

    const priorityInfo = PRIORITY_MAP[priority] || PRIORITY_MAP.none;
    const embed = createEmbed({
      title: `Ticket #${ticketNumber}`,
      description: `${member.toString()}, thanks for creating a ticket!\n\n**Reason:** ${reason}\n**Priority:** ${priorityInfo.emoji} ${priorityInfo.label}`,
      color: priorityInfo.color,
      fields: [
        { name: 'Status', value: '🟢 Open', inline: true },
        { name: 'Claimed By', value: 'Not claimed', inline: true },
        { name: 'Created', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      ],
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary).setEmoji('🙋'),
      new ButtonBuilder().setCustomId('ticket_pin').setLabel('Pin').setStyle(ButtonStyle.Secondary).setEmoji('📌')
    );

    if (ticketConfig.enablePriority) {
      row.addComponents(
        new ButtonBuilder().setCustomId('ticket_priority:low').setLabel('Low').setStyle(ButtonStyle.Secondary).setEmoji('🔵'),
        new ButtonBuilder().setCustomId('ticket_priority:high').setLabel('High').setStyle(ButtonStyle.Danger).setEmoji('🔴')
      );
    }

    const staffMention = config.ticketStaffRoleId ? ` <@&${config.ticketStaffRoleId}>` : '';
    const ticketMessage = await channel.send({
      content: `${member.toString()}${staffMention}`,
      embeds: [embed],
      components: [row]
    });

    await ticketMessage.pin().catch(() => {});

    await logTicketEvent({
      client: guild.client,
      guildId: guild.id,
      event: {
        type: 'open',
        ticketId: channel.id,
        ticketNumber,
        userId: member.id,
        executorId: member.id,
        reason,
        priority: priority || 'none',
        metadata: { channelId: channel.id, categoryName: category?.name || 'Default' }
      }
    });

    return { success: true, channel, ticketData };

  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService', operation: 'createTicket',
      message: 'Ticket operation failed: createTicket',
      userMessage: 'Failed to create ticket. Please try again in a moment.',
      context: { guildId: guild?.id, userId: member?.id }
    });
    logger.error('Error creating ticket:', { guildId: guild?.id, userId: member?.id, error: typedError.message });
    return { success: false, error: typedError.userMessage || typedError.message, errorCode: typedError.context?.errorCode };
  }
}

// Helper: is this a purchase ticket?
function isPurchaseTicket(ticketData) {
  const reason = (ticketData.reason || '').toLowerCase();
  return reason.includes('purchase');
}

// Send vouch DM to ticket creator
async function sendVouchDM(client, ticketData, channelName) {
  try {
    const user = await client.users.fetch(ticketData.userId).catch(() => null);
    if (!user) return;

    const vouchEmbed = new EmbedBuilder()
      .setTitle('⭐ Leave a Vouch')
      .setDescription(`Thank you for your purchase!\n\nWould you like to leave a vouch for your experience?\nClick the button below to fill out a quick review.`)
      .setColor(0xFFD700)
      .setFooter({ text: 'VD Market • Your vouch helps others!' })
      .setTimestamp();

    const vouchButton = new ButtonBuilder()
      .setCustomId(`vouch_start:${ticketData.guildId}:${ticketData.id}`)
      .setLabel('Leave a Vouch')
      .setEmoji('⭐')
      .setStyle(ButtonStyle.Primary);

    const skipButton = new ButtonBuilder()
      .setCustomId(`vouch_skip:${ticketData.id}`)
      .setLabel('Skip')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(vouchButton, skipButton);
    await user.send({ embeds: [vouchEmbed], components: [row] });
  } catch (err) {
    logger.warn(`Could not send vouch DM to user ${ticketData.userId}: ${err.message}`);
  }
}

export async function closeTicket(channel, closer, reason = 'No reason provided') {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: 'This is not a ticket channel' };
    }

    const config = await getGuildConfig(channel.client, channel.guild.id);
    const closedCategoryId = config.ticketClosedCategoryId || null;
    let movedToClosedCategory = false;

    ticketData.status = 'closed';
    ticketData.closedBy = closer.id;
    ticketData.closedAt = new Date().toISOString();
    ticketData.closeReason = reason;

    await saveTicketData(channel.guild.id, channel.id, ticketData);

    if (closedCategoryId && channel.parentId !== closedCategoryId) {
      const closedCategory = channel.guild.channels.cache.get(closedCategoryId)
        || await channel.guild.channels.fetch(closedCategoryId).catch(() => null);
      if (closedCategory?.type === ChannelType.GuildCategory) {
        try {
          await channel.setParent(closedCategoryId, { lockPermissions: false });
          movedToClosedCategory = true;
        } catch (moveError) {
          logger.warn(`Could not move ticket ${channel.id} to closed category: ${moveError.message}`);
        }
      }
    }

    // Send vouch DM for purchase tickets instead of close DM
    if (isPurchaseTicket(ticketData)) {
      await sendVouchDM(channel.client, ticketData, channel.name);
    }
    // No DM sent for non-purchase tickets (removed close notification)

    try {
      const user = await channel.guild.members.fetch(ticketData.userId).catch(() => null);
      const targetUser = user?.user || await channel.client.users.fetch(ticketData.userId).catch(() => null);
      if (targetUser) {
        const overwrite = channel.permissionOverwrites.cache.get(ticketData.userId);
        if (overwrite) {
          await overwrite.edit({ ViewChannel: false, SendMessages: false });
        } else {
          await channel.permissionOverwrites.create(targetUser, { ViewChannel: false, SendMessages: false });
        }
      }
    } catch (permError) {
      logger.warn(`Could not update user permissions for closed ticket: ${permError.message}`);
    }

    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m =>
      m.embeds.length > 0 && m.embeds[0].title?.startsWith('Ticket #')
    );

    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const statusField = embed.fields?.find(f => f.name === 'Status');
      if (statusField) statusField.value = '🔴 Closed';

      const updatedEmbed = createEmbed({
        title: embed.title || 'Ticket',
        description: embed.description || 'Ticket discussion',
        color: '#e74c3c',
        fields: embed.fields || [],
        footer: embed.footer
      });

      await ticketMessage.edit({ embeds: [updatedEmbed], components: [] });
    }

    const closeEmbed = createEmbed({
      title: 'Ticket Closed',
      description: `This ticket has been closed by ${closer}.\n**Reason:** ${reason}`,
      color: '#e74c3c',
      footer: { text: `Ticket ID: ${ticketData.id}` }
    });

    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_reopen').setLabel('Reopen Ticket').setStyle(ButtonStyle.Success).setEmoji('🔓'),
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('Delete Ticket').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
    );

    await channel.send({ embeds: [closeEmbed], components: [controlRow] });

    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'close',
        ticketId: channel.id,
        ticketNumber: ticketData.id,
        userId: ticketData.userId,
        executorId: closer.id,
        reason,
        metadata: { closedAt: ticketData.closedAt, movedToClosedCategory }
      }
    });

    return { success: true, ticketData };

  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService', operation: 'closeTicket',
      message: 'Ticket operation failed: closeTicket',
      userMessage: 'Failed to close ticket. Please try again in a moment.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, closerId: closer?.id }
    });
    logger.error('Error closing ticket:', { guildId: channel?.guild?.id, channelId: channel?.id, error: typedError.message });
    return { success: false, error: typedError.userMessage || typedError.message, errorCode: typedError.context?.errorCode };
  }
}

export async function claimTicket(channel, claimer) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) return { success: false, error: 'This is not a ticket channel' };
    if (ticketData.claimedBy) return { success: false, error: `This ticket is already claimed by <@${ticketData.claimedBy}>` };

    ticketData.claimedBy = claimer.id;
    ticketData.claimedAt = new Date().toISOString();
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title?.startsWith('Ticket #'));

    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const claimedField = embed.fields?.find(f => f.name === 'Claimed By');
      if (claimedField) claimedField.value = claimer.toString();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claimed').setStyle(ButtonStyle.Secondary).setEmoji('🙋').setDisabled(true),
        new ButtonBuilder().setCustomId('ticket_pin').setLabel('Pin').setStyle(ButtonStyle.Secondary).setEmoji('📌')
      );
      await ticketMessage.edit({ embeds: [embed], components: [row] });
    }

    const claimEmbed = createEmbed({ title: 'Ticket Claimed', description: `🎉 ${claimer} has claimed this ticket!`, color: '#2ecc71' });
    const unclaimRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('Unclaim').setStyle(ButtonStyle.Secondary).setEmoji('🔓')
    );

    const claimStatusMessage = messages.find(m =>
      m.embeds.length > 0 && (m.embeds[0].title === 'Ticket Claimed' || m.embeds[0].title === 'Ticket Unclaimed')
    );

    if (claimStatusMessage) {
      await claimStatusMessage.edit({ embeds: [claimEmbed], components: [unclaimRow] });
    } else {
      await channel.send({ embeds: [claimEmbed], components: [unclaimRow] });
    }

    await logTicketEvent({
      client: channel.client, guildId: channel.guild.id,
      event: { type: 'claim', ticketId: channel.id, ticketNumber: ticketData.id, userId: ticketData.userId, executorId: claimer.id, metadata: { claimedAt: ticketData.claimedAt } }
    });

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, { service: 'ticketService', operation: 'claimTicket', message: 'Ticket operation failed: claimTicket', userMessage: 'Failed to claim ticket.', context: { guildId: channel?.guild?.id, channelId: channel?.id } });
    logger.error('Error claiming ticket:', { error: typedError.message });
    return { success: false, error: typedError.userMessage || typedError.message };
  }
}

export async function reopenTicket(channel, reopener) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) return { success: false, error: 'This is not a ticket channel' };
    if (ticketData.status !== 'closed') return { success: false, error: 'This ticket is not currently closed' };

    const config = await getGuildConfig(channel.client, channel.guild.id);
    const openCategoryId = config.ticketCategoryId || null;
    let movedToOpenCategory = false;
    let openCategoryMoveFailed = false;

    ticketData.status = 'open';
    ticketData.closedBy = null;
    ticketData.closedAt = null;
    ticketData.closeReason = null;
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    if (openCategoryId && channel.parentId !== openCategoryId) {
      const openCategory = channel.guild.channels.cache.get(openCategoryId)
        || await channel.guild.channels.fetch(openCategoryId).catch(() => null);
      if (openCategory?.type === ChannelType.GuildCategory) {
        try { await channel.setParent(openCategoryId, { lockPermissions: false }); movedToOpenCategory = true; }
        catch (moveError) { openCategoryMoveFailed = true; logger.warn(`Could not move reopened ticket: ${moveError.message}`); }
      } else { openCategoryMoveFailed = true; }
    }

    try {
      const user = await channel.guild.members.fetch(ticketData.userId).catch(() => null);
      if (user) await channel.permissionOverwrites.create(user, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
    } catch (error) { logger.warn(`Could not restore access for user ${ticketData.userId}:`, error.message); }

    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title?.startsWith('Ticket #'));
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const statusField = embed.fields?.find(f => f.name === 'Status');
      if (statusField) statusField.value = '🟢 Open';

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket_claim').setLabel(ticketData.claimedBy ? 'Claimed' : 'Claim').setStyle(ticketData.claimedBy ? ButtonStyle.Secondary : ButtonStyle.Primary).setEmoji('🙋').setDisabled(!!ticketData.claimedBy),
        new ButtonBuilder().setCustomId('ticket_pin').setLabel('Pin').setStyle(ButtonStyle.Secondary).setEmoji('📌')
      );
      await ticketMessage.edit({ embeds: [embed], components: [row] });
    }

    const reopenEmbed = createEmbed({ title: 'Ticket Reopened', description: `🔓 ${reopener} has reopened this ticket!`, color: '#2ecc71' });
    const closeStatusMessage = messages.find(m =>
      m.embeds.length > 0 && m.embeds[0].title === 'Ticket Closed' && m.components.length > 0 && m.components[0].components.some(c => c.customId === 'ticket_reopen')
    );
    if (closeStatusMessage) { await closeStatusMessage.edit({ embeds: [reopenEmbed], components: [] }); }
    else { await channel.send({ embeds: [reopenEmbed] }); }

    return { success: true, ticketData, movedToOpenCategory, openCategoryMoveFailed };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, { service: 'ticketService', operation: 'reopenTicket', message: 'Ticket operation failed: reopenTicket', userMessage: 'Failed to reopen ticket.', context: { guildId: channel?.guild?.id, channelId: channel?.id } });
    logger.error('Error reopening ticket:', { error: typedError.message });
    return { success: false, error: typedError.userMessage || typedError.message };
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

async function generateTranscript(channel) {
  try {
    const messages = [];
    let before = undefined;
    let batch;
    do {
      batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (batch.size === 0) break;
      messages.push(...batch.values());
      before = batch.last()?.id;
    } while (batch.size === 100);

    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const escape = (str) => String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rows = messages.map((msg) => {
      const ts = new Date(msg.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
      const author = escape(msg.author?.tag ?? msg.author?.username ?? 'Unknown');
      const content = escape(msg.content || (msg.embeds.length ? '[embed]' : '[attachment]'));
      return `<tr><td class="ts">${ts}</td><td class="author">${author}</td><td class="msg">${content}</td></tr>`;
    }).join('\n');

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Transcript – #${escape(channel.name)}</title><style>body{font-family:sans-serif;background:#36393f;color:#dcddde;margin:0;padding:16px}h1{color:#fff}table{width:100%;border-collapse:collapse;font-size:0.85rem}th{background:#2f3136;color:#8e9297;padding:6px 8px;text-align:left;border-bottom:2px solid #202225}td{padding:4px 8px;border-bottom:1px solid #40444b;vertical-align:top}.ts{color:#72767d;white-space:nowrap;width:160px}.author{color:#7289da;white-space:nowrap;width:160px}.msg{word-break:break-word}</style></head><body><h1>📜 Transcript – #${escape(channel.name)}</h1><p style="color:#72767d">${messages.length} message(s) exported on ${new Date().toUTCString()}</p><table><thead><tr><th>Timestamp (UTC)</th><th>Author</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;

    const buffer = Buffer.from(html, 'utf8');
    return new AttachmentBuilder(buffer, { name: `ticket-${channel.id}.html` });
  } catch (error) {
    logger.error('Failed to generate transcript:', { channelId: channel.id, error: error.message });
    return null;
  }
}

export async function deleteTicket(channel, deleter) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) return { success: false, error: 'This is not a ticket channel' };

    const deleteEmbed = createEmbed({
      title: 'Ticket Deleted',
      description: `🗑️ This ticket will be permanently deleted in ${TICKET_DELETE_DELAY_SECONDS} seconds.`,
      color: '#e74c3c',
      footer: { text: `Ticket ID: ${ticketData.id}` }
    });

    await channel.send({ embeds: [deleteEmbed] });

    await logTicketEvent({
      client: channel.client, guildId: channel.guild.id,
      event: { type: 'delete', ticketId: channel.id, ticketNumber: ticketData.id, userId: ticketData.userId, executorId: deleter.id, metadata: { deletedAt: new Date().toISOString() } }
    });

    setTimeout(async () => {
      try {
        let attachment = null;
        try { attachment = await generateTranscript(channel); } catch (e) { logger.error('Transcript error:', e.message); }

        if (attachment) {
          try {
            const guildConfig = await getGuildConfig(channel.client, channel.guild.id);
            if (guildConfig.ticketTranscriptChannelId) {
              const transcriptChannel = await channel.client.channels.fetch(guildConfig.ticketTranscriptChannelId).catch(() => null);
              if (transcriptChannel?.isSendable()) {
                const transcriptEmbed = new EmbedBuilder()
                  .setTitle('📜 Ticket Transcript')
                  .setDescription(`Transcript for ticket #${ticketData.id}`)
                  .setColor('#3498db')
                  .addFields(
                    { name: 'Ticket ID', value: `\`${ticketData.id}\``, inline: true },
                    { name: 'Channel', value: `#${channel.name}`, inline: true },
                    { name: 'Generated', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                  );
                if (deleter?.username) transcriptEmbed.setFooter({ text: `Deleted by: ${deleter.username}`, iconURL: deleter.displayAvatarURL?.() });
                await transcriptChannel.send({ embeds: [transcriptEmbed], files: [attachment] });
              }
            }
          } catch (sendError) { logger.error('Failed to send transcript:', sendError.message); }
        }

        try { await channel.delete('Ticket deleted permanently'); }
        catch (deleteError) { logger.error('Failed to delete ticket channel:', deleteError.message); }
      } catch (error) { logger.error('Unexpected error during ticket deletion:', error.message); }
    }, TICKET_DELETE_DELAY_MS);

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, { service: 'ticketService', operation: 'deleteTicket', message: 'Ticket operation failed: deleteTicket', userMessage: 'Failed to delete ticket.', context: { guildId: channel?.guild?.id, channelId: channel?.id } });
    logger.error('Error deleting ticket:', { error: typedError.message });
    return { success: false, error: typedError.userMessage || typedError.message };
  }
}

export async function unclaimTicket(channel, unclaimer) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) return { success: false, error: 'This is not a ticket channel' };
    if (!ticketData.claimedBy) return { success: false, error: 'This ticket is not currently claimed' };
    if (ticketData.claimedBy !== unclaimer.id && !unclaimer.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return { success: false, error: 'You can only unclaim your own tickets or need Manage Channels permission.' };
    }

    const previousClaimer = ticketData.claimedBy;
    ticketData.claimedBy = null;
    ticketData.claimedAt = null;
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title?.startsWith('Ticket #'));
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const claimedField = embed.fields?.find(f => f.name === 'Claimed By');
      if (claimedField) claimedField.value = 'Not claimed';

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
        new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Primary).setEmoji('🙋'),
        new ButtonBuilder().setCustomId('ticket_pin').setLabel('Pin').setStyle(ButtonStyle.Secondary).setEmoji('📌')
      );
      await ticketMessage.edit({ embeds: [embed], components: [row] });
    }

    const unclaimEmbed = createEmbed({ title: 'Ticket Unclaimed', description: `🔓 ${unclaimer} has unclaimed this ticket!`, color: '#f39c12' });
    const claimMessage = messages.find(m => m.embeds.length > 0 && (m.embeds[0].title === 'Ticket Claimed' || m.embeds[0].title === 'Ticket Unclaimed'));
    if (claimMessage) { await claimMessage.edit({ embeds: [unclaimEmbed], components: [] }); }
    else { await channel.send({ embeds: [unclaimEmbed] }); }

    await logTicketEvent({
      client: channel.client, guildId: channel.guild.id,
      event: { type: 'unclaim', ticketId: channel.id, ticketNumber: ticketData.id, userId: ticketData.userId, executorId: unclaimer.id, metadata: { previousClaimer } }
    });

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, { service: 'ticketService', operation: 'unclaimTicket', message: 'Ticket operation failed: unclaimTicket', userMessage: 'Failed to unclaim ticket.', context: { guildId: channel?.guild?.id, channelId: channel?.id } });
    logger.error('Error unclaiming ticket:', { error: typedError.message });
    return { success: false, error: typedError.userMessage || typedError.message };
  }
}

async function getNextTicketNumber(guildId) {
  return await incrementTicketCounter(guildId);
}

export async function updateTicketPriority(channel, priority, updater) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) return { success: false, error: 'This is not a ticket channel' };

    const priorityInfo = PRIORITY_MAP[priority];
    if (!priorityInfo) return { success: false, error: 'Invalid priority level' };

    ticketData.priority = priority;
    ticketData.priorityUpdatedBy = updater.id;
    ticketData.priorityUpdatedAt = new Date().toISOString();
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    const currentName = channel.name;
    const priorityEmojis = [...new Set(Object.values(PRIORITY_MAP).map(item => item.emoji).filter(Boolean))];
    const escapedPriorityEmojis = priorityEmojis.map(emoji => emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const cleanName = escapedPriorityEmojis.length > 0 ? currentName.replace(new RegExp(`(?:${escapedPriorityEmojis.join('|')})`, 'g'), '').trim() : currentName.trim();
    const newName = priority === 'none' ? cleanName : `${priorityInfo.emoji} ${cleanName}`;
    if (newName && newName !== currentName) { try { await channel.setName(newName); } catch (e) { logger.warn(`Could not update channel name: ${e.message}`); } }

    const messages = await channel.messages.fetch();
    const ticketMessage = messages.find(m => m.embeds.length > 0 && m.embeds[0].title?.startsWith('Ticket #'));
    if (ticketMessage) {
      const embed = ticketMessage.embeds[0];
      const updatedEmbed = createEmbed({
        title: embed.title || 'Ticket',
        description: embed.description?.split('\n**Priority:**')[0] + `\n**Priority:** ${priorityInfo.emoji} ${priorityInfo.label}`,
        color: priorityInfo.color,
        fields: embed.fields || [],
        footer: embed.footer
      });
      await ticketMessage.edit({ embeds: [updatedEmbed] });
    }

    const updateEmbed = createEmbed({ title: 'Priority Updated', description: `📊 Ticket priority updated to **${priorityInfo.emoji} ${priorityInfo.label}** by ${updater}`, color: priorityInfo.color });
    await channel.send({ embeds: [updateEmbed] });

    await logTicketEvent({
      client: channel.client, guildId: channel.guild.id,
      event: { type: 'priority', ticketId: channel.id, ticketNumber: ticketData.id, userId: ticketData.userId, executorId: updater.id, priority, metadata: { previousPriority: ticketData.priority, updatedAt: ticketData.priorityUpdatedAt } }
    });

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, { service: 'ticketService', operation: 'updateTicketPriority', message: 'Ticket operation failed: updateTicketPriority', userMessage: 'Failed to update ticket priority.', context: { guildId: channel?.guild?.id, channelId: channel?.id } });
    logger.error('Error updating ticket priority:', { error: typedError.message });
    return { success: false, error: typedError.userMessage || typedError.message };
  }
}
