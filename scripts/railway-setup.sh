#!/usr/bin/env bash
# One-time Railway setup helper (run after GitHub repo is connected)

set -e

echo "=== Freeflow Bot — Railway Deploy ==="
echo ""
echo "Required env vars in Railway dashboard:"
echo "  BOT_TOKEN"
echo "  ADMIN_CHAT_ID=2146420996"
echo "  SUPPORT_HANDLE=phoenixx_0"
echo "  DB_PATH=/data/bot.db"
echo ""
echo "Required Railway settings:"
echo "  1. Service type: Worker (not Web)"
echo "  2. Volume mounted at: /data"
echo "  3. Connect GitHub repo for auto-deploy on push"
echo ""
