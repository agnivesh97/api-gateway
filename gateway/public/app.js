const API = '/__gw';

// --- Auth check ---
async function checkAuth() {
  try {
    const res = await fetch(`${API}/me`);
    if (!res.ok) { window.location.href = '/login.html'; return; }
    const data = await res.json();
    document.getElementById('userDisplay').textContent = `👤 ${data.user}`;
    document.getElementById('logoutBtn').style.display = 'inline-block';
  } catch {
    window.location.href = '/login.html';
  }
}

// --- Logout ---
async function handleLogout() {
  await fetch(`${API}/logout`, { method: 'POST' });
  window.location.href = '/login.html';
}

// --- Wrapped fetch that redirects on 401 ---
async function authFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res;
}

// --- Fetch & render routes ---
async function fetchRoutes() {
  const res = await authFetch(`${API}/routes`);
  if (!res) return;
  const { routes } = await res.json();
  renderRoutes(routes);
  document.getElementById('statRoutes').textContent = routes.length;
  document.getElementById('statActive').textContent = routes.filter(r => r.enabled).length;
}

function renderRoutes(routes) {
  const tbody = document.getElementById('routesBody');
  if (routes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:20px;">No routes configured.</td></tr>';
    return;
  }
  tbody.innerHTML = routes.map(r => `
    <tr>
      <td><code>${r.path}</code></td>
      <td>${r.name}</td>
      <td><code>${r.target}</code></td>
      <td><span class="badge ${r.enabled ? 'on' : 'off'}">${r.enabled ? 'Active' : 'Disabled'}</span></td>
      <td><span class="badge ${r.rewriteHtml ? 'on' : 'off'}" style="font-size:0.7rem">${r.rewriteHtml ? 'Yes' : 'No'}</span></td>
      <td>
        <button class="btn btn-xs ${r.enabled ? 'btn' : 'btn-secondary'}" onclick="openRoute('${r.path}')" ${r.enabled ? '' : 'disabled'}>Open</button>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn btn-xs ${r.enabled ? 'btn-secondary' : 'btn'}" onclick="toggleRoute('${r.path}')">
            ${r.enabled ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-xs btn-danger" onclick="deleteRoute('${r.path}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// --- Open route in new tab ---
function openRoute(path) {
  window.open(path, '_blank');
}

async function toggleRoute(path) {
  const res = await authFetch(`${API}/routes/${encodeURIComponent(path)}/toggle`, { method: 'PATCH' });
  if (res) fetchRoutes();
}

async function deleteRoute(path) {
  if (!confirm(`Delete route "${path}"?`)) return;
  const res = await authFetch(`${API}/routes/${encodeURIComponent(path)}`, { method: 'DELETE' });
  if (res) fetchRoutes();
}

// --- Add/Edit Route ---
function showAddRoute() {
  document.getElementById('routePath').value = '';
  document.getElementById('routeTarget').value = '';
  document.getElementById('routeName').value = '';
  document.getElementById('routeDesc').value = '';
  document.getElementById('routeRewriteHtml').checked = false;
  document.getElementById('routeModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('routeModal').style.display = 'none';
}

async function saveRoute() {
  const path = document.getElementById('routePath').value.trim();
  const target = document.getElementById('routeTarget').value.trim();
  if (!path || !target) { alert('Path and Target are required'); return; }
  const res = await authFetch(`${API}/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      target,
      name: document.getElementById('routeName').value.trim(),
      description: document.getElementById('routeDesc').value.trim(),
      rewriteHtml: document.getElementById('routeRewriteHtml').checked === true,
    }),
  });
  if (res) {
    closeModal();
    fetchRoutes();
  }
}

// --- Fetch request log ---
async function fetchLog() {
  const res = await authFetch(`${API}/log`);
  if (!res) return;
  const { log } = await res.json();
  document.getElementById('statRequests').textContent = log.length;
  const container = document.getElementById('logContainer');
  if (log.length === 0) {
    container.innerHTML = '<div class="log-empty">No requests yet</div>';
    return;
  }
  container.innerHTML = log.map(e => {
    const color = e.status >= 500 ? '#ef4444' : e.status >= 400 ? '#fbbf24' : '#22c55e';
    return `<div class="log-entry">
      <span class="method" style="color:${color}">${e.method}</span>
      <span class="status">${e.status}</span>
      <span class="path">${e.path}</span>
      <span style="color:#64748b;font-size:0.75rem">→ ${e.target}</span>
    </div>`;
  }).join('');
}

// --- Health check ---
async function checkHealth() {
  try {
    const res = await authFetch(`${API}/health`);
    if (!res) return;
    if (res.ok) {
      document.getElementById('healthDot').className = 'status-dot ok';
      document.getElementById('healthText').textContent = 'Connected';
    } else {
      throw new Error('not ok');
    }
  } catch {
    document.getElementById('healthDot').className = 'status-dot err';
    document.getElementById('healthText').textContent = 'Disconnected';
  }
}

// --- Polling ---
checkAuth().then(() => {
  fetchRoutes();
  fetchLog();
  checkHealth();
});
setInterval(fetchRoutes, 5000);
setInterval(fetchLog, 5000);
setInterval(checkHealth, 10000);
