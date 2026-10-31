# Wayfinder Enterprise AI agent (WebSocket chat on /chat, OBO callback on /obo/callback).
# Build context: this directory (ai-agent/).   docker build -t wayfinder-enterprise-agent ai-agent
# Configuration comes from the environment only (see .env.example).

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# tsx (the TypeScript runtime) is a production dependency.
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    AGENT_PORT=8791 \
    AGENT_LOG_FILE=off
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json agent.ts ./
USER node
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.AGENT_PORT||8791)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "agent.ts"]
