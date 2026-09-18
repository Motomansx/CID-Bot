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
        console.log("Database table 'cid_records' is ready.");
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
            )
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

        if (commandName === 'assign') {
            await interaction.deferReply();

            const dbCheck = await pool.query(`SELECT * FROM cid_records WHERE channel_id = $1`, [channel.id]);
            if (dbCheck.rows.length === 0) {
                return interaction.editReply({ content: "This command can only be used inside an active CID case channel." });
            }

            const targetAgent = interaction.options.getUser('agent');
            const caseData = dbCheck.rows[0];

            let overwrites = [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: caseData.complainant_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: targetAgent.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ];

            PERMANENT_CASE_ROLES.forEach(roleId => {
                overwrites.push({
                    id: roleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                });
            });

            await channel.edit({ permissionOverwrites: overwrites });
            await pool.query(`UPDATE cid_records SET assigned_agent_id = $1 WHERE channel_id = $2`, [targetAgent.id, channel.id]);

            await interaction.editReply({ content: `Successfully assigned ${targetAgent} to this case and updated channel permissions.` });
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
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ];
        PERMANENT_CASE_ROLES.forEach(roleId => {
            initialOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
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
            .setTitle(`CID Case File #${caseId} — ${ticketType.toUpperCase()}`)
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
            await interaction.deferReply();
            
            await pool.query(`UPDATE cid_records SET assigned_agent_id = $1 WHERE channel_id = $2`, [user.id, channel.id]);

            let dbCheck = await pool.query(`SELECT complainant_id FROM cid_records WHERE channel_id = $1`, [channel.id]);
            if (dbCheck.rows.length > 0) {
                const complainantId = dbCheck.rows[0].complainant_id;
                let overwrites = [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: complainantId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ];
                PERMANENT_CASE_ROLES.forEach(roleId => {
                    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
                });
                await channel.edit({ permissionOverwrites: overwrites });
            }

            await interaction.editReply({ content: `🔒 Ticket successfully claimed by ${user}.` });
        }

        if (customId === 'close_ticket_btn') {
            await interaction.reply({ content: "Closing case file and archiving...", ephemeral: true });
            await pool.query(`DELETE FROM cid_records WHERE channel_id = $1`, [channel.id]);
            setTimeout(async () => {
                await channel.delete().catch(() => {});
            }, 2000);
        }

        if (customId === 'close_noreason_btn') {
            await interaction.reply({ content: "Closing ticket without reason...", ephemeral: true });
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