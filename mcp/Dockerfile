# Wayfinder Enterprise MCP server.
# Build context: the REPOSITORY ROOT, because the server imports the webapp's DB and auth
# modules (webapp/app/lib) at runtime:
#   docker build -f mcp/Dockerfile -t wayfinder-enterprise-mcp .
#
# The image mirrors the repository layout (/app/mcp next to /app/webapp) so those relative
# imports resolve, and gives the webapp files the MCP server's node_modules (better-sqlite3).
# Configuration comes from the environment only.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app/mcp
# better-sqlite3 downloads a prebuilt binary; the toolchain is the fallback if none matches.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY mcp/package.json mcp/package-lock.json ./
# tsx (the TypeScript runtime) is a production dependency.
RUN npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    MCP_PORT=8001 \
    DB_PATH=/data/app.db
WORKDIR /app
COPY --from=deps /app/mcp/node_modules mcp/node_modules
COPY mcp/package.json mcp/tsconfig.json mcp/server.ts mcp/logger.ts mcp/
# Only the webapp modules the server imports, plus package.json for "type": "module".
COPY webapp/package.json webapp/package.json
COPY webapp/app/lib/auth/agents.ts webapp/app/lib/auth/utils.ts webapp/app/lib/auth/
COPY webapp/app/lib/config/public.ts webapp/app/lib/config/
COPY webapp/app/lib/db webapp/app/lib/db
# /data is the SQLite volume shared with the webapp; a new named volume inherits this owner.
RUN ln -s ../mcp/node_modules webapp/node_modules \
    && mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/mcp
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||8001)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "server.ts"]
