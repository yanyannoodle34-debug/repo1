#!/data/data/com.termux/files/usr/bin/bash
set -e

# Guard: must be on Termux native filesystem (ext4), not Android shared storage (FAT)
if [[ "$PWD" == /storage/* || "$PWD" == /sdcard/* ]]; then
  echo ""
  echo "ERROR: Project is on Android shared storage (FAT filesystem)."
  echo "FAT does not support symlinks — npm install fails with EACCES."
  echo ""
  echo "Move the project to Termux home first, then re-run:"
  echo "  cp -r \"$PWD\" ~/repo1"
  echo "  cd ~/repo1"
  echo "  bash termux-setup.sh"
  echo ""
  exit 1
fi

echo "[1/4] Updating packages…"
pkg update -y && pkg upgrade -y
pkg install -y nodejs python git

echo "[2/4] Creating data directories…"
mkdir -p ~/.tbr/storage ~/.termux/boot

echo "[3/4] Copying environment template…"
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  ⚠  Edit .env before continuing:"
  echo "     ADMIN_PASSWORD, SESSION_SECRET, BOT_TOKEN_ENCRYPTION_KEY"
  echo ""
  echo "  Run: nano .env"
  echo ""
fi

echo "[4/4] Creating Termux:Boot auto-start script…"
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
