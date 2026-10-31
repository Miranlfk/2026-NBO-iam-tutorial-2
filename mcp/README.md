# Wayfinder Enterprise MCP Server

This server exposes B2B sample app capabilities as MCP tools for the AI agent.

## Tools

- `get_travel_policy`: Reads the active organization travel policy.
- `get_current_access_context`: Reads the current authenticated subject, actor, roles, organization, and scopes from the access token.
- `update_travel_policy`: Updates selected travel policy fields.
- `list_organization_users`: Lists organization users.
- `invite_organization_user`: Invites an employee.
- `list_organization_roles`: Lists roles and user assignments.
- `search_enterprise_flights`: Searches available flight options from the Wayfinder booking database.
- `list_flight_bookings`: Lists flight bookings visible to the authenticated user.
- `create_flight_booking`: Creates a flight booking for the authenticated user.

## Local Setup

```bash
cd mcp
npm install
cp .env.example .env
npm run dev
```

The default endpoint is:

```text
http://localhost:8001/mcp
```

The AI agent forwards its Asgardeo agent token to this server. The MCP server verifies that token itself (signature, org_id, scopes) and calls the webapp's service functions (DB queries, Asgardeo SCIM client) directly, instead of going through the Next.js API routes over REST.

## Container Image

The server imports `../webapp/app/lib`, so the image builds from the repository root:

```bash
docker build -f mcp/Dockerfile -t wayfinder-enterprise-mcp .
```

It is configured from the environment only (`ASGARDEO_BASE_URL`, `DB_PATH`, see `.env.example`), listens on port 8001, and answers `GET /health`. Mount the webapp's SQLite volume at `/data`. See [../deploy/README.md](../deploy/README.md).
