const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Command to send the CID Ticket Panel
client.on('messageCreate', async message => {
    if (message.content === '!cidpanel' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const embed = new EmbedBuilder()
            .setTitle("CRIMINAL INVESTIGATION DIVISION")
            .setDescription("Welcome to the Criminal Investigation Division's ticket system. Before opening a ticket, please select your report category from the dropdown below.")
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

        const row = new ActionRowBuilder().addcomponents(selectMenu);
        await message.channel.send({ embeds: [embed], components: [row] });
        await message.delete();
    }
});