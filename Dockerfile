# Mohar/Kavach API (Hono) for Render (Docker).
# Bundles gitignored runtime artifacts committed to the deploy repo:
# contracts/deployments/84532.json, the 7 contract ABIs, server/data IPFS blobs, test fixtures.
# Role keys are NOT in the image — passed via the ROLE_KEYS_JSON secret env var.
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --no-frozen-lockfile
ENV CHAIN_ID=84532
ENV RPC_URL=https://sepolia.base.org
# Render injects $PORT; the server reads it (defaults to 8787 locally).
CMD ["sh","-c","printf '%s' \"$ROLE_KEYS_JSON\" > /tmp/keys.json && ROLE_KEYS=/tmp/keys.json exec npx tsx server/src/index.ts"]
