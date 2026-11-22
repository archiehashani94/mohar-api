#!/usr/bin/env bash
# Deploy Kavach to Base Sepolia (chain 84532) and seed it.
#   DEPLOYER_KEY=0x… ./scripts/deploy-testnet.sh
# Needs ~0.05 Base Sepolia ETH on the deployer (faucets: https://docs.base.org/chain/network-faucets).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export RPC_URL="${RPC_URL:-https://sepolia.base.org}" CHAIN_ID=84532
: "${DEPLOYER_KEY:?set DEPLOYER_KEY to a funded Base Sepolia key}"
KEYS="$ROOT/.testnet-keys.json"
if [ ! -f "$KEYS" ]; then
  node -e "const {Wallet}=require('$ROOT/sdk/node_modules/ethers');console.log(JSON.stringify(Array.from({length:10},()=>Wallet.createRandom().privateKey)))" > "$KEYS"
  chmod 600 "$KEYS"
fi
export ROLE_KEYS="$KEYS"
DEPLOYER_ADDR=$(cast wallet address --private-key "$DEPLOYER_KEY")
echo "▸ funding role accounts from $DEPLOYER_ADDR"
for k in $(node -e "for (const k of require('$KEYS')) console.log(k)"); do
  a=$(cast wallet address --private-key "$k")
  bal=$(cast balance "$a" --rpc-url "$RPC_URL")
  [ "$bal" -lt 3000000000000000 ] && cast send "$a" --value 0.004ether --private-key "$DEPLOYER_KEY" --rpc-url "$RPC_URL" >/dev/null && echo "  funded $a"
done
echo "▸ deploy (regulator = role 0)"
REG_KEY=$(node -e "console.log(require('$KEYS')[0])")
( cd "$ROOT/contracts" && forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --private-key "$REG_KEY" --slow )
node "$ROOT/sdk/scripts/export-abis.mjs"
echo "▸ seed"
( cd "$ROOT/sdk" && PUBLIC_RPC_URL="$RPC_URL" npx tsx scripts/seed.ts )
echo "✓ deployed: $(cat "$ROOT/contracts/deployments/84532.json")"
echo "  run the app against it:  RPC_URL=$RPC_URL CHAIN_ID=84532 ROLE_KEYS=$KEYS (server + app)"
