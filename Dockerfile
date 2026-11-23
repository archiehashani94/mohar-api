# Mohar/Kavach API (Hono) for Render (Docker).
# Bundles gitignored runtime artifacts committed to the deploy repo:
# contracts/deployments/84532.json, the 7 contract ABIs, server/data IPFS blobs, test fixtures.
# Role keys are NOT in the image — passed via the ROLE_KEYS_JSON secret env var.
FROM node:22-slim
# pnpm (matches the lockfile) + a global tsx that ships its own esbuild (robust on Linux).
RUN npm install -g pnpm@latest tsx
WORKDIR /app
COPY . .
# --ignore-scripts avoids pnpm 10+'s ERR_PNPM_IGNORED_BUILDS; the server only needs
# pure-JS deps (hono, ethers, multiformats), so skipping native build scripts is fine.
RUN pnpm install --no-frozen-lockfile --ignore-scripts
ENV CHAIN_ID=84532
ENV RPC_URL=https://sepolia.base.org
# Role keys are baked in (testnet-only throwaway keys — rotate after the demo). No env var needed.
ENV ROLE_KEYS=/app/deploy-keys.json
# Render injects $PORT; the server reads process.env.PORT (defaults to 8787).
CMD ["sh","-c","exec tsx /app/server/src/index.ts"]
