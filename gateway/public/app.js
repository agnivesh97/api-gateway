const API = '/__gw';
let servicesCache = [];
let currentConfigServiceId = null;
let currentContainerServiceId = null;

// ============================================================
// Auth
// ============================================================
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

async function handleLogout() {
  await fetch(`${API}/logout`, { method: 'POST' });
  window.location.href = '/login.html';
}

async function authFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  return res;
}

// ============================================================
// Tab Switching
// ============================================================
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  // Show/hide tab content
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = el.id === `tab-${tabName}` ? 'block' : 'none';
  });
  // Refresh active tab data
  if (tabName === 'services') fetchServices();
  if (tabName === 'config') populateServiceDropdowns();
  if (tabName === 'container') populateContainerDropdowns();
}

// ============================================================
// ROUTES (existing, unchanged)
// ============================================================
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

function showAddRoute() {
  document.getElementById('routePath').value = '';
  document.getElementById('routeTarget').value = '';
  document.getElementById('routeName').value = '';
  document.getElementById('routeDesc').value = '';
  document.getElementById('routeRewriteHtml').checked = false;
  document.getElementById('routeModal').style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
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
    closeModal('routeModal');
    fetchRoutes();
  }
}

// ============================================================
// SERVICES
// ============================================================
async function fetchServices() {
  const res = await authFetch(`${API}/services`);
  if (!res) return;
  const { services } = await res.json();
  servicesCache = services;
  renderServices(services);
  document.getElementById('statServices').textContent = services.length;
  renderApps(services);
}

function renderApps(services) {
  const container = document.getElementById('appsContainer');
  if (!container) return;
  const enabledServices = services.filter(s => s.enabled);
  if (enabledServices.length === 0) {
    container.innerHTML = '<div class="log-empty">No active apps. Register one in the Services tab.</div>';
    return;
  }
  container.innerHTML = enabledServices.map(s => `
    <div class="service-card">
      <div class="service-header">
        <span class="service-name">${s.name}</span>
        <span class="badge on">Active</span>
      </div>
      <div class="service-details">
        <div><span class="label">URL:</span> <code>${window.location.origin}${s.prefix}</code></div>
        <div><span class="label">Target:</span> <code>${s.target}</code></div>
        <div><span class="label">Description:</span> ${s.description || '-'}</div>
      </div>
      <div class="service-actions">
        <button class="btn btn-primary" onclick="openApp('${s.prefix}', '${s.name}')" style="padding:8px 20px;font-size:0.9rem">🚀 Open</button>
        <button class="btn btn-xs btn-secondary" onclick="window.open('${s.prefix}', '_blank')">↗️ New Tab</button>
      </div>
    </div>
  `).join('');
}

function openApp(prefix, name) {
  const viewer = document.getElementById('appViewer');
  const frame = document.getElementById('appViewerFrame');
  const title = document.getElementById('appViewerTitle');
  if (viewer && frame && title) {
    title.textContent = name || 'App';
    frame.src = prefix;
    viewer.style.display = 'block';
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function closeAppViewer() {
  const viewer = document.getElementById('appViewer');
  const frame = document.getElementById('appViewerFrame');
  if (viewer && frame) {
    frame.src = 'about:blank';
    viewer.style.display = 'none';
  }
}

function renderServices(services) {
  const container = document.getElementById('servicesContainer');
  if (services.length === 0) {
    container.innerHTML = '<div class="log-empty">No services registered. Click "Add Service" to register one, or use "Migrate Routes" to convert existing routes.</div>';
    return;
  }
  container.innerHTML = services.map(s => `
    <div class="service-card ${s.enabled ? '' : 'disabled'}">
      <div class="service-header">
        <span class="service-name">${s.name}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge ${s.enabled ? 'on' : 'off'}">${s.enabled ? 'Active' : 'Disabled'}</span>
          <span class="badge" style="background:#3b82f620;color:#3b82f6;border:1px solid #3b82f640">${s.config_count || 0} configs</span>
        </div>
      </div>
      <div class="service-details">
        <div><span class="label">Prefix:</span> <code>${s.prefix}</code></div>
        <div><span class="label">Target:</span> <code>${s.target}</code></div>
        <div><span class="label">Docker:</span> <code>${s.docker_service || '-'}</code></div>
        <div><span class="label">Description:</span> ${s.description || '-'}</div>
        <div><span class="label">Created:</span> <span style="color:#94a3b8;font-size:0.8rem">${s.created_at || '-'}</span></div>
      </div>
      <div class="service-actions">
        <button class="btn btn-xs btn-primary" onclick="openApp('${s.prefix}', '${s.name}')">🚀 Open</button>
        <button class="btn btn-xs btn-secondary" onclick="window.open('${s.prefix}', '_blank')">↗️ New Tab</button>
        <button class="btn btn-xs btn-secondary" onclick="editService('${s.id}')">✏️ Edit</button>
        <button class="btn btn-xs ${s.enabled ? 'btn-secondary' : 'btn'}" onclick="toggleService('${s.id}')">${s.enabled ? 'Disable' : 'Enable'}</button>
        <button class="btn btn-xs btn-danger" onclick="deleteService('${s.id}')">Delete</button>
        <button class="btn btn-xs btn-secondary" onclick="switchToConfig('${s.id}')">🔐 Config</button>
        <button class="btn btn-xs btn-secondary" onclick="switchToContainer('${s.id}')">🐳 Docker</button>
      </div>
    </div>
  `).join('');
}

function showAddService() {
  document.getElementById('serviceName').value = '';
  document.getElementById('servicePrefix').value = '';
  document.getElementById('serviceTarget').value = '';
  document.getElementById('serviceDocker').value = '';
  document.getElementById('serviceDesc').value = '';
  document.getElementById('serviceRewriteHtml').checked = false;
  document.getElementById('serviceModal').style.display = 'flex';
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
      name,
      prefix,
      target,
      docker_service: document.getElementById('serviceDocker').value.trim(),
      description: document.getElementById('serviceDesc').value.trim(),
      rewrite_html: document.getElementById('serviceRewriteHtml').checked === true,
    }),
  });
  if (res) {
    closeModal('serviceModal');
    fetchServices();
    populateServiceDropdowns();
    populateContainerDropdowns();
  }
}

async function editService(id) {
  const service = servicesCache.find(s => s.id === id);
  if (!service) return;
  document.getElementById('serviceName').value = service.name;
  document.getElementById('servicePrefix').value = service.prefix;
  document.getElementById('serviceTarget').value = service.target;
  document.getElementById('serviceDocker').value = service.docker_service || '';
  document.getElementById('serviceDesc').value = service.description || '';
  document.getElementById('serviceRewriteHtml').checked = service.rewrite_html === 1;

  // Change modal to update mode
  const modal = document.getElementById('serviceModal');
  const title = modal.querySelector('h3');
  title.textContent = 'Edit Service';
  const saveBtn = modal.querySelector('.btn:last-child');
  saveBtn.textContent = 'Update';
  saveBtn.onclick = async () => {
    const res = await authFetch(`${API}/services/${id}`, {
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
    if (res) {
      closeModal('serviceModal');
      resetServiceModal();
      fetchServices();
      populateServiceDropdowns();
      populateContainerDropdowns();
    }
  };
  modal.style.display = 'flex';
}

function resetServiceModal() {
  const modal = document.getElementById('serviceModal');
  modal.querySelector('h3').textContent = 'Register Service';
  const saveBtn = modal.querySelector('.btn:last-child');
  saveBtn.textContent = 'Save';
  saveBtn.onclick = saveService;
}

async function toggleService(id) {
  const res = await authFetch(`${API}/services/${id}/toggle`, { method: 'PATCH' });
  if (res) fetchServices();
}

async function deleteService(id) {
  if (!confirm(`Delete service "${servicesCache.find(s => s.id === id)?.name}"?`)) return;
  const res = await authFetch(`${API}/services/${id}`, { method: 'DELETE' });
  if (res) {
    fetchServices();
    populateServiceDropdowns();
    populateContainerDropdowns();
  }
}

async function migrateRoutes() {
  if (!confirm('This will create service entries from existing routes. Continue?')) return;
  const res = await authFetch(`${API}/services/migrate`, { method: 'POST' });
  if (res) {
    const data = await res.json();
    alert(`✅ Migration complete! Created ${data.created} services from ${data.total} target groups.`);
    fetchServices();
    populateServiceDropdowns();
    populateContainerDropdowns();
  }
}

function switchToConfig(serviceId) {
  switchTab('config');
  const dropdown = document.getElementById('configServiceDropdown');
  dropdown.value = serviceId;
  loadConfigs();
}

function switchToContainer(serviceId) {
  switchTab('container');
  const dropdown = document.getElementById('containerServiceDropdown');
  dropdown.value = serviceId;
  loadContainer();
}

// ============================================================
// CONFIGS
// ============================================================
function populateServiceDropdowns() {
  const configDropdown = document.getElementById('configServiceDropdown');
  const containerDropdown = document.getElementById('containerServiceDropdown');
  const services = servicesCache;

  const renderOptions = (dropdown) => {
    const currentVal = dropdown.value;
    dropdown.innerHTML = '<option value="">-- Select a service --</option>';
    services.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.prefix})`;
      dropdown.appendChild(opt);
    });
    if (currentVal && services.some(s => s.id === currentVal)) dropdown.value = currentVal;
  };

  renderOptions(configDropdown);
  renderOptions(containerDropdown);
}

async function loadConfigs() {
  const serviceId = document.getElementById('configServiceDropdown').value;
  if (!serviceId) {
    document.getElementById('configPanel').style.display = 'none';
    return;
  }
  currentConfigServiceId = serviceId;
  const service = servicesCache.find(s => s.id === serviceId);
  document.getElementById('configServiceName').textContent = `Configurations: ${service?.name || serviceId}`;

  const res = await authFetch(`${API}/services/${serviceId}/config`);
  if (!res) return;
  const { configs } = await res.json();
  renderConfigs(configs);
  document.getElementById('configPanel').style.display = 'block';
}

function renderConfigs(configs) {
  const tbody = document.getElementById('configsBody');
  if (configs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px;">No configurations set. Add one below.</td></tr>';
    return;
  }
  tbody.innerHTML = configs.map(c => `
    <tr>
      <td><code>${c.key}</code></td>
      <td><code style="color:#64748b">${c.is_secret ? '••••••••' : c.value}</code></td>
      <td><span class="badge ${c.is_secret ? 'on' : 'off'}" style="font-size:0.7rem">${c.is_secret ? 'Secret' : 'Plain'}</span></td>
      <td style="color:#64748b;font-size:0.8rem">${c.updated_at || c.created_at || '-'}</td>
      <td>
        <button class="btn btn-xs btn-secondary" onclick="editConfig('${c.key}', '${c.value.replace(/'/g, "\\'")}', ${c.is_secret})">✏️ Edit</button>
        <button class="btn btn-xs btn-danger" onclick="deleteConfig('${c.key}')">Delete</button>
      </td>
    </tr>
  `).join('');
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
  document.getElementById('configKey').disabled = true; // can't change key, delete+recreate instead
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
  const res = await authFetch(`${API}/services/${currentConfigServiceId}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res) {
    closeModal('configModal');
    loadConfigs();
  }
}

async function deleteConfig(key) {
  if (!confirm(`Delete config key "${key}"?`)) return;
  const res = await authFetch(`${API}/services/${currentConfigServiceId}/config/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (res) loadConfigs();
}

async function bulkImportConfigs() {
  const text = document.getElementById('configBulkInput').value.trim();
  if (!text) { alert('Paste JSON first'); return; }
  try {
    const configs = JSON.parse(text);
    if (typeof configs !== 'object' || Array.isArray(configs)) throw new Error('Must be a JSON object');
    const res = await authFetch(`${API}/services/${currentConfigServiceId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configs }),
    });
    if (res) {
      alert('✅ Configs imported!');
      document.getElementById('configBulkInput').value = '';
      loadConfigs();
    }
  } catch (err) {
    alert(`Invalid JSON: ${err.message}`);
  }
}

// ============================================================
// CONTAINER
// ============================================================
function populateContainerDropdowns() {
  // Already handled by populateServiceDropdowns via shared servicesCache
  // Just ensure the container dropdown is populated
  const dropdown = document.getElementById('containerServiceDropdown');
  const currentVal = dropdown.value;
  dropdown.innerHTML = '<option value="">-- Select a service --</option>';
  servicesCache.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.prefix})${s.docker_service ? ' 🐳' : ''}`;
    dropdown.appendChild(opt);
  });
  if (currentVal && servicesCache.some(s => s.id === currentVal)) dropdown.value = currentVal;
}

async function loadContainer() {
  const serviceId = document.getElementById('containerServiceDropdown').value;
  if (!serviceId) {
    document.getElementById('containerPanel').style.display = 'none';
    return;
  }
  currentContainerServiceId = serviceId;
  const service = servicesCache.find(s => s.id === serviceId);
  if (!service) return;

  document.getElementById('containerPanel').style.display = 'block';
  document.getElementById('containerName').textContent = service.name;

  const res = await authFetch(`${API}/services/${serviceId}/container`);
  if (!res) return;

  // Hide logs panel when switching services
  document.getElementById('containerLogsPanel').style.display = 'none';

  const data = await res.json();
  if (data.status === 'unknown' || data.error) {
    document.getElementById('containerId').textContent = data.message || 'No container found';
    document.getElementById('containerImage').textContent = '-';
    document.getElementById('containerState').textContent = 'N/A';
    document.getElementById('containerPorts').textContent = '-';
    const badge = document.getElementById('containerStatusBadge');
    badge.textContent = 'Unknown';
    badge.className = 'badge off';
    return;
  }

  document.getElementById('containerId').textContent = data.id || '-';
  document.getElementById('containerImage').textContent = data.image || '-';
  document.getElementById('containerState').textContent = data.state || '-';
  document.getElementById('containerPorts').textContent = (data.ports || []).join(', ') || '-';

  const badge = document.getElementById('containerStatusBadge');
  const isRunning = data.status === 'running';
  badge.textContent = isRunning ? 'Running' : data.status || 'Unknown';
  badge.className = `badge ${isRunning ? 'on' : 'off'}`;

  // Enable/disable buttons based on state
  document.getElementById('containerStartBtn').disabled = isRunning;
  document.getElementById('containerStopBtn').disabled = !isRunning;
  document.getElementById('containerRestartBtn').disabled = !isRunning;
}

async function containerAction(action) {
  if (!currentContainerServiceId) return;
  const actions = {
    restart: 'restart this container',
    start: 'start this container',
    stop: 'stop this container',
  };
  if (!confirm(`Are you sure you want to ${actions[action] || action}?`)) return;

  const res = await authFetch(`${API}/services/${currentContainerServiceId}/container/${action}`, { method: 'POST' });
  if (res) {
    const data = await res.json();
    alert(data.message || `${action} command sent`);
    setTimeout(loadContainer, 1000);
  }
}

async function loadContainerLogs() {
  if (!currentContainerServiceId) return;
  const panel = document.getElementById('containerLogsPanel');
  const content = document.getElementById('containerLogsContent');
  panel.style.display = 'block';
  content.innerHTML = '<div class="log-empty">Loading logs...</div>';

  const res = await authFetch(`${API}/services/${currentContainerServiceId}/container/logs`);
  if (!res) return;
  const data = await res.json();
  const logs = data.logs || [];
  if (logs.length === 0) {
    content.innerHTML = '<div class="log-empty">No logs available.</div>';
    return;
  }
  content.innerHTML = logs.map(line => `<div class="log-entry"><span style="color:#94a3b8">${line}</span></div>`).join('');
}

// ============================================================
// REQUEST LOG
// ============================================================
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

// ============================================================
// HEALTH
// ============================================================
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

// ============================================================
// ACTIVITY LOG
// ============================================================
async function fetchActivityLog() {
  const res = await authFetch(`${API}/activity`);
  if (!res) return;
  const { activity } = await res.json();
  renderActivityLog(activity);
}

function renderActivityLog(activity) {
  const container = document.getElementById('activityLogContainer');
  if (!container) return;
  if (activity.length === 0) {
    container.innerHTML = '<div class="log-empty">No activity yet. Make changes to routes, services, or configs and they\'ll appear here.</div>';
    return;
  }
  container.innerHTML = activity.map(a => {
    const icons = {
      'route.create': '➕', 'route.update': '✏️', 'route.delete': '🗑️', 'route.toggle': '🔀',
      'service.create': '➕', 'service.update': '✏️', 'service.delete': '🗑️', 'service.toggle': '🔀', 'service.migrate': '🔄',
      'config.update': '🔐', 'config.delete': '🗑️',
      'container.restart': '🔄', 'container.start': '▶️', 'container.stop': '⏹️',
    };
    const icon = icons[a.action] || '📋';
    return `<div class="log-entry">
      <span style="margin-right:8px">${icon}</span>
      <span style="color:#a78bfa;font-weight:600;font-size:0.75rem">${a.action}</span>
      <span style="color:#94a3b8;margin:0 8px">${a.detail || ''}</span>
      <span style="color:#475569;font-size:0.7rem;margin-left:auto;white-space:nowrap">${new Date(a.ts).toLocaleTimeString()}</span>
    </div>`;
  }).join('');
}

// ============================================================
// INIT
// ============================================================
checkAuth().then(() => {
  fetchRoutes();
  fetchServices();
  fetchLog();
  checkHealth();
});
setInterval(fetchRoutes, 5000);
setInterval(fetchServices, 5000);
setInterval(fetchLog, 5000);
setInterval(checkHealth, 10000);
