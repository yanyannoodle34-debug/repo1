#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "[1/5] Updating packages…"
pkg update -y && pkg upgrade -y
pkg install -y nodejs python git

echo "[2/5] Installing Python Telegram Bot library…"
pip install python-telegram-bot

echo "[3/5] Creating data directories…"
mkdir -p ~/.tbr/storage ~/.termux/boot

echo "[4/5] Copying environment template…"
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  ⚠  Edit .env before continuing:"
  echo "     ADMIN_PASSWORD, SESSION_SECRET, BOT_TOKEN_ENCRYPTION_KEY"
  echo ""
  echo "  Run: nano .env"
  echo ""
fi

echo "[5/5] Creating Termux:Boot auto-start script…"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cat > ~/.termux/boot/start-tbr.sh <<EOF
#!/data/data/com.termux/files/usr/bin/bash
cd "$SCRIPT_DIR"
NODE_ENV=production npm start >> ~/.tbr/server.log 2>&1
EOF
chmod +x ~/.termux/boot/start-tbr.sh

echo ""
echo "Setup complete. Next steps:"
echo "  1. nano .env          (set your secrets)"
echo "  2. npm install        (install dependencies)"
echo "  3. npm run db:push    (create database schema)"
echo "  4. npm run build      (build web dashboard)"
echo "  5. NODE_ENV=production npm start"
echo "     → open http://localhost:3000 in your browser"
