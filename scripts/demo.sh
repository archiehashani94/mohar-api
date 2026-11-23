#!/usr/bin/env bash
# One command: fresh local chain → deploy → seed → API → web app.
#   ./scripts/demo.sh            (Ctrl-C stops everything)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.nargo/bin:$HOME/.foundry/bin:$PATH"
LOGS="$ROOT/.logs"; mkdir -p "$LOGS"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

echo "▸ circuit"
( cd "$ROOT/circuits/claim" && nargo compile >/dev/null )
node "$ROOT/sdk/scripts/export-abis.mjs" >/dev/null

echo "▸ anvil"
pkill -f "anvil --port 8545" 2>/dev/null || true
# stale API / web servers from an earlier run would shadow the fresh ones (EADDRINUSE)
for port in 8787 5173; do fuser -k "$port/tcp" >/dev/null 2>&1 || true; done
pkill -f "vite --port 5173" 2>/dev/null || true; pkill -f "tsx src/index.ts" 2>/dev/null || true; sleep 0.5
anvil --port 8545 --chain-id 31337 --accounts 12 --block-time 1 --silent > "$LOGS/anvil.log" 2>&1 & PIDS+=($!)
for i in {1..30}; do cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1 && break; sleep 0.3; done

echo "▸ deploy"
( cd "$ROOT/contracts" && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 > "$LOGS/deploy.log" 2>&1 )
node "$ROOT/sdk/scripts/export-abis.mjs" >/dev/null

echo "▸ seed"
rm -rf "$ROOT/server/data"
( cd "$ROOT/sdk" && npx tsx scripts/seed.ts | tail -1 )

echo "▸ api :8787"
( cd "$ROOT/server" && npx tsx src/index.ts > "$LOGS/api.log" 2>&1 ) & PIDS+=($!)

echo "▸ web :5173"
( cd "$ROOT/app" && npx vite --port 5173 --host > "$LOGS/web.log" 2>&1 ) & PIDS+=($!)
sleep 3
echo
PROTO=http; [ -n "${HTTPS:-}" ] && PROTO=https
echo "  Mohar is running →  $PROTO://localhost:5173"
LAN=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$LAN" ] && echo "  on your Wi-Fi     →  $PROTO://$LAN:5173   (phones: run with HTTPS=1 for camera + WebCrypto)"
echo "  (logs in .logs/ · Ctrl-C to stop)"
wait
