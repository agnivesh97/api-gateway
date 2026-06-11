# 🙏 TiwariJi API Gateway

A lightweight API gateway with a web dashboard for routing to multiple backend services — with authentication, HTML path rewriting for UI apps, and live route management.

## Quick Start

```bash
docker compose up --build
```

Open **http://localhost:8081** in your browser.

## Features

- 🔁 Route requests to any backend service (Docker or host)
- 🔐 Session-based authentication (login / logout)
- 🖥️ Web dashboard to view/manage routes
- ➕ Add/remove/enable/disable routes live (no restart)
- 🔗 **Open button** — one-click open route in new tab
- 🖼️ **HTML path rewriting** — proxy UI apps behind a sub-path (fixes CSS/JS/assets)
- 📋 Real-time request log
- ✅ Health monitoring
- 🐳 Docker Compose with `host.docker.internal` support for host services

## Pre-configured Routes

| Path | Target | Service | Rewrite |
|------|--------|---------|---------|
| `/api/users` | `service-a:3001` | Users API | No |
| `/api/orders` | `service-b:3002` | Orders API | No |
| `/pdf` | `host.docker.internal:8089` | Stirling PDF | **Yes** |

## Add Your Own Service

### For API routes (JSON endpoints)
1. Start your service anywhere (Docker or local)
2. Open the dashboard → Add Route
3. Set Path (e.g. `/api/books`), Target (e.g. `http://service-c:3003`)
4. Leave **Rewrite HTML** unchecked
5. Save — it works immediately

### For UI apps (HTML with CSS/JS/assets)
1. Start your UI app on the host (e.g., `http://localhost:4000`)
2. Open the dashboard → Add Route
3. Set Path (e.g. `/my-app`), Target (e.g. `http://host.docker.internal:4000`)
4. **Enable "Rewrite HTML asset paths"** ✅
5. Save — the gateway rewrites asset paths so all CSS/JS/images load correctly

## Management APIs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/__gw/login` | No | Login with username/password |
| POST | `/__gw/logout` | Yes | Destroy session |
| GET | `/__gw/me` | Yes | Current user info |
| GET | `/__gw/routes` | Yes | List all routes |
| POST | `/__gw/routes` | Yes | Add/update a route |
| DELETE | `/__gw/routes/:path` | Yes | Delete a route |
| PATCH | `/__gw/routes/:path/toggle` | Yes | Enable/disable a route |
| GET | `/__gw/log` | Yes | Request history |
| GET | `/__gw/health` | Yes | Gateway health |

## Architecture

```
Browser → Gateway (port 8080)
            ├── Auth guard (session check)
            ├── Static dashboard (protected)
            ├── Management API /__gw/
            └── Proxy routes
                  ├── /api/* → Docker services
                  └── /pdf  → host.docker.internal:8089 (with HTML rewrite)
```

## Port Mapping

| Port | Service |
|------|---------|
| 8081 | Gateway (host) → 8080 (container) |
| — | service-a (internal) |
| — | service-b (internal) |
