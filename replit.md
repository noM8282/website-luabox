# ScriptHub (LuaBox)

A script management platform with a React dashboard and Discord bot. Users log in via Discord OAuth, manage scripts/panels/keys/servers, and interact via Discord slash commands.

## Stack

- **Dashboard** — React + Vite + Tailwind + shadcn/ui (`artifacts/dashboard`)
- **API server** — Express + Drizzle ORM + PostgreSQL (`artifacts/api-server`)
- **Discord bot** — discord.js v14 (`artifacts/discord-bot`)
- **Shared DB layer** — Drizzle schema + migrations (`lib/db`)
- **API contract** — OpenAPI spec + Zod types + React Query client (`lib/api-spec`, `lib/api-zod`, `lib/api-client-react`)

## Running

| Service | Workflow |
|---------|----------|
| API server | `artifacts/api-server: API Server` |
| Dashboard | `artifacts/dashboard: web` |
| Discord bot | `Discord Bot` |

All three should be running for full functionality.

## Environment variables / secrets required

| Key | Notes |
|-----|-------|
| `SESSION_SECRET` | Express session secret |
| `DISCORD_BOT_TOKEN` | From Discord Developer Portal → Bot |
| `DISCORD_CLIENT_ID` | From Discord Developer Portal → OAuth2 |
| `DISCORD_CLIENT_SECRET` | From Discord Developer Portal → OAuth2 |
| `DATABASE_URL` / `PG*` | Auto-provisioned by Replit |

`DISCORD_REDIRECT_URI` is optional — it auto-derives from `REPLIT_DEV_DOMAIN` if unset.

## DB schema

Push schema changes to the dev database:

```bash
pnpm --filter @workspace/db run push
```

## Discord OAuth setup

After deploying, add the production redirect URI to your Discord app's OAuth2 Redirect URLs:
`https://<your-domain>/api/auth/discord/callback`

## User preferences

- Keep existing monorepo structure (pnpm workspaces)
