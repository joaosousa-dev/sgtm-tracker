# sGTM + Tracker — infra de tracking server-side

Stack self-hosted na VPS (`~/sgtm`) que roda o GTM Server, o servidor de preview, o Redis (banco do `sck`) e o `tracker` (micro-serviço Node que captura identidade e dispara o Purchase pro Meta CAPI).

Arquitetura completa: ver `decisions/` / `arquitetura-tracking.md` no vault.

## Containers (docker-compose)
- **caddy** — reverse proxy + SSL (Let's Encrypt) + roteamento por path
- **sgtm** — GTM Server (tagging) → GA4
- **sgtm-preview** — servidor de preview/debug (exposto em `serverpreview.<dominio>`)
- **redis** — banco do `sck` (teto 1GB, TTL 45 dias)
- **tracker** — Node: `/sck` (captura) · `/webhook/kiwify` (Purchase CAPI) · `/tracker-health`

## Subir do zero
```bash
cp .env.example .env   # e preencha CONTAINER_CONFIG + CAPI_TOKEN
docker compose up -d --build
```

## DNS necessário (Cloudflare, DNS-only)
- `server.<dominio>` → IP da VPS
- `serverpreview.<dominio>` → IP da VPS (preview do GTM Server)

## Operação
```bash
docker compose ps                          # status
docker compose logs tracker -f --tail 30   # webhook / CAPI
docker compose logs sgtm -f                # eventos no GTM Server
docker compose up -d --build               # rebuild
docker compose restart caddy               # recarrega o Caddyfile
curl -s https://server.<dominio>/tracker-health
```

## Deploy de mudança no tracker
Edite `tracker/server.js` → `docker compose up -d --build tracker`.

> Segredos (`CONTAINER_CONFIG`, `CAPI_TOKEN`) vivem só no `.env` — fora do git.
