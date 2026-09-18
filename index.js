const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { Pool } = require('pg');
require('dotenv').config();

// Connect to Railway PostgreSQL database
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

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Ensure the database table exists on startup
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cid_records (
                case_id SERIAL PRIMARY KEY,
                channel_id BIGINT UNIQUE NOT NULL,
                suspect_name TEXT NOT NULL,
                ticket_type TEXT NOT NULL,
                complainant_id BIGINT NOT NULL,
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
});

// 1. Send the CID Ticket Panel Command (!cidpanel)
client.on('messageCreate', async message => {
    if (message.content === '!cidpanel' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
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
            .setFooter({ text: "Signed, BGEN. VendettaPyrex | Director of Criminal Investigations" });

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
        
        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete().catch(() => {});
    }
});

// 2. Handle Dropdown Menu Selection (Ticket Creation)
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId === 'cid_ticket_select') {
        const ticketType = interaction.values[0];
        const guild = interaction.guild;
        
        // Find or create category
        let category = guild.channels.cache.find(c => c.name === "CID CASES" && c.type === ChannelType.GuildCategory);
        if (!category) {
            category = await guild.channels.create({ name: "CID CASES", type: ChannelType.GuildCategory });
        }

        // Create the private channel
        const channel = await guild.channels.create({
            name: `${interaction.user.username}-${ticketType.replace('ticket_', '')}`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ]
        });

        // Insert case into PostgreSQL database
        await pool.query(
            `INSERT INTO cid_records (channel_id, suspect_name, ticket_type, complainant_id) VALUES ($1, $2, $3, $4)`,
            [channel.id, 'Pending Identification', ticketType, interaction.user.id]
        );

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`CID Case File — ${ticketType.toUpperCase()}`)
            .setDescription("Please state your case, name the suspect, and provide accepted video/evidence links (YouTube, Medal, Gyazo). Avoid downloadable or streamable clip links.")
            .setColor(0x8B0000);

        await channel.send({ content: `${interaction.user} Here is your case file channel.`, embeds: [ticketEmbed] });
        await interaction.reply({ content: `Your ticket has been created: ${channel}`, ephemeral: true });
    }
});

// 3. Database Background Check Command (!background <username>)
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