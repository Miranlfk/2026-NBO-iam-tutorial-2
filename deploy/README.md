# Deploying Wayfinder Enterprise with Docker Compose

`compose.yaml` runs the three components on one Docker host behind a TLS-terminating reverse proxy (Caddy below).
The images contain nothing environment-specific: the apps domain, the identity provider and the LLM endpoint come
from `.env` and `env/*.env` at runtime, so the same images serve any domain.

| Service | Build context | Dockerfile | Container port | Health | Published on the host |
|---|---|---|---|---|---|
| `enterprise-webapp` | `webapp/` | `webapp/Dockerfile` | 3000 | `GET /api/health` | `127.0.0.1:${ENTERPRISE_WEBAPP_PORT:-3100}` |
| `enterprise-mcp` | repository root (imports `webapp/app/lib`) | `mcp/Dockerfile` | 8001 | `GET /health` | none (internal) |
| `enterprise-agent` | `ai-agent/` | `ai-agent/Dockerfile` | 8791 | `GET /health` | `127.0.0.1:${ENTERPRISE_AGENT_PORT:-8791}` |

`enterprise-webapp` and `enterprise-mcp` share the SQLite database on the `enterprise-data` volume (`/data/app.db`,
WAL mode). The webapp creates the schema and seeds the flight catalog on start; both are idempotent.

## Hostnames and proxy routes

| Public hostname | Upstream | Paths |
|---|---|---|
| `enterprise.<APPS_DOMAIN>` | `enterprise-webapp:3000` | everything (`/`, `/_next/*`, `/api/*`) |
| `enterprise-agent.<APPS_DOMAIN>` | `enterprise-agent:8791` | `/chat`: **WebSocket** (`wss://`), the browser sends the user's token as the subprotocol `bearer, <token>` and the agent answers `Sec-WebSocket-Protocol: bearer`<br>`/obo/callback`: browser redirect from the identity provider after delegated consent<br>`/obo/authorize-url`: cross-origin `POST` (and `OPTIONS` preflight) from `https://enterprise.<APPS_DOMAIN>`<br>`/health` |

The MCP server is reached only by the agent, as `http://enterprise-mcp:8001/mcp`; do not route it publicly.

Caddy proxies WebSocket upgrades without extra configuration. With Caddy in a container (upstreams by service name):

```caddyfile
enterprise.{$APPS_DOMAIN} {
	reverse_proxy enterprise-webapp:3000
}

enterprise-agent.{$APPS_DOMAIN} {
	# /chat is a long-lived WebSocket; keep it open across Caddy config reloads.
	reverse_proxy enterprise-agent:8791 {
		stream_close_delay 5m
	}
}
```

The Caddy container must join this project's network, whose name is fixed (`ENTERPRISE_NETWORK`, default
`wayfinder-enterprise`). In Caddy's own Compose file:

```yaml
services:
  caddy:
    networks: [default, wayfinder-enterprise]
networks:
  wayfinder-enterprise:
    external: true
```

With Caddy on the host instead, use `reverse_proxy 127.0.0.1:3100` and `reverse_proxy 127.0.0.1:8791`.

## Configure

```bash
cd deploy
cp .env.example .env                 # APPS_DOMAIN, ASGARDEO_BASE_URL, LLM_BASE_URL, host ports
for s in webapp mcp agent; do cp env/enterprise-$s.env.example env/enterprise-$s.env; done
```

- `.env` holds the values Compose interpolates. Every URL is derived from it in `compose.yaml` (and wins over the env
  files): `NEXT_PUBLIC_BASE_URL`, the sign-in/out redirect URLs, the agent's WebSocket URL, `REDIRECT_URI`,
  `OBO_REDIRECT_URI`, `APP_BASE_URL`, `MCP_SERVER_URL`, `LLM_BASE_URL`, `LLM_TOKEN_URL`.
- `env/enterprise-<service>.env` holds credentials, IDs, scopes, role names and feature settings. Each example lists
  every variable the service reads, including the ones Compose sets. The real files are git-ignored.
- Compose interpolates `$` in unquoted and double-quoted values: single-quote secrets that contain `$`.

The AI agent uses `MODEL_PROVIDER=openai-compatible`: OpenAI chat completions at `LLM_BASE_URL` (WSO2 API Manager's AI
gateway), authorized with a client-credentials token from `LLM_TOKEN_URL` (default
`<ASGARDEO_BASE_URL>/oauth2/token`) for `LLM_CLIENT_ID`/`LLM_CLIENT_SECRET`, cached and refreshed before expiry.

## Build and run

```bash
docker compose build enterprise-webapp   # one at a time on small hosts: the Next.js build is the heaviest
docker compose build enterprise-mcp
docker compose build enterprise-agent
docker compose up -d
docker compose ps                        # all three should become healthy
docker compose logs -f enterprise-agent
```

The agent signs in to the identity provider at start-up and exits if it cannot (wrong credentials, host not
reachable); Compose restarts it, and `/health` answers only once it is signed in.

## Changing the domain

Edit `APPS_DOMAIN` in `.env` and run `docker compose up -d` (containers are recreated with the new values; no rebuild).
Update the identity provider to match: the application's redirect URLs and allowed origins below.

## Identity provider settings that depend on the hostnames

On the root organization's application (the one `NEXT_PUBLIC_CLIENT_ID` and the agent's `CLIENT_ID` name):

- Authorized redirect URLs: `https://enterprise.<APPS_DOMAIN>` (sign-in, impersonation and post-logout redirect),
  `https://enterprise-agent.<APPS_DOMAIN>` (the agent's own sign-in), `https://enterprise-agent.<APPS_DOMAIN>/obo/callback`.
- Allowed origins: `https://enterprise.<APPS_DOMAIN>`, `https://enterprise-agent.<APPS_DOMAIN>`.

The rest of the tenant setup (application grants, API resources, roles, agent, MCP server) is in the repository's
main [README](../README.md).

## Data

The database lives in the `wayfinder-enterprise_enterprise-data` volume. To back it up consistently, copy it with
SQLite's online backup, for example
`docker compose exec enterprise-webapp node -e "new (require('better-sqlite3'))('/data/app.db').backup('/data/backup.db')"`,
then copy `/data/backup.db` out with `docker compose cp`. `docker compose down -v` deletes it.
