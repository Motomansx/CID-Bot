const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Allowed Role IDs that can deploy the panel
const AUTHORIZED_DEPLOY_ROLES = [
    "1527133365658980404",
    "1527133370449133598",
    "1527133374609756322"
];

// Required Role IDs that always get view access to case channels
const PERMANENT_CASE_ROLES = [
    "1550517805516849202",
    "1550517244017250454",
    "1550518373505433731",
    "1527133378032177192"
];

// Specific Role allowed to run purge
const PURGE_AUTHORIZED_ROLE = "1527133378032177192";

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cid_records (
                case_id SERIAL PRIMARY KEY,
                channel_id BIGINT UNIQUE NOT NULL,
                suspect_name TEXT NOT NULL,
                ticket_type TEXT NOT NULL,
                complainant_id BIGINT NOT NULL,
                assigned_agent_id BIGINT,
                charges TEXT DEFAULT 'Pending Investigation',
                punishment TEXT DEFAULT 'None',
                status TEXT DEFAULT 'Open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            ALTER TABLE cid_records ADD COLUMN IF NOT EXISTS assigned_agent_id BIGINT;
        `);

        console.log("Database table 'cid_records' and columns are verified & ready.");
    } catch (err) {
        console.error("Database initialization error:", err);
    }

    // Register Slash Commands with Discord API
    const commands = [
        new SlashCommandBuilder()
            .setName('cidpanel')
            .setDescription('Deploy the CID ticket generation panel'),
        new SlashCommandBuilder()
            .setName('assign')
            .setDescription('Assign an investigator to this CID case file')
            .addUserOption(option => 
                option.setName('agent')
                    .setDescription('The agent to assign to this case')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('cidchannelpurge')
            .setDescription('Deletes all current active CID case channels from database records')
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

// Handle Slash Commands & Interactive Buttons
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, member, guild, channel } = interaction;

        if (commandName === 'cidpanel') {
            const hasRole = AUTHORIZED_DEPLOY_ROLES.some(roleId => member.roles.cache.has(roleId));
            if (!hasRole && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: "You do not have permission to deploy the CID panel.", ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle("CRIMINAL INVESTIGATION DIVISION")
                .setDescription("Welcome to the Criminal Investigation Division's ticket system. Before opening a ticket, please review the rules and select your report category from the dropdown below.")
                .setColor(0x8B0000)
                .addFields(
                    { name: "Public Inquiry", value: "Questions, advice, or general help." },
                    { name: "General Report", value: "To report individuals ranked E1-E7 / O1-O6." },
                    { name: "Senior Leadership Report", value: "To report individuals ranked E8+ / O7+." },
                    { name: "Report CID Personnel", value: "To report a member of CID Personnel." },
                    { name: "Warrant Request", value: "To request a search or arrest warrant." },
                    { name: "Background Check Request", value: "Request a background history check." }
                )
                .setFooter({ text: "Signed, COL. Motomansx | Deputy Director Of Criminal Investigations" });

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('cid_ticket_select')
                .setPlaceholder('Select a Ticket Type')
                .addOptions([
                    { label: 'Public Inquiry', value: 'ticket_public', description: 'General questions or advice' },
                    { label: 'General Report (E1-E7 / O1-O6)', value: 'ticket_general', description: 'Report lower/mid ranks' },
                    { label: 'Senior Leadership Report (E8+ / O7+)', value: 'ticket_senior', description: 'Report high ranks' },
                    { label: 'Report CID Personnel', value: 'ticket_cid', description: 'Report internal CID staff' },
                    { label: 'Warrant Request', value: 'ticket_warrant', description: 'Request an official warrant' },
                    { label: 'Background Check Request', value: 'ticket_background', description: 'Run a background check' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.channel.send({ embeds: [embed], components: [row] });
            await interaction.reply({ content: "CID panel deployed successfully.", ephemeral: true });
        }

        if (commandName === 'cidchannelpurge') {
            if (!member.roles.cache.has(PURGE_AUTHORIZED_ROLE) && !member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: "❌ You do not have permission to use this command.", ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            try {
                const dbRes = await pool.query(`SELECT channel_id FROM cid_records`);
                let deletedCount = 0;

                for (const row of dbRes.rows) {
                    const targetChannel = guild.channels.cache.get(String(row.channel_id));
                    if (targetChannel) {
                        await targetChannel.delete().catch(() => {});
                        deletedCount++;
                    }
                }

                await pool.query(`DELETE FROM cid_records`);
                await interaction.editReply({ content: `✅ Purge complete. Deleted ${deletedCount} active case channel(s) and cleared database records.` });
            } catch (err) {
                console.error("Purge Error:", err);
                await interaction.editReply({ content: `❌ An error occurred during the purge: \`${err.message}\`` });
            }
        }

        if (commandName === 'assign') {
            await interaction.deferReply({ ephemeral: true });

            const dbCheck = await pool.query(`SELECT * FROM cid_records WHERE channel_id = $1`, [channel.id]);
            if (dbCheck.rows.length === 0) {
                return interaction.editReply({ content: "❌ This command can only be used inside an active CID case channel." });
            }

            const targetAgent = interaction.options.getUser('agent');
            const caseData = dbCheck.rows[0];
            const complainantId = String(caseData.complainant_id);

            // Create role formatted as REDACTED#[ID]
            let caseRole = await guild.roles.create({
                name: `REDACTED#${caseData.case_id}`,
                color: 0x8B0000,
                reason: `Assigned investigator role for Case #${caseData.case_id}`
            });

            // Assign the role to the target agent member object
            const targetMember = await guild.members.fetch(targetAgent.id).catch(() => null);
            if (targetMember) {
                await targetMember.roles.add(caseRole).catch(() => {});
            }

            let overwrites = [
                { id: guild.id, type: 0, deny: [PermissionFlagsBits.ViewChannel] },
                { id: complainantId, type: 1, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: caseRole.id, type: 0, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ];

            PERMANENT_CASE_ROLES.forEach(roleId => {
                overwrites.push({
                    id: roleId,
                    type: 0,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                });
            });

            try {
                await channel.permissionOverwrites.set(overwrites);
                await pool.query(`UPDATE cid_records SET assigned_agent_id = $1 WHERE channel_id = $2`, [targetAgent.id, channel.id]);
                
                await interaction.editReply({ content: `✅ Successfully assigned ${targetAgent} and created role \`REDACTED#${caseData.case_id}\`.` });
                await channel.send(`🔔 Case Update: <@${complainantId}>, <@${targetAgent.id}> has been assigned to your case.`);
            } catch (err) {
                console.error("Assign Error:", err);
                await interaction.editReply({ content: `❌ Failed to update channel permissions: \`${err.message}\`` });
            }
        }
    }

    // Handle Ticket Dropdown Creation
    if (interaction.isStringSelectMenu() && interaction.customId === 'cid_ticket_select') {
        const ticketType = interaction.values[0];
        const guild = interaction.guild;
        
        let category = guild.channels.cache.find(c => c.name === "CID CASES" && c.type === ChannelType.GuildCategory);
        if (!category) {
            category = await guild.channels.create({ name: "CID CASES", type: ChannelType.GuildCategory });
        }

        let initialOverwrites = [
            { id: guild.id, type: 0, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, type: 1, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ];
        PERMANENT_CASE_ROLES.forEach(roleId => {
            initialOverwrites.push({ id: roleId, type: 0, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        });

        const channel = await guild.channels.create({
            name: `${interaction.user.username}-${ticketType.replace('ticket_', '')}`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: initialOverwrites
        });

        const insertRes = await pool.query(
            `INSERT INTO cid_records (channel_id, suspect_name, ticket_type, complainant_id) VALUES ($1, $2, $3, $4) RETURNING case_id`,
            [channel.id, 'Pending Identification', ticketType, interaction.user.id]
        );
        const caseId = insertRes.rows[0].case_id;

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`CID Case File #${caseId} —${ticketType.toUpperCase()}`)
            .setDescription(`**Hey ${interaction.user}, thank you for making a CID ticket. A Supervisor / Special Agent in Charge will assign an agent to your case, please wait patiently.**\n\nPlease state your case, name the suspect, and provide accepted video/evidence links (YouTube, Medal, Gyazo). Avoid downloadable or streamable clip links.`)
            .setColor(0x8B0000);

        const controlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('claim_ticket_btn')
                .setLabel('Claim Ticket')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('close_ticket_btn')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('close_noreason_btn')
                .setLabel('Close Without Reason')
                .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ embeds: [ticketEmbed], components: [controlRow] });
        await interaction.reply({ content: `Your ticket has been created: ${channel}`, ephemeral: true });
    }

    // Handle Ticket Action Buttons (Claim, Close, Close Without Reason)
    if (interaction.isButton()) {
        const { customId, channel, user, guild } = interaction;

        if (customId === 'claim_ticket_btn') {
            await interaction.deferReply({ ephemeral: true });

            const dbCheck = await pool.query(`SELECT * FROM cid_records WHERE channel_id = $1`, [channel.id]);
            if (dbCheck.rows.length === 0) {
                return interaction.editReply({ content: "❌ This channel is not registered as an active CID case." });
            }

            const caseData = dbCheck.rows[0];
            const complainantId = String(caseData.complainant_id);

            // Create role formatted as REDACTED#[ID]
            let caseRole = await guild.roles.create({
                name: `REDACTED#${caseData.case_id}`,
                color: 0x8B0000,
                reason: `Claimed investigator role for Case #${caseData.case_id}`
            });

            // Assign role to the claiming user
            const claimingMember = await guild.members.fetch(user.id).catch(() => null);
            if (claimingMember) {
                await claimingMember.roles.add(caseRole).catch(() => {});
            }

            let overwrites = [
                { id: guild.id, type: 0, deny: [PermissionFlagsBits.ViewChannel] },
                { id: complainantId, type: 1, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: caseRole.id, type: 0, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ];

            PERMANENT_CASE_ROLES.forEach(roleId => {
                overwrites.push({ id: roleId, type: 0, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
            });

            try {
                await channel.permissionOverwrites.set(overwrites);
                await pool.query(`UPDATE cid_records SET assigned_agent_id = $1 WHERE channel_id = $2`, [user.id, channel.id]);
                
                await interaction.editReply({ content: `🔒 Ticket successfully claimed by ${user}.` });
                await channel.send(`🔔 Case Update: <@${complainantId}>, <@${user.id}> has claimed/been assigned to your case.`);
            } catch (err) {
                console.error("Claim Error:", err);
                await interaction.editReply({ content: `❌ Failed to claim ticket: \`${err.message}\`` });
            }
        }

        if (customId === 'close_ticket_btn' || customId === 'close_noreason_btn') {
            await interaction.reply({ content: "Closing case file and archiving...", ephemeral: true });
            
            // Cleanup the specific REDACTED#[ID] role matching this case ID
            try {
                const dbCheck = await pool.query(`SELECT case_id FROM cid_records WHERE channel_id = $1`, [channel.id]);
                if (dbCheck.rows.length > 0) {
                    const roleToDelete = guild.roles.cache.find(r => r.name === `REDACTED#${dbCheck.rows[0].case_id}`);
                    if (roleToDelete) await roleToDelete.delete().catch(() => {});
                }
            } catch (e) {
                console.error("Role cleanup error:", e);
            }

            await pool.query(`DELETE FROM cid_records WHERE channel_id = $1`, [channel.id]);
            setTimeout(async () => {
                await channel.delete().catch(() => {});
            }, 1000);
        }
    }
});

// Database Background Check Command (!background <username>)
client.on('messageCreate', async message => {
    if (message.content.startsWith('!background')) {
        const args = message.content.split(' ').slice(1);
        const suspectQuery = args.join(' ');

        if (!suspectQuery) {
            return message.reply("Please specify a suspect username. Usage: `!background <Username>`");
        }

        try {
            const result = await pool.query(
                `SELECT * FROM cid_records WHERE suspect_name ILIKE $1 ORDER BY created_at DESC`,
                [`%${suspectQuery}%`]
            );

            if (result.rows.length === 0) {
                return message.reply(`No prior cases or background records found for **${suspectQuery}**.`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`CID Background Check: ${suspectQuery}`)
                .setColor(0xFFA500)
                .setDescription(`Found **${result.rows.length}** record(s) in the database:`);

            result.rows.forEach(row => {
                embed.add_field(
                    `Case #${row.case_id} [${row.ticket_type}]`,
                    `**Status:** ${row.status}\n**Charges:** ${row.charges}\n**Punishment:** ${row.punishment}\n**Date:** ${new Date(row.created_at).toDateString()}`,
                    false
                );
            });

            await message.reply({ embeds: [embed] });
        } catch (err) {
            console.error("Database search error:", err);
            await message.reply("An error occurred while fetching background records.");
        }
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);