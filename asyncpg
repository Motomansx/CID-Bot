import os
import asyncpg
import discord
from discord.ext import commands

class CIDBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        super().__init__(command_prefix="!", intents=intents)
        self.db = None

    async def setup_hook(self):
        # Connect to Railway PostgreSQL database on startup
        database_url = os.getenv("DATABASE_URL")
        if database_url:
            self.db = await asyncpg.create_pool(database_url)
            print("Connected to PostgreSQL database successfully!")
            
            # Create table if it doesn't exist
            async with self.db.acquire() as connection:
                await connection.execute("""
                    CREATE TABLE IF NOT EXISTS cid_cases (
                        case_id SERIAL PRIMARY KEY,
                        channel_id BIGINT UNIQUE NOT NULL,
                        creator_id BIGINT NOT NULL,
                        status TEXT DEFAULT 'Open',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)

bot = CIDBot()

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} (ID: {bot.user.id})")

# Run the bot using your Railway environment variable for the token
bot.run(os.getenv("DISCORD_BOT_TOKEN"))