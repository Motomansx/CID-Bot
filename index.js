const { Client, GatewayIntentBits } = require('discord.js');
const { Pool } = require('pg');
require('dotenv').config();

// Connect to Railway PostgreSQL database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for external/Railway cloud Postgres connections
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

    // Create the cases table on startup if it doesn't exist
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cid_cases (
                case_id SERIAL PRIMARY KEY,
                channel_id BIGINT UNIQUE NOT NULL,
                creator_id BIGINT NOT NULL,
                status TEXT DEFAULT 'Open',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Connected to PostgreSQL & verified database table.");
    } catch (err) {
        console.error("Database setup error:", err);
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);