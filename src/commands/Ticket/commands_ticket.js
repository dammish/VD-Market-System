import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

import ticketConfig from './modules/ticket_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Manages the server's ticket system.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription("Sets up the ticket panel in a specified channel.")
                .addChannelOption((option) =>
                    option.setName("panel_channel").setDescription("The channel where the ticket panel will be sent.").addChannelTypes(ChannelType.GuildText).setRequired(true)
                )
                .addStringOption((option) =>
                    option.setName("panel_message").setDescription("The main message/description for the ticket panel.").setRequired(false)
                )
                .addChannelOption((option) =>
                    option.setName("category").setDescription("The category where new tickets will be created (optional).").addChannelTypes(ChannelType.GuildCategory).setRequired(false)
                )
                .addChannelOption((option) =>
                    option.setName("closed_category").setDescription("The category where closed tickets will be moved (optional).").addChannelTypes(ChannelType.GuildCategory).setRequired(false)
                )
                .addRoleOption((option) =>
                    option.setName("staff_role").setDescription("The role that can access tickets (optional).").setRequired(false)
                )
                .addIntegerOption((option) =>
                    option.setName("max_tickets_per_user").setDescription("Maximum number of tickets a user can create (default: 3)").setMinValue(1).setMaxValue(10).setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand.setName("dashboard").setDescription("Open the interactive ticket system dashboard")
        ),
    category: "ticket",

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed("Permission Denied", "You need the `Manage Channels` permission for this action.")],
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === "dashboard") {
                return ticketConfig.execute(interaction, config, client);
            }

            if (subcommand === "setup") {
                const existingConfig = await getGuildConfig(client, interaction.guildId);
                if (existingConfig?.ticketPanelChannelId) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed(
                            'Ticket System Already Active',
                            `This server already has a ticket system set up (panel in <#${existingConfig.ticketPanelChannelId}>).\n\nUse \`/ticket dashboard\` to edit the existing setup, or select **Delete System** from the dashboard to remove it and start fresh.`
                        )],
                    });
                }

                const panelChannel = interaction.options.getChannel("panel_channel");
                const categoryChannel = interaction.options.getChannel("category");
                const closedCategoryChannel = interaction.options.getChannel("closed_category");
                const staffRole = interaction.options.getRole("staff_role");
                const panelMessage = interaction.options.getString("panel_message") || "Welcome to **VD Market** support!\n\nSelect a category below that best describes your request.\n\n**Purchase** — Help with an order or payment\n**Support** — General assistance or issues\n**Suggestion** — Share your ideas with us\n**Partnership** — Collaborate or partner with us";
                const maxTicketsPerUser = interaction.options.getInteger("max_tickets_per_user") || 3;

                // Build dropdown panel
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('ticket_type_select')
                    .setPlaceholder('Choose a ticket category...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Purchase Ticket').setDescription('Help with a purchase, payment, or order issue').setValue('purchase'),
                        new StringSelectMenuOptionBuilder().setLabel('Support Ticket').setDescription('General support, bugs, or account issues').setValue('support'),
                        new StringSelectMenuOptionBuilder().setLabel('Suggestion Ticket').setDescription('Submit a suggestion or feature request').setValue('suggestion'),
                        new StringSelectMenuOptionBuilder().setLabel('Partnership Request').setDescription('Inquire about partnering with VD Market').setValue('partnership'),
                    );

                const selectRow = new ActionRowBuilder().addComponents(selectMenu);

                const panelEmbed = new EmbedBuilder()
                    .setTitle('VD Market Support')
                    .setDescription(panelMessage)
                    .setColor(0x5865f2)
                    .setFooter({ text: 'VD Market — Select a category to open a ticket' })
                    .setTimestamp();

                try {
                    const sentMessage = await panelChannel.send({ embeds: [panelEmbed], components: [selectRow] });

                    if (client.db && interaction.guildId) {
                        const currentConfig = existingConfig;
                        currentConfig.ticketCategoryId = categoryChannel ? categoryChannel.id : null;
                        currentConfig.ticketClosedCategoryId = closedCategoryChannel ? closedCategoryChannel.id : null;
                        currentConfig.ticketStaffRoleId = staffRole ? staffRole.id : null;
                        currentConfig.ticketPanelChannelId = panelChannel.id;
                        currentConfig.ticketPanelMessageId = sentMessage.id;
                        currentConfig.ticketPanelMessage = panelMessage;
                        currentConfig.ticketButtonLabel = 'dropdown';
                        currentConfig.maxTicketsPerUser = maxTicketsPerUser;
                        currentConfig.dmOnClose = false;

                        const { getGuildConfigKey } = await import('../../utils/database.js');
                        const configKey = getGuildConfigKey(interaction.guildId);
                        await client.db.set(configKey, currentConfig);
                    }

                    let successMessage = `Ticket panel posted in ${panelChannel}.`;
                    if (categoryChannel) successMessage += ` New tickets will be created in **${categoryChannel.name}**.`;
                    if (closedCategoryChannel) successMessage += ` Closed tickets will be moved to **${closedCategoryChannel.name}**.`;
                    if (staffRole) successMessage += ` **${staffRole.name}** role will have access to tickets.`;
                    successMessage += `\n\n**Max Tickets Per User:** ${maxTicketsPerUser}`;

                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed("Ticket Panel Set Up", successMessage)],
                    });

                } catch (error) {
                    logger.error('Ticket setup error', { error: error.message, userId: interaction.user.id, guildId: interaction.guildId });
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed("Setup Failed", "Could not send the ticket panel. Check the bot's permissions in the target channel.")],
                    });
                }
            }
        } catch (error) {
            logger.error('Error executing ticket command', { error: error.message, userId: interaction.user.id, guildId: interaction.guildId });
            await handleInteractionError(interaction, error, { commandName: 'ticket', source: 'ticket_command_main' });
        }
    }
};
