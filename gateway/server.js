const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ============================================================
// Configuration
// ============================================================
const app = express();
const PORT = process.env.PORT || 8080;
const CONFIG_PATH = path.join(__dirname, 'config', 'routes.json');
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'gateway.json');
const ENCRYPTION_KEY = process.env.GW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'); // 64 hex chars = 32 bytes for AES-256

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================
// JSON File Store (lightweight alternative to SQLite)
// ============================================================
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { services: [], configs: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getServices() {
  const db = loadDB();
  return db.services;
}

function getService(id) {
  return getServices().find(s => s.id === id);
}

function addService(service) {
  const db = loadDB();
  // Check uniqueness
  if (db.services.some(s => s.name === service.name)) throw new Error('UNIQUE:name');
  if (db.services.some(s => s.prefix === service.prefix)) throw new Error('UNIQUE:prefix');
  db.services.push(service);
  saveDB(db);
  return service;
}

function updateService(id, updates) {
  const db = loadDB();
  const idx = db.services.findIndex(s => s.id === id);
  if (idx < 0) return null;
  if (updates.name && db.services.some(s => s.name === updates.name && s.id !== id)) throw new Error('UNIQUE:name');
  if (updates.prefix && db.services.some(s => s.prefix === updates.prefix && s.id !== id)) throw new Error('UNIQUE:prefix');
  db.services[idx] = { ...db.services[idx], ...updates, updated_at: new Date().toISOString() };
  saveDB(db);
  return db.services[idx];
}

function deleteService(id) {
  const db = loadDB();
  const idx = db.services.findIndex(s => s.id === id);
  if (idx < 0) return false;
  db.services.splice(idx, 1);
  // Cascade delete configs
  db.configs = db.configs.filter(c => c.service_id !== id);
  saveDB(db);
  return true;
}

// --- Config operations ---
function getConfigs(serviceId) {
  const db = loadDB();
  return db.configs.filter(c => c.service_id === serviceId);
}

function upsertConfig(serviceId, key, value, isSecret) {
  const db = loadDB();
  const idx = db.configs.findIndex(c => c.service_id === serviceId && c.key === key);
  const now = new Date().toISOString();
  if (idx >= 0) {
    db.configs[idx] = { ...db.configs[idx], value, is_secret: isSecret ? 1 : 0, updated_at: now };
  } else {
    db.configs.push({
      id: uuidv4(),
      service_id: serviceId,
      key,
      value,
      is_secret: isSecret ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
  }
  saveDB(db);
  return true;
}

function deleteConfig(serviceId, key) {
  const db = loadDB();
  db.configs = db.configs.filter(c => !(c.service_id === serviceId && c.key === key));
  saveDB(db);
}

// ============================================================
// Encryption helpers (AES-256-GCM)
// ============================================================
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(encryptedText) {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) return encryptedText;
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedText;
  }
}

// ============================================================
// In-memory request log (legacy)
// ============================================================
const requestLog = [];
const MAX_LOG = 100;

// ============================================================
// Helpers
// ============================================================
function loadRoutes() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).routes;
  } catch {
    return [];
  }
}

function saveRoutes(routes) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ routes }, null, 2));
}

function logRequest(req, res, target) {
  requestLog.unshift({
    ts: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl,
    target,
    status: res.statusCode,
  });
  if (requestLog.length > MAX_LOG) requestLog.pop();
}

// ============================================================
// Middleware
// ============================================================
app.use(cors());
app.use(express.json());
app.use(morgan('short'));

// --- Session ---
app.use(session({
  secret: process.env.SESSION_SECRET || 'tiwariji-gateway-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
}));

// ============================================================
// Client Config API (unprotected — called by services)
// ============================================================
app.get('/_gw/config', (req, res) => {
  const serviceId = req.headers['x-service-id'];
  if (!serviceId) {
    return res.status(400).json({ error: 'X-Service-Id header required' });
  }
  const service = getServices().find(s => s.id === serviceId || s.name === serviceId);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  const configs = getConfigs(service.id);
  const result = {};
  configs.forEach(c => {
    result[c.key] = c.is_secret ? decrypt(c.value) : c.value;
  });
  res.json(result);
});

// ============================================================
// Unprotected routes
// ============================================================
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/__gw/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'agnivesh' && password === 'London@97') {
    req.session.user = { username };
    return res.json({ ok: true, user: username });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

// ============================================================
// Auth guard
// ============================================================
app.use(requireAuth);

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.accepts('html')) return res.redirect('/login.html');
  return res.status(401).json({ error: 'Unauthorized' });
}

// ============================================================
// Static dashboard
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// LEGACY ROUTE CRUD API
// ============================================================
app.get('/__gw/routes', (req, res) => {
  res.json({ routes: loadRoutes() });
});

app.post('/__gw/routes', (req, res) => {
  const { path: routePath, target, name, description, rewriteHtml, preservePath } = req.body;
  if (!routePath || !target) {
    return res.status(400).json({ error: 'path and target are required' });
  }
  const routes = loadRoutes();
  const existing = routes.findIndex(r => r.path === routePath);
  const newRoute = {
    path: routePath,
    target,
    name: name || routePath,
    description: description || '',
    enabled: true,
    rewriteHtml: rewriteHtml === true,
    preservePath: preservePath === true,
  };
  if (existing >= 0) {
    routes[existing] = { ...routes[existing], ...newRoute };
  } else {
    routes.push(newRoute);
  }
  saveRoutes(routes);
  rebuildProxies();
  res.json({ routes });
});

app.delete('/__gw/routes/:encodedPath', (req, res) => {
  const routePath = decodeURIComponent(req.params.encodedPath);
  let routes = loadRoutes();
  routes = routes.filter(r => r.path !== routePath);
  saveRoutes(routes);
  rebuildProxies();
  res.json({ routes });
});

app.patch('/__gw/routes/:encodedPath/toggle', (req, res) => {
  const routePath = decodeURIComponent(req.params.encodedPath);
  const routes = loadRoutes();
  const route = routes.find(r => r.path === routePath);
  if (!route) return res.status(404).json({ error: 'route not found' });
  route.enabled = !route.enabled;
  saveRoutes(routes);
  rebuildProxies();
  res.json({ routes });
});

// ============================================================
// SERVICE REGISTRY API
// ============================================================

// --- List all services ---
app.get('/__gw/services', (req, res) => {
  try {
    const services = getServices().map(s => ({
      ...s,
      config_count: getConfigs(s.id).length,
    }));
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Create service ---
app.post('/__gw/services', (req, res) => {
  const { name, prefix, target, docker_service, rewrite_html, preserve_path, description } = req.body;
  if (!name || !prefix || !target) {
    return res.status(400).json({ error: 'name, prefix, and target are required' });
  }
  try {
    const id = uuidv4();
    const service = {
      id,
      name,
      prefix,
      target,
      docker_service: docker_service || '',
      rewrite_html: rewrite_html ? 1 : 0,
      preserve_path: preserve_path ? 1 : 0,
      enabled: 1,
      description: description || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    addService(service);
    rebuildServiceProxies();
    res.json({ service });
  } catch (err) {
    if (err.message.startsWith('UNIQUE:')) {
      return res.status(409).json({ error: `Service with same ${err.message.split(':')[1]} already exists` });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- Get single service ---
app.get('/__gw/services/:id', (req, res) => {
  const service = getService(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const configs = getConfigs(service.id).map(c => ({
    id: c.id,
    key: c.key,
    is_secret: c.is_secret,
    value: c.is_secret ? '••••••••' : '(plaintext)',
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));
  res.json({ service, configs });
});

// --- Update service ---
app.put('/__gw/services/:id', (req, res) => {
  const { name, prefix, target, docker_service, rewrite_html, preserve_path, description, enabled } = req.body;
  try {
    const existing = getService(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Service not found' });

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (prefix !== undefined) updates.prefix = prefix;
    if (target !== undefined) updates.target = target;
    if (docker_service !== undefined) updates.docker_service = docker_service;
    if (rewrite_html !== undefined) updates.rewrite_html = rewrite_html ? 1 : 0;
    if (preserve_path !== undefined) updates.preserve_path = preserve_path ? 1 : 0;
    if (description !== undefined) updates.description = description;
    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

    const updated = updateService(req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Service not found' });

    rebuildServiceProxies();
    res.json({ service: updated });
  } catch (err) {
    if (err.message.startsWith('UNIQUE:')) {
      return res.status(409).json({ error: `Service with same ${err.message.split(':')[1]} already exists` });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- Delete service ---
app.delete('/__gw/services/:id', (req, res) => {
  try {
    if (!deleteService(req.params.id)) {
      return res.status(404).json({ error: 'Service not found' });
    }
    rebuildServiceProxies();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Toggle service ---
app.patch('/__gw/services/:id/toggle', (req, res) => {
  try {
    const service = getService(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    const updated = updateService(req.params.id, { enabled: service.enabled ? 0 : 1 });
    rebuildServiceProxies();
    res.json({ service: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Migrate routes to services ---
app.post('/__gw/services/migrate', (req, res) => {
  try {
    const routes = loadRoutes();
    const groups = {};
    routes.forEach(r => {
      if (!groups[r.target]) groups[r.target] = [];
      groups[r.target].push(r);
    });

    let created = 0;
    Object.entries(groups).forEach(([target, targetRoutes]) => {
      const name = targetRoutes[0].name?.replace(/\s*[-–—].*$/, '').trim() || target.replace(/^https?:\/\//, '').split(':')[0];
      const shortestPath = targetRoutes.reduce((a, b) => a.path.length < b.path.length ? a : b);
      const prefix = '/' + shortestPath.path.split('/').filter(Boolean)[0];
      const rewriteHtml = targetRoutes.some(r => r.rewriteHtml);
      const preservePath = targetRoutes.every(r => r.preservePath);

      try {
        addService({
          id: uuidv4(),
          name,
          prefix,
          target,
          docker_service: '',
          rewrite_html: rewriteHtml ? 1 : 0,
          preserve_path: preservePath ? 1 : 0,
          enabled: 1,
          description: `${targetRoutes.length} routes merged from migration`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        created++;
      } catch {
        // Skip duplicate
      }
    });

    rebuildServiceProxies();
    res.json({ created, total: Object.keys(groups).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CONFIG STORE API
// ============================================================

// --- List configs ---
app.get('/__gw/services/:id/config', (req, res) => {
  const service = getService(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const configs = getConfigs(service.id).map(c => ({
    ...c,
    value: c.is_secret ? '••••••••' : c.value,
  }));
  res.json({ configs });
});

// --- Bulk set configs ---
app.put('/__gw/services/:id/config', (req, res) => {
  const service = getService(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  const { configs } = req.body;
  if (!configs || typeof configs !== 'object') {
    return res.status(400).json({ error: 'configs object required' });
  }

  try {
    Object.entries(configs).forEach(([key, value]) => {
      const isSecret = typeof value === 'string' && value.length > 8 &&
        !value.startsWith('file:') && !value.startsWith('http');
      const storedVal = isSecret ? encrypt(value) : value;
      upsertConfig(service.id, key, storedVal, isSecret);
    });

    const updated = getConfigs(service.id).map(c => ({
      ...c,
      value: c.is_secret ? '••••••••' : c.value,
    }));
    res.json({ configs: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Delete config key ---
app.delete('/__gw/services/:id/config/:key', (req, res) => {
  const service = getService(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  deleteConfig(service.id, req.params.key);
  res.json({ ok: true });
});

// ============================================================
// CONTAINER MANAGEMENT API
// ============================================================
const Docker = require('dockerode');
const docker = new Docker();

async function getContainer(serviceId) {
  const service = getService(serviceId);
  if (!service || !service.docker_service) return null;

  const containers = await docker.listContainers({ all: true });
  const containerInfo = containers.find(c =>
    c.Names.some(n => n.includes(service.docker_service))
  );
  if (!containerInfo) return null;

  const container = docker.getContainer(containerInfo.Id);
  return { container, info: containerInfo };
}

// --- Container status ---
app.get('/__gw/services/:id/container', async (req, res) => {
  try {
    const result = await getContainer(req.params.id);
    if (!result) return res.json({ status: 'unknown', message: 'No Docker container found' });
    const { info } = result;
    res.json({
      id: info.Id.slice(0, 12),
      name: info.Names[0].replace(/^\//, ''),
      status: info.State,
      state: info.Status,
      image: info.Image,
      created: new Date(info.Created * 1000).toISOString(),
      ports: info.Ports?.map(p => `${p.PrivatePort}->${p.PublicPort || '?'}`) || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Restart container ---
app.post('/__gw/services/:id/container/restart', async (req, res) => {
  try {
    const result = await getContainer(req.params.id);
    if (!result) return res.status(404).json({ error: 'Container not found' });
    await result.container.restart();
    res.json({ ok: true, message: 'Container restarted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Start container ---
app.post('/__gw/services/:id/container/start', async (req, res) => {
  try {
    const result = await getContainer(req.params.id);
    if (!result) return res.status(404).json({ error: 'Container not found' });
    await result.container.start();
    res.json({ ok: true, message: 'Container started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Stop container ---
app.post('/__gw/services/:id/container/stop', async (req, res) => {
  try {
    const result = await getContainer(req.params.id);
    if (!result) return res.status(404).json({ error: 'Container not found' });
    await result.container.stop();
    res.json({ ok: true, message: 'Container stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Container logs ---
app.get('/__gw/services/:id/container/logs', async (req, res) => {
  try {
    const result = await getContainer(req.params.id);
    if (!result) return res.status(404).json({ error: 'Container not found' });
    const logs = await result.container.logs({
      stdout: true,
      stderr: true,
      tail: 50,
      timestamps: false,
    });
    // Strip Docker stream headers (1-byte type + 3-byte pad + 4-byte length) from each chunk
    const raw = logs.toString('utf-8');
    const lines = raw.split('\n').filter(Boolean).map(line => {
      // Docker multiplexed stream: first 8 bytes are header, rest is content
      if (line.length > 8 && /^[\x00-\x02]/.test(line)) {
        return line.substring(8);
      }
      return line;
    });
    res.json({ logs: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HELPER APIs
// ============================================================
app.get('/__gw/log', (req, res) => {
  res.json({ log: requestLog });
});

app.get('/__gw/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/__gw/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

app.get('/__gw/me', (req, res) => {
  res.json({ user: req.session.user.username });
});

// ============================================================
// PROXY SYSTEM
// ============================================================

let serviceProxyStack = [];
let routeProxyStack = [];

function rebuildServiceProxies() {
  // Remove old service proxies
  serviceProxyStack.forEach(fn => {
    const idx = app._router?.stack?.findIndex(s => s.handle === fn);
    if (idx >= 0) app._router.stack.splice(idx, 1);
  });
  serviceProxyStack = [];

  const services = getServices().filter(s => s.enabled === 1);

  services.forEach(service => {
    const handleHtmlRewrite = service.rewrite_html === 1;

    const proxyOptions = {
      target: service.target,
      changeOrigin: true,
      pathRewrite: {
        [`^${service.prefix}`]: '',
      },
      onProxyReq: (proxyReq, req, res) => {
        logRequest(req, res, service.target);

        // Inject config headers
        const configs = getConfigs(service.id);
        configs.forEach(c => {
          const val = c.is_secret ? decrypt(c.value) : c.value;
          const headerName = `x-config-${c.key.replace(/_/g, '-').toLowerCase()}`;
          proxyReq.setHeader(headerName, val);
        });

        // Re-attach body
        if (req.body && Object.keys(req.body).length > 0) {
          const bodyStr = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
          proxyReq.write(bodyStr);
        }
      },
      onError: (err, req, res) => {
        console.error(`Proxy error for ${req.path}:`, err.message);
        res.status(502).json({ error: `Bad Gateway: ${err.message}` });
      },
    };

    if (handleHtmlRewrite) {
      proxyOptions.selfHandleResponse = true;
      proxyOptions.onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf-8');
          const prefix = service.prefix.replace(/\/+$/, '');
          html = html
            .replace(/((?:src|href|srcset|action|poster|data-src|formaction|xlink:href)\s*=\s*["'])\/(?!\/)/g, `$1${prefix}/`)
            .replace(/url\(\s*['"]?\/(?!\/)/g, `url(${prefix}/`);
          if (!html.includes('<base ')) {
            html = html.replace('<head>', `<head><base href="${prefix}/">`);
          }
          return html;
        }
        return responseBuffer;
      });
    }

    const proxy = createProxyMiddleware(proxyOptions);
    app.use(service.prefix, proxy);
    serviceProxyStack.push(proxy);
  });

  console.log(`🔁 Rebuilt ${services.length} service proxies`);
}

function rebuildProxies() {
  // Remove old route proxies
  routeProxyStack.forEach(fn => {
    const idx = app._router?.stack?.findIndex(s => s.handle === fn);
    if (idx >= 0) app._router.stack.splice(idx, 1);
  });
  routeProxyStack = [];

  const routes = loadRoutes();
  routes.filter(r => r.enabled).forEach(route => {
    const handleHtmlRewrite = route.rewriteHtml === true;

    const pathParts = route.path.split('/').filter(Boolean);
    let rewriteRule;
    if (route.preservePath) {
      rewriteRule = {};
    } else if (handleHtmlRewrite) {
      rewriteRule = { [`^${route.path}`]: '' };
    } else {
      const apiPrefix = '/' + pathParts[0];
      const servicePath = '/' + pathParts.slice(1).join('/');
      rewriteRule = { [`^${apiPrefix}${servicePath}`]: servicePath };
    }

    const proxyOptions = {
      target: route.target,
      changeOrigin: true,
      pathRewrite: rewriteRule,
      onProxyReq: (proxyReq, req, res) => {
        logRequest(req, res, route.target);
        if (req.body && Object.keys(req.body).length > 0) {
          const bodyStr = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
          proxyReq.write(bodyStr);
        }
      },
      onError: (err, req, res) => {
        console.error(`Proxy error for ${req.path}:`, err.message);
        res.status(502).json({ error: `Bad Gateway: ${err.message}` });
      },
    };

    if (handleHtmlRewrite) {
      proxyOptions.selfHandleResponse = true;
      proxyOptions.onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf-8');
          const prefix = route.path.replace(/\/+$/, '');
          html = html
            .replace(/((?:src|href|srcset|action|poster|data-src|formaction|xlink:href)\s*=\s*["'])\/(?!\/)/g, `$1${prefix}/`)
            .replace(/url\(\s*['"]?\/(?!\/)/g, `url(${prefix}/`);
          if (!html.includes('<base ')) {
            html = html.replace('<head>', `<head><base href="${prefix}/">`);
          }
          return html;
        }
        return responseBuffer;
      });
    }

    const proxy = createProxyMiddleware(proxyOptions);
    app.use(route.path, proxy);
    routeProxyStack.push(proxy);
  });

  console.log(`🔁 Rebuilt ${routes.filter(r => r.enabled).length} route proxies`);
}

// ============================================================
// Init
// ============================================================
rebuildProxies();
rebuildServiceProxies();

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║    TiwariJi API Gateway v2 🚀           ║
║    Dashboard: http://localhost:${PORT}   ║
║    Port: ${PORT}                         ║
║    Services + Config + Container Ready   ║
╚══════════════════════════════════════════╝
  `);
});
