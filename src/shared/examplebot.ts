export const exampleBotPy = `import os
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Hello from Telegram Bot Runner!")

app = Application.builder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.run_polling()
`;

export const exampleRequirements = `python-telegram-bot==21.10
`;

export const exampleBotNotes = [
  "Read the token from TELEGRAM_BOT_TOKEN instead of hard-coding it.",
  "Keep your entry file small and start the bot from the bottom of the file.",
  "Pin dependencies in requirements.txt so deployments are repeatable.",
];

export const botFormatRows = [
  { label: "Python file", value: "bot.py", detail: "One .py entry file" },
  { label: "Dependencies", value: "requirements.txt", detail: "One package per line" },
  { label: "Token", value: "Telegram token", detail: "Entered securely during upload" },
];
