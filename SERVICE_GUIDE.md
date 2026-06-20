# TiwariJi API Gateway — Service Integration Guide

This guide explains how to containerize your service, register it with the TiwariJi Gateway, and receive runtime configuration.

---

## 1. Containerize Your Service

### Dockerfile
Create a standard Dockerfile for your service. Gateway assumes your service listens on HTTP.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### docker-compose.yml
Add your service to the project's `docker-compose.yml`. The gateway auto-discovers services on the same Docker network.

```yaml
services:
  my-service:
    build: ./my-service
    restart: unless-stopped
    # Expose port only if other services need it externally
    # ports:
    #   - "4000:4000"
```

---

## 2. Register with the Gateway

### Via Dashboard
1. Go to the **Services** tab in the gateway dashboard
2. Click **+ Add Service**
3. Fill in:
   - **Name**: `my-service` (unique identifier)
   - **Prefix**: `/my-service` (URL prefix for routing)
   - **Target**: `http://my-service:4000` (internal Docker hostname)
   - **Docker service name**: `my-service` (from docker-compose, for container ops)
   - **Rewrite HTML**: Check if your service serves a UI app with assets
4. Click **Save**

### Via API
```bash
curl -X POST http://localhost:8081/__gw/services \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "name": "my-service",
    "prefix": "/my-service",
    "target": "http://my-service:4000",
    "docker_service": "my-service",
    "rewrite_html": false,
    "description": "My awesome microservice"
  }'
```

### Migrate from Routes
If you already have individual route entries, click **🔄 Migrate Routes** on the Services tab, or:

```bash
curl -X POST http://localhost:8081/__gw/services/migrate \
  -H "Cookie: <your-session-cookie>"
```

This groups routes by target URL and creates a single service entry per target.

---

## 3. Access Pattern

Once registered, all requests to `http://gateway:8081/<prefix>/*` are forwarded to your service with the prefix stripped.

**Example:**
- Service prefix: `/my-service`
- Target: `http://my-service:4000`
- Browser requests: `http://gateway:8081/my-service/api/users`
- Your service receives: `GET /api/users`

For UI apps (HTML rewrite enabled), asset paths are rewritten so the browser routes them correctly through the gateway.

---

## 4. Receive Configuration

Your service receives configuration in two ways:

### Method A: Request Headers (Automatic)
Every proxied request includes `X-Config-*` headers with decoded values:

```http
GET /api/users HTTP/1.1
X-Config-Db-Url: file:/app/data.db
X-Config-Google-Token: ya29.a0AfH6S...
```

Config keys are converted to lowercase with hyphens:
- `DB_URL` → `X-Config-Db-Url`
- `GOOGLE_CLIENT_ID` → `X-Config-Google-Client-Id`

### Method B: Pull API (On-demand)
Your service can fetch its configs directly from the gateway's config endpoint. This is useful at startup or when configs change.

#### Example: Node.js
```js
const http = require('http');

async function fetchConfig(serviceId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gateway',
      port: 8080,
      path: '/_gw/config',
      headers: { 'X-Service-Id': serviceId },
    };
    http.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Usage
const config = await fetchConfig('my-service');
console.log(config.DB_URL);       // file:/app/data.db
```

#### Example: Python
```python
import requests

def fetch_config(service_id):
    """Fetch configs from gateway"""
    resp = requests.get(
        'http://gateway:8080/_gw/config',
        headers={'X-Service-Id': service_id}
    )
    resp.raise_for_status()
    return resp.json()

# Usage
config = fetch_config('my-service')
print(config['DB_URL'])
```

#### Example: cURL (for testing)
```bash
curl http://gateway:8080/_gw/config -H "X-Service-Id: my-service"
```

> **Note:** The `/_gw/config` endpoint is **unauthenticated** (no session required), so your services can call it internally. It validates via the `X-Service-Id` header only.

---

## 5. Manage Configs via Dashboard

1. Go to the **Config** tab
2. Select your service from the dropdown
3. Add individual config keys or bulk-import JSON

Configs marked as "secret" (length > 8, not a URL or file path) are encrypted with AES-256-GCM at rest and masked in the dashboard.

### Bulk Import Example
Paste this into the JSON textarea:
```json
{
  "DB_URL": "file:/app/data.db",
  "GOOGLE_CLIENT_ID": "xxx.apps.googleusercontent.com",
  "GOOGLE_CLIENT_SECRET": "GOCSPX-secret-value",
  "LOG_LEVEL": "debug"
}
```

---

## 6. Health Check Convention

The gateway uses Docker's health check status. For optimal container management, expose a health endpoint:

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "uptime": 12345,
  "version": "1.0.0"
}
```

Docker Compose health check:
```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

---

## 7. Container Operations

After registering with `docker_service` set, you can manage your container from the **Container** tab:

- **Status**: See running/stopped state
- **Restart**: Restart container gracefully
- **Start/Stop**: Start or stop container
- **Logs**: View last 50 lines of stdout/stderr

### Via API
```bash
# Check status
curl http://localhost:8081/__gw/services/<service-id>/container \
  -H "Cookie: <session>"

# Restart
curl -X POST http://localhost:8081/__gw/services/<service-id>/container/restart \
  -H "Cookie: <session>"

# View logs
curl http://localhost:8081/__gw/services/<service-id>/container/logs \
  -H "Cookie: <session>"
```

---

## 8. Full Working Example: Photo Organizer Setup

Here's how the Google Drive Photo Organizer was set up:

1. **Containerized** in `docker-compose.yml` as `photo-organizer`
2. **Registered** via API:
   ```bash
   curl -X POST http://localhost:8081/__gw/services \
     -H "Content-Type: application/json" \
     -d '{
       "name": "photo-organizer",
       "prefix": "/photos",
       "target": "http://photo-organizer:3000",
       "docker_service": "photo-organizer",
       "rewrite_html": true,
       "description": "Google Drive Photo Organizer"
     }'
   ```
3. **Configs stored** in gateway (Google OAuth tokens, DB path)
4. **Config pulled** at startup via `/_gw/config` with `X-Service-Id: photo-organizer`
5. **Access via**: `http://gateway:8081/photos`

Before this guide, the photo organizer needed **12 individual route entries**. Now it needs **1 service registration**.

---

## 9. Best Practices

- **Name services** with kebab-case (e.g., `my-service`, `photo-organizer`)
- **Prefix** should match the first path segment (e.g., `/my-service`)
- **Docker service name** must match the `docker-compose.yml` service name exactly
- **Store only non-sensitive** URLs and file paths as plaintext (not encrypted)
- **Secrets** (tokens, passwords, API keys) are automatically encrypted
- **Pull configs** at startup rather than relying solely on headers
- **Expose health** endpoints for container status monitoring

---

## 10. Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| 502 Bad Gateway | Service not running | Start the container from Container tab |
| 404 on proxied path | Prefix mismatch | Check registered prefix matches your URL |
| Config headers missing | Service not registered | Verify service exists in Services tab |
| Container ops fail | Docker socket not mounted | Add `/var/run/docker.sock:/var/run/docker.sock:ro` to compose |
| Migration creates dups | Services already exist | Delete existing services first |
