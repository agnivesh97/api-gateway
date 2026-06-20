# TiwariJi API Gateway — Project Plan

## Phase 1 ✅ Complete

### Milestone 1: Core Gateway
- [x] Express gateway with dynamic proxy routing
- [x] Web dashboard (route management, request log, health check)
- [x] 2 demo microservices (Users API, Orders API)
- [x] Docker Compose orchestration
- [x] Live route add/remove/toggle via REST APIs

### Milestone 2: Authentication
- [x] Session-based login (`agnivesh` / `London@97`)
- [x] Login page (`/login.html`) with dark theme
- [x] Auth guard protecting dashboard + management API
- [x] Logout button in navbar
- [x] Client-side 401 handling (auto-redirect)

### Milestone 3: UI App Proxy
- [x] HTML path rewriting for proxied UI apps
- [x] `rewriteHtml` toggle per route in dashboard
- [x] `<base>` tag injection for JS-generated paths
- [x] `host.docker.internal` support for host services
- [x] Stirling PDF proxied via `/pdf`

### Architecture
```
Browser → Gateway (port 8080/8081)
            ├── Session middleware
            ├── Auth guard (requireAuth)
            ├── Static dashboard (protected)
            ├── Management API /__gw/
            ├── Proxy: API routes (pathRewrite, no HTML rewrite)
            └── Proxy: UI routes (pathRewrite + responseInterceptor + base tag)
```

---

## Phase 2: Service Registry + Config Store + Container Mgmt 🚧

### Problem Statement

Currently every API endpoint needs its own route entry. The photo organizer app requires **9 separate route entries** (`/api/reprocess`, `/api/folders`, `/api/process`, `/api/clusters`, `/api/stats`, `/api/file`, `/api/finalize`, `/api/drive`, `/photos`) all pointing to `http://photo-organizer:3000`. Adding new endpoints means manual route config.

Additionally, services like the photo organizer need configuration (Google OAuth tokens, DB credentials) that should be managed centrally through the gateway at runtime.

### Phase 2 Goals

1. **Service Registry** — Register a service once with a prefix, all sub-paths auto-forward
2. **Encrypted Config Store** — Store service configs (tokens, DB creds, API keys) securely in the gateway
3. **Container Lifecycle Mgmt** — Restart/stop/start services from the dashboard
4. **Runtime Config Injection** — Configs injected into proxied requests (headers) or served via a config API
5. **Client Integration Guide** — How services register, receive configs, report health

---

### Architecture (Phase 2)

```
┌─────────────────────────────────────────────────┐
│              TiwariJi Gateway v2                │
│                                                 │
│  Browser ──▶ Auth Guard ──▶ Proxy Router        │
│                                  │              │
│           ┌──────────────────────┴──────────┐   │
│           │    Service Registry            │   │
│           │  ┌─ photo-organizer ─┐         │   │
│           │  │  prefix: /photos  │         │   │
│           │  │  target: http://  │         │   │
│           │  │  photo:3000       │         │   │
│           │  │  config: {...}    │         │   │
│           │  │  docker: photo-   │         │   │
│           │  │  organizer        │         │   │
│           │  └───────────────────┘         │   │
│           │  ┌─ my-service ─────┐          │   │
│           │  │  prefix: /my     │          │   │
│           │  │  ...             │          │   │
│           │  └───────────────────┘         │   │
│           └────────────────────────────────┘   │
│                                                 │
│  Config Store (SQLite + AES-256)                │
│  Docker Socket (restart/status)                 │
└─────────────────────────────────────────────────┘
```

### Database Schema (New: `gateway.db`)

```sql
CREATE TABLE services (
  id            TEXT PRIMARY KEY,           -- UUID
  name          TEXT UNIQUE NOT NULL,       -- e.g. "photo-organizer"
  prefix        TEXT UNIQUE NOT NULL,       -- e.g. "/photos"
  target        TEXT NOT NULL,              -- e.g. "http://photo-organizer:3000"
  docker_service TEXT,                      -- e.g. "photo-organizer" (for restart)
  rewrite_html  INTEGER DEFAULT 0,
  preserve_path INTEGER DEFAULT 0,
  enabled       INTEGER DEFAULT 1,
  description   TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE configs (
  id            TEXT PRIMARY KEY,
  service_id    TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,              -- e.g. "google_token", "db_password"
  value         TEXT NOT NULL,              -- AES-256 encrypted
  is_secret     INTEGER DEFAULT 1,          -- hidden in UI, encrypted at rest
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(service_id, key)
);

CREATE TABLE request_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT DEFAULT (datetime('now')),
  method        TEXT,
  path          TEXT,
  target        TEXT,
  status        INTEGER,
  service_id    TEXT REFERENCES services(id),
  duration_ms   INTEGER
);
```

### API Design (New Gateway Endpoints)

#### Service Management (`/__gw/services/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/__gw/services` | List all registered services |
| `POST` | `/__gw/services` | Register a new service |
| `GET` | `/__gw/services/:id` | Get service details + config keys |
| `PUT` | `/__gw/services/:id` | Update service config |
| `DELETE` | `/__gw/services/:id` | Unregister a service |
| `PATCH` | `/__gw/services/:id/toggle` | Enable/disable a service |

**POST `/__gw/services` body:**
```json
{
  "name": "photo-organizer",
  "prefix": "/photos",
  "target": "http://photo-organizer:3000",
  "docker_service": "photo-organizer",
  "rewrite_html": true,
  "preserve_path": false,
  "description": "Google Drive Photo Organizer"
}
```

#### Config Management (`/__gw/services/:id/config/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/__gw/services/:id/config` | List config keys (values masked) |
| `PUT` | `/__gw/services/:id/config` | Bulk set configs |
| `GET` | `/__gw/services/:id/config/:key` | Get a single config (value masked) |
| `DELETE` | `/__gw/services/:id/config/:key` | Remove a config key |

**PUT `/__gw/services/:id/config` body:**
```json
{
  "configs": {
    "GOOGLE_CLIENT_ID": "xxx.apps.googleusercontent.com",
    "GOOGLE_CLIENT_SECRET": "secret-here",
    "DB_URL": "file:/app/data.db"
  }
}
```

#### Container Management (`/__gw/services/:id/container/*`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/__gw/services/:id/container` | Get container status (running/stopped) |
| `POST` | `/__gw/services/:id/container/restart` | Restart the container |
| `POST` | `/__gw/services/:id/container/start` | Start the container |
| `POST` | `/__gw/services/:id/container/stop` | Stop the container |
| `GET` | `/__gw/services/:id/container/logs` | Tail recent logs |

#### Client Config API (for proxied services)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/_gw/config` | Proxied service fetches its own config (keyed by `X-Service-Id` header) |

Services receive configs two ways:
1. **Request headers**: Every proxied request includes `X-Config-{KEY}` headers with decoded values
2. **Pull API**: Service calls `/_gw/config` with its service ID to fetch configs

### UI Dashboard (New Sections)

#### Service Registry Tab
- Card-based layout showing all registered services
- Each card shows: prefix, target, status (online/offline), config count, uptime
- Create/Edit/Delete service form
- Toggle enable/disable per service

#### Config Manager Tab
- For a selected service, shows all config keys
- Config values with secrets masked (`••••••••`)
- Add/Edit/Delete config entries
- Bulk import/export configs as JSON
- "Inject Config" button to push config into the proxied service on next request

#### Container Manager Tab
- For a selected service, shows:
  - Container status (running/stopped/restarting)
  - Uptime
  - CPU/Memory stats (if available via Docker API)
  - Restart / Start / Stop buttons
  - Recent logs (last 50 lines, auto-refresh)

### Changes Required (File-by-File)

| File | Change |
|------|--------|
| `docker-compose.yml` | Mount Docker socket (`/var/run/docker.sock`), Mount gateway DB volume |
| `gateway/server.js` | Add SQLite, add service registry CRUD, add config store with encryption, add Docker API integration, add config injection middleware |
| `gateway/package.json` | Add `better-sqlite3`, `dockerode` |
| `gateway/Dockerfile` | Install `python3` + build tools for `better-sqlite3` native addon |
| `gateway/public/index.html` | Add Service Registry tab, Config tab, Container tab |
| `gateway/public/app.js` | Add all new API calls and UI rendering for new tabs |
| `gateway/public/style.css` | Add new component styles |

### Implementation Order

#### Milestone 1: Service Registry + Catch-All Proxy ✅
- [x] JSON store with `services` collection
- [x] Dual proxy system: route-based (legacy) + service-based (catch-all `app.use(prefix, proxy)`)
- [x] Service CRUD API (`/__gw/services/*`)
- [x] UI: Service Registry tab (card-based list, add, edit, delete, toggle)
- [x] Migration endpoint: `POST /__gw/services/migrate` (groups routes by target)
- [x] Catch-all sub-path forwarding with prefix stripping (`/photos/api/stats` → `/api/stats`)

#### Milestone 2: Encrypted Config Store ✅
- [x] JSON store with `configs` collection (cascade deleted with service)
- [x] AES-256-GCM encrypt/decrypt for secret values (auto-detected)
- [x] Config CRUD API (`/__gw/services/:id/config/*`)
- [x] UI: Config Manager tab per service (add/bulk import, masked values)
- [x] Config injection via request headers (`X-Config-{KEY}`) in `onProxyReq`
- [x] Client pull API (`/_gw/config` — unprotected, keyed by `X-Service-Id`)

#### Milestone 3: Container Lifecycle ✅
- [x] Docker socket mounted in docker-compose (`/var/run/docker.sock:ro`)
- [x] Dockerode integration for container status/restart/stop/start/logs
- [x] Container management API (`/__gw/services/:id/container/*`)
- [x] UI: Container Manager tab with status, Restart/Stop/Start buttons, logs viewer

#### Milestone 4: Client Integration Guide + Polish ✅
- [x] `SERVICE_GUIDE.md` written — full integration guide with Node.js + Python examples
- [x] `.gitignore` includes `gateway/data/` (encrypted configs not in repo)
- [x] Config bulk import/export in UI
- [x] Docker log stream headers cleaned up
- [ ] Webhook on config change (notify service to reload)
- [ ] Request log upgrade: associate requests with service, store in JSON
- [ ] Backup/restore gateway config

### Docker Socket Security

Mounting the Docker socket is powerful but risky. The gateway already requires auth, but we add extra safety:
- Only restart/stop/start containers that are **registered services** (validate `docker_service` matches actual container)
- Log all container operations
- Require separate auth check for container operations

```yaml
# docker-compose.yml addition
services:
  gateway:
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./gateway/data:/app/data
```

### Client Service Integration Guide

Services that want to register with the gateway should:

1. **Be containerized** with a port exposed (internal only)
2. **Add to docker-compose** under the same network
3. **Register** via the dashboard or API with a unique prefix
4. **Receive configs** via:
   - Request headers: `X-Config-DB_URL`, `X-Config-API_KEY`, etc.
   - Pull: `GET /_gw/config` with `X-Service-Id` header
5. **Expose health** at `GET /health` returning `{ status: "ok" }`

Example service registration:
```bash
curl -X POST http://localhost:8081/__gw/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "prefix": "/my-app",
    "target": "http://my-app:4000",
    "docker_service": "my-app",
    "rewrite_html": true
  }'
```

### Rollback Strategy
- Phase 2 is backward-compatible: old route-based proxy still works alongside service-based proxy
- Can keep the old `/__gw/routes` API and migrate gradually
- If something breaks, disable the service in the dashboard (routes won't forward)
