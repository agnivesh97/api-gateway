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

## Current State
Gateway is running at `http://localhost:8081`. Login required for all routes.
