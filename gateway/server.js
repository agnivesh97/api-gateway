const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 8080;
const CONFIG_PATH = path.join(__dirname, 'config', 'routes.json');

// --- In-memory request log ---
const requestLog = [];
const MAX_LOG = 100;

// --- Helpers ---
function loadRoutes() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw).routes;
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

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(morgan('short'));

// --- Session ---
app.use(session({
  secret: process.env.SESSION_SECRET || 'tiwariji-gateway-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }, // 24h
}));

// --- Auth guard ---
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.accepts('html')) return res.redirect('/login.html');
  return res.status(401).json({ error: 'Unauthorized' });
}

// --- Login page (unprotected) ---
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- Login API (unprotected) ---
app.post('/__gw/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'agnivesh' && password === 'London@97') {
    req.session.user = { username };
    return res.json({ ok: true, user: username });
  }
  res.status(401).json({ error: 'Invalid username or password' });
});

// --- Auth gate: everything below requires login ---
app.use(requireAuth);

// --- Static dashboard (protected) ---
app.use(express.static(path.join(__dirname, 'public')));

// --- API: Get all routes ---
app.get('/__gw/routes', (req, res) => {
  res.json({ routes: loadRoutes() });
});

// --- API: Add/update a route ---
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

// --- API: Delete a route ---
app.delete('/__gw/routes/:encodedPath', (req, res) => {
  const routePath = decodeURIComponent(req.params.encodedPath);
  let routes = loadRoutes();
  routes = routes.filter(r => r.path !== routePath);
  saveRoutes(routes);
  rebuildProxies();
  res.json({ routes });
});

// --- API: Toggle route enabled ---
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

// --- API: Get request log ---
app.get('/__gw/log', (req, res) => {
  res.json({ log: requestLog });
});

// --- API: Health check ---
app.get('/__gw/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// --- API: Logout ---
app.post('/__gw/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

// --- API: Session check ---
app.get('/__gw/me', (req, res) => {
  res.json({ user: req.session.user.username });
});

// --- Dynamic proxy rebuild ---
let proxyStack = [];

function rebuildProxies() {
  // Remove old proxy middleware (they're stacked, so we clear app._router)
  // Instead, we maintain a middleware stack manually
  proxyStack.forEach(fn => {
    const idx = app._router?.stack?.findIndex(s => s.handle === fn);
    if (idx >= 0) app._router.stack.splice(idx, 1);
  });
  proxyStack = [];

  const routes = loadRoutes();
  routes.filter(r => r.enabled).forEach(route => {
    const handleHtmlRewrite = route.rewriteHtml === true;

    // Path rewrite logic:
    // - preservePath: keep the original path as-is (for backends that use the same path)
    // - rewriteHtml (true): strip entire prefix (e.g. /photos → /)
    // - rewriteHtml (false): strip only first segment (e.g. /api/users → /users)
    const pathParts = route.path.split('/').filter(Boolean);
    let rewriteRule;
    if (route.preservePath) {
      // Keep the path exactly as-is — no rewrite
      rewriteRule = {};
    } else if (handleHtmlRewrite) {
      // Strip the entire route prefix for UI apps mounted at a sub-path
      rewriteRule = { [`^${route.path}`]: '' };
    } else {
      // Strip only the first path segment (e.g. /api) for API routes
      const apiPrefix = '/' + pathParts[0];
      const servicePath = '/' + pathParts.slice(1).join('/');
      rewriteRule = { [`^${apiPrefix}${servicePath}`]: servicePath };
    }

    // --- HTML path rewriting for UI apps ---
    // When a UI app is served at a sub-path, its HTML may reference
    // assets with absolute paths like src="/style.css". These need
    // to be rewritten to src="/my-app/style.css" so the browser
    // routes them back through the gateway.

    const proxyOptions = {
      target: route.target,
      changeOrigin: true,
      pathRewrite: rewriteRule,
      onProxyReq: (proxyReq, req, res) => {
        logRequest(req, res, route.target);
        // Re-attach body if express.json() already consumed the stream
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
      // Use built-in responseInterceptor (handles gzip/brotli/deflate decompression)
      proxyOptions.selfHandleResponse = true;
      proxyOptions.onProxyRes = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'] || '';

        if (contentType.includes('text/html')) {
          let html = responseBuffer.toString('utf-8');
          const prefix = route.path.replace(/\/+$/, ''); // strip trailing slash

          // 1. Rewrite absolute paths in HTML attributes
          //    e.g. src="/app.js" → src="/pdf/app.js"
          html = html
            .replace(/((?:src|href|srcset|action|poster|data-src|formaction|xlink:href)\s*=\s*["'])\/(?!\/)/g, `$1${prefix}/`)
            .replace(/url\(\s*['"]?\/(?!\/)/g, `url(${prefix}/`);

          // 2. Inject <base> tag LAST so it's not rewritten by step 1
          //    This tells the browser to resolve ALL relative URLs (incl. JavaScript
          //    dynamic paths, fetch calls, etc.) against the route prefix
          if (!html.includes('<base ')) {
            html = html.replace('<head>', `<head><base href="${prefix}/">`);
          }

          return html;
        }

        // Non-HTML: pass through as-is
        return responseBuffer;
      });
    }

    const proxy = createProxyMiddleware(proxyOptions);

    app.use(route.path, proxy);
    proxyStack.push(proxy);
  });

  console.log(`🔁 Rebuilt ${routes.filter(r => r.enabled).length} proxy routes`);
}

// --- Init ---
rebuildProxies();

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║    TiwariJi API Gateway 🚀              ║
║    Dashboard: http://localhost:${PORT}   ║
║    Port: ${PORT}                         ║
╚══════════════════════════════════════════╝
  `);
});
