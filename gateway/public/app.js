const API = '/__gw';
let servicesCache = [];
let currentServiceId = null;

// ── Auth ──
async function checkAuth() {
  try {
    const res = await fetch(`${API}/me`);
    if (!res.ok) { window.location.href = '/login.html'; }
    const data = await res.json();
    document.getElementById('userDisplay').textContent = `👤 ${data.user}`;
    document.getElementById('logoutBtn').style.display = 'inline-block';
  } catch { window.location.href = '/login.html'; }
}

async function handleLogout() {
  await fetch(`${API}/logout`, { method: 'POST' });
  window.location.href = '/login.html';
}

async function authFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res;
}

// ── Services ──
async function fetchServices() {
  const res = await authFetch(`${API}/services`);
  if (!res) return;
  const { services } = await res.json();
  servicesCache = services;
  renderServices(services);
  document.getElementById('statServices').textContent = services.length;
}

function renderServices(services) {
  const container = document.getElementById('servicesContainer');
  if (services.length === 0) {
    container.innerHTML = '<div class="log-empty">No services registered. Click "+ Add Service" above.</div>';
    return;
  }
  container.innerHTML = services.map(s => `
    <div class="service-card ${s.enabled ? '' : 'disabled'}" onclick="selectService('${s.id}')" style="cursor:pointer">
      <div class="service-header">
        <span class="service-name">${s.name}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge ${s.enabled ? 'on' : 'off'}">${s.enabled ? 'Active' : 'Disabled'}</span>
          <span class="badge" style="background:#3b82f620;color:#3b82f6">${s.config_count || 0} cfg</span>
        </div>
      </div>
      <div class="service-details">
        <div><span class="label">Prefix:</span> <code>${s.prefix}</code></div>
        <div><span class="label">Target:</span> <code>${s.target}</code></div>
        <div><span class="label">${s.description || 'No description'}</span></div>
      </div>
    </div>
  `).join('');
}

function selectService(id) {
  const s = servicesCache.find(x => x.id === id);
  if (!s) return;
  currentServiceId = id;
  // Show detail panel
  document.getElementById('serviceListSection').style.display = 'none';
  document.getElementById('serviceDetail').style.display = 'block';
  // Fill info
  document.getElementById('detailServiceName').textContent = s.name;
  document.getElementById('detailPrefix').textContent = s.prefix;
  document.getElementById('detailTarget').textContent = s.target;
  document.getElementById('detailDocker').textContent = s.docker_service || '-';
  document.getElementById('detailDesc').textContent = s.description || '-';
  document.getElementById('detailCreated').textContent = s.created_at || '-';
  const badge = document.getElementById('detailStatusBadge');
  badge.textContent = s.enabled ? 'Active' : 'Disabled';
  badge.className = 'badge ' + (s.enabled ? 'on' : 'off');
  document.getElementById('detailToggleBtn').textContent = s.enabled ? 'Disable' : 'Enable';
  // Load sections
  loadDetailConfigs();
  loadDetailContainer();
  loadDetailActivity();
}

function closeServiceDetail() {
  currentServiceId = null;
  document.getElementById('serviceDetail').style.display = 'none';
  document.getElementById('serviceListSection').style.display = 'block';
  document.getElementById('detailAppViewer').style.display = 'none';
  const frame = document.getElementById('detailAppFrame');
  if (frame) frame.src = 'about:blank';
}

function openApp() {
  const s = servicesCache.find(x => x.id === currentServiceId);
  if (!s) return;
  const viewer = document.getElementById('detailAppViewer');
  const frame = document.getElementById('detailAppFrame');
  if (viewer && frame) {
    frame.src = s.prefix;
    viewer.style.display = 'block';
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function openAppNewTab() {
  const s = servicesCache.find(x => x.id === currentServiceId);
  if (s) window.open(s.prefix, '_blank');
}

function closeAppViewer() {
  const viewer = document.getElementById('detailAppViewer');
  const frame = document.getElementById('detailAppFrame');
  if (viewer && frame) { frame.src = 'about:blank'; viewer.style.display = 'none'; }
}

async function toggleDetailService() {
  if (!currentServiceId) return;
  const res = await authFetch(`${API}/services/${currentServiceId}/toggle`, { method: 'PATCH' });
  if (res) { fetchServices(); selectService(currentServiceId); }
}

async function deleteDetailService() {
  const s = servicesCache.find(x => x.id === currentServiceId);
  if (!s || !confirm(`Delete service "${s.name}"?`)) return;
  const res = await authFetch(`${API}/services/${currentServiceId}`, { method: 'DELETE' });
  if (res) { closeServiceDetail(); fetchServices(); populateServiceDropdowns(); }
}

function editDetailService() {
  const s = servicesCache.find(x => x.id === currentServiceId);
  if (!s) return;
  document.getElementById('serviceName').value = s.name;
  document.getElementById('servicePrefix').value = s.prefix;
  document.getElementById('serviceTarget').value = s.target;
  document.getElementById('serviceDocker').value = s.docker_service || '';
  document.getElementById('serviceDesc').value = s.description || '';
  document.getElementById('serviceRewriteHtml').checked = s.rewrite_html === 1;
  const modal = document.getElementById('serviceModal');
  modal.querySelector('h3').textContent = 'Edit Service';
  const saveBtn = modal.querySelector('.btn:last-child');
  saveBtn.textContent = 'Update';
  saveBtn.onclick = async () => {
    const res = await authFetch(`${API}/services/${currentServiceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('serviceName').value.trim(),
        prefix: document.getElementById('servicePrefix').value.trim(),
        target: document.getElementById('serviceTarget').value.trim(),
        docker_service: document.getElementById('serviceDocker').value.trim(),
        description: document.getElementById('serviceDesc').value.trim(),
        rewrite_html: document.getElementById('serviceRewriteHtml').checked === true,
      }),
    });
    if (res) { closeModal('serviceModal'); fetchServices(); selectService(currentServiceId); }
    resetServiceModal();
  };
  modal.style.display = 'flex';
}

function showAddService() {
  document.getElementById('serviceName').value = '';
  document.getElementById('servicePrefix').value = '';
  document.getElementById('serviceTarget').value = '';
  document.getElementById('serviceDocker').value = '';
  document.getElementById('serviceDesc').value = '';
  document.getElementById('serviceRewriteHtml').checked = false;
  const modal = document.getElementById('serviceModal');
  modal.querySelector('h3').textContent = 'Register Service';
  const saveBtn = modal.querySelector('.btn:last-child');
  saveBtn.textContent = 'Save';
  saveBtn.onclick = saveService;
  modal.style.display = 'flex';
}

function resetServiceModal() {
  const modal = document.getElementById('serviceModal');
  modal.querySelector('h3').textContent = 'Register Service';
  const saveBtn = modal.querySelector('.btn:last-child');
  saveBtn.textContent = 'Save';
  saveBtn.onclick = saveService;
}

async function saveService() {
  const name = document.getElementById('serviceName').value.trim();
  const prefix = document.getElementById('servicePrefix').value.trim();
  const target = document.getElementById('serviceTarget').value.trim();
  if (!name || !prefix || !target) { alert('Name, Prefix, and Target are required'); return; }
  const res = await authFetch(`${API}/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, prefix, target,
      docker_service: document.getElementById('serviceDocker').value.trim(),
      description: document.getElementById('serviceDesc').value.trim(),
      rewrite_html: document.getElementById('serviceRewriteHtml').checked === true,
    }),
  });
  if (res) { closeModal('serviceModal'); fetchServices(); populateServiceDropdowns(); }
}

async function migrateRoutes() {
  if (!confirm('Create service entries from existing routes?')) return;
  const res = await authFetch(`${API}/services/migrate`, { method: 'POST' });
  if (res) {
    const data = await res.json();
    alert(`✅ Created ${data.created} services from ${data.total} targets.`);
    fetchServices();
  }
}

// ── Configs (within service detail) ──
async function loadDetailConfigs() {
  if (!currentServiceId) return;
  const res = await authFetch(`${API}/services/${currentServiceId}/config`);
  if (!res) return;
  const { configs } = await res.json();
  const tbody = document.getElementById('detailConfigsBody');
  if (configs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px;">No configs set.</td></tr>';
    return;
  }
  tbody.innerHTML = configs.map(c => `
    <tr>
      <td><code>${c.key}</code></td>
      <td><code style="color:#64748b">${c.is_secret ? '••••••••' : c.value}</code></td>
      <td><span class="badge ${c.is_secret ? 'on' : 'off'}" style="font-size:0.7rem">${c.is_secret ? 'Secret' : 'Plain'}</span></td>
      <td style="color:#64748b;font-size:0.75rem">${c.updated_at || c.created_at || '-'}</td>
      <td>
        <button class="btn btn-xs btn-secondary" onclick="editConfig('${c.key}', '${(c.is_secret ? '' : c.value).replace(/'/g, "\\'")}', ${c.is_secret})">✏️</button>
        <button class="btn btn-xs btn-danger" onclick="deleteConfig('${c.key}')">🗑️</button>
      </td>
    </tr>
  `).join('');
  // Update config count on card
  const s = servicesCache.find(x => x.id === currentServiceId);
  if (s) s.config_count = configs.length;
}

function showAddConfig() {
  document.getElementById('configKey').value = '';
  document.getElementById('configValue').value = '';
  document.getElementById('configIsSecret').checked = true;
  document.getElementById('configModalTitle').textContent = '+ Add Config';
  document.getElementById('configKey').disabled = false;
  document.getElementById('configModal').style.display = 'flex';
}

function editConfig(key, value, isSecret) {
  document.getElementById('configModalTitle').textContent = '✏️ Edit Config';
  document.getElementById('configKey').value = key;
  document.getElementById('configKey').disabled = true;
  // Show masked for secrets, actual for plain
  document.getElementById('configValue').value = isSecret ? '' : value;
  document.getElementById('configIsSecret').checked = isSecret === 1 || isSecret === true;
  document.getElementById('configModal').style.display = 'flex';
}

async function saveConfig() {
  const key = document.getElementById('configKey').value.trim();
  const value = document.getElementById('configValue').value.trim();
  if (!key || !value) { alert('Key and Value are required'); return; }
  const payload = { configs: {} };
  payload.configs[key] = value;
  const res = await authFetch(`${API}/services/${currentServiceId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res) { closeModal('configModal'); loadDetailConfigs(); }
}

async function deleteConfig(key) {
  if (!confirm(`Delete config "${key}"?`)) return;
  const res = await authFetch(`${API}/services/${currentServiceId}/config/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (res) loadDetailConfigs();
}

async function bulkImportConfigs() {
  const text = document.getElementById('detailConfigBulk').value.trim();
  if (!text) { alert('Paste JSON first'); return; }
  try {
    const configs = JSON.parse(text);
    if (typeof configs !== 'object' || Array.isArray(configs)) throw new Error('Must be an object');
    const res = await authFetch(`${API}/services/${currentServiceId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configs }),
    });
    if (res) { document.getElementById('detailConfigBulk').value = ''; loadDetailConfigs(); }
  } catch (e) { alert(`Invalid JSON: ${e.message}`); }
}

// ── Container (within service detail) ──
async function loadDetailContainer() {
  if (!currentServiceId) return;
  const res = await authFetch(`${API}/services/${currentServiceId}/container`);
  if (!res) return;
  const data = await res.json();
  const content = document.getElementById('detailContainerContent');
  if (data.status === 'unknown' || !data.id) {
    content.innerHTML = '<div class="log-empty">No Docker container found for this service.</div>';
    return;
  }
  content.innerHTML = `
    <div class="container-status-card">
      <div class="container-status-header">
        <span style="font-weight:700">${data.name}</span>
        <span class="badge ${data.status === 'running' ? 'on' : 'off'}">${data.status}</span>
      </div>
      <div class="container-details">
        <div><span class="label">Container ID:</span> <code>${data.id}</code></div>
        <div><span class="label">Image:</span> <code>${data.image}</code></div>
        <div><span class="label">State:</span> ${data.state}</div>
        <div><span class="label">Ports:</span> <code>${(data.ports || []).join(', ') || '-'}</code></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-sm" onclick="containerAction('restart')">🔄 Restart</button>
        <button class="btn btn-sm btn-secondary" onclick="containerAction('start')">▶️ Start</button>
        <button class="btn btn-sm btn-danger" onclick="containerAction('stop')">⏹️ Stop</button>
        <button class="btn btn-sm btn-secondary" onclick="loadContainerLogs()">📋 Logs</button>
      </div>
      <div id="detailContainerLogs" style="margin-top:12px;display:none">
        <div class="section-header">
          <h4 style="color:#94a3b8;font-size:0.85rem;margin:0">Logs</h4>
          <button class="btn btn-xs btn-secondary" onclick="loadContainerLogs()">Refresh</button>
        </div>
        <div class="log-container" id="detailContainerLogsContent"><div class="log-empty">Loading...</div></div>
      </div>
    </div>
  `;
}

async function containerAction(action) {
  if (!currentServiceId) return;
  const res = await authFetch(`${API}/services/${currentServiceId}/container/${action}`, { method: 'POST' });
  if (res) { setTimeout(loadDetailContainer, 1000); }
}

async function loadContainerLogs() {
  if (!currentServiceId) return;
  const res = await authFetch(`${API}/services/${currentServiceId}/container/logs`);
  if (!res) return;
  const data = await res.json();
  const panel = document.getElementById('detailContainerLogs');
  const content = document.getElementById('detailContainerLogsContent');
  if (panel) panel.style.display = 'block';
  if (content) {
    if (!data.logs || data.logs.length === 0) {
      content.innerHTML = '<div class="log-empty">No recent logs.</div>';
    } else {
      content.innerHTML = data.logs.slice(-50).map(l => `<div class="log-entry"><span style="font-family:monospace;font-size:0.75rem;color:#94a3b8">${l}</span></div>`).join('');
    }
  }
}

// ── Activity ──
async function fetchActivityLog() {
  const res = await authFetch(`${API}/activity`);
  if (!res) return;
  const { activity } = await res.json();
  const container = document.getElementById('activityLogContainer');
  if (activity.length === 0) {
    container.innerHTML = '<div class="log-empty">No activity yet.</div>';
    return;
  }
  const icons = { 'route.create':'➕','route.update':'✏️','route.delete':'🗑️','route.toggle':'🔀','service.create':'➕','service.update':'✏️','service.delete':'🗑️','service.toggle':'🔀','service.migrate':'🔄','config.update':'🔐','config.delete':'🗑️','container.restart':'🔄','container.start':'▶️','container.stop':'⏹️' };
  container.innerHTML = activity.map(a => `
    <div class="log-entry">
      <span style="margin-right:6px">${icons[a.action] || '📋'}</span>
      <span style="color:#a78bfa;font-weight:600;font-size:0.75rem">${a.action}</span>
      <span style="color:#94a3b8;margin:0 8px;flex:1">${a.detail || ''}</span>
      <span style="color:#475569;font-size:0.7rem;white-space:nowrap">${new Date(a.ts).toLocaleTimeString()}</span>
    </div>
  `).join('');
}

async function loadDetailActivity() {
  const res = await authFetch(`${API}/activity`);
  if (!res) return;
  const { activity } = await res.json();
  const filtered = activity.filter(a => !currentServiceId || a.detail?.includes(servicesCache.find(x => x.id === currentServiceId)?.name || ''));
  const container = document.getElementById('detailActivityContent');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="log-empty">No recent activity for this service.</div>';
    return;
  }
  const icons = { 'route.create':'➕','route.update':'✏️','route.delete':'🗑️','route.toggle':'🔀','service.create':'➕','service.update':'✏️','service.delete':'🗑️','service.toggle':'🔀','service.migrate':'🔄','config.update':'🔐','config.delete':'🗑️','container.restart':'🔄','container.start':'▶️','container.stop':'⏹️' };
  container.innerHTML = filtered.slice(0, 20).map(a => `
    <div class="log-entry">
      <span style="margin-right:6px">${icons[a.action] || '📋'}</span>
      <span style="color:#a78bfa;font-weight:600;font-size:0.75rem">${a.action}</span>
      <span style="color:#94a3b8;margin:0 8px;flex:1">${a.detail || ''}</span>
      <span style="color:#475569;font-size:0.7rem;white-space:nowrap">${new Date(a.ts).toLocaleTimeString()}</span>
    </div>
  `).join('');
}

// ── Routes ──
async function fetchRoutes() {
  const res = await authFetch(`${API}/routes`);
  if (!res) return;
  const { routes } = await res.json();
  const tbody = document.getElementById('routesBody');
  document.getElementById('statRoutes').textContent = routes.length;
  document.getElementById('statActive').textContent = routes.filter(r => r.enabled).length;
  if (routes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px;">No routes.</td></tr>';
    return;
  }
  tbody.innerHTML = routes.map(r => `
    <tr>
      <td><code>${r.path}</code></td>
      <td>${r.name}</td>
      <td><code>${r.target}</code></td>
      <td><span class="badge ${r.enabled ? 'on' : 'off'}">${r.enabled ? 'Active' : 'Disabled'}</span></td>
      <td>
        <button class="btn btn-xs ${r.enabled ? 'btn-secondary' : 'btn'}" onclick="toggleRoute('${r.path}')">${r.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-xs btn-danger" onclick="deleteRoute('${r.path}')">Delete</button>
      </td>
    </tr>
  `).join('');
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

function showAddRoute() {
  document.getElementById('routePath').value = '';
  document.getElementById('routeTarget').value = '';
  document.getElementById('routeName').value = '';
  document.getElementById('routeDesc').value = '';
  document.getElementById('routeRewriteHtml').checked = false;
  document.getElementById('routeModal').style.display = 'flex';
}

async function saveRoute() {
  const path = document.getElementById('routePath').value.trim();
  const target = document.getElementById('routeTarget').value.trim();
  if (!path || !target) { alert('Path and Target are required'); return; }
  const res = await authFetch(`${API}/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path, target,
      name: document.getElementById('routeName').value.trim(),
      description: document.getElementById('routeDesc').value.trim(),
      rewriteHtml: document.getElementById('routeRewriteHtml').checked === true,
    }),
  });
  if (res) { closeModal('routeModal'); fetchRoutes(); }
}

// ── Request Log ──
async function fetchLog() {
  const res = await authFetch(`${API}/log`);
  if (!res) return;
  const { log } = await res.json();
  document.getElementById('statRequests').textContent = log.length;
}

// ── Health ──
async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`);
    if (res.ok) {
      document.getElementById('healthDot').className = 'status-dot ok';
      document.getElementById('healthText').textContent = 'Connected';
    } else throw new Error();
  } catch {
    document.getElementById('healthDot').className = 'status-dot err';
    document.getElementById('healthText').textContent = 'Disconnected';
  }
}

// ── Modal helpers ──
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

// Close modals on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

// ── Init ──
checkAuth().then(() => {
  fetchServices();
  fetchRoutes();
  fetchLog();
  checkHealth();
  fetchActivityLog();
});
setInterval(fetchServices, 5000);
setInterval(fetchRoutes, 5000);
setInterval(fetchLog, 5000);
setInterval(checkHealth, 10000);
setInterval(fetchActivityLog, 10000);
