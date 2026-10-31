# Wayfinder Enterprise webapp (Next.js standalone server).
# Build context: this directory (webapp/).   docker build -t wayfinder-enterprise-webapp webapp
#
# Nothing domain- or tenant-specific is baked in: browser-visible settings (NEXT_PUBLIC_*)
# are read at runtime (app/lib/config/public.ts), so one image serves any domain.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# better-sqlite3 downloads a prebuilt binary; the toolchain is the fallback if none matches.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_PATH=/data/app.db
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Read at runtime relative to the working directory (app/lib/db/connection.ts, the seed script).
COPY --from=build --chown=node:node /app/app/lib/db/schema.sql ./app/lib/db/schema.sql
COPY --from=build --chown=node:node /app/scripts/seed-flights.js ./scripts/seed-flights.js
# /data is the SQLite volume shared with the MCP server; a new named volume inherits this owner.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Seeding is idempotent (it exits when flights exist); SEED_FLIGHTS=false skips it.
CMD ["sh", "-c", "if [ \"${SEED_FLIGHTS:-true}\" != \"false\" ]; then node scripts/seed-flights.js; fi && exec node server.js"]
