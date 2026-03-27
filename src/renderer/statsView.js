import * as storage from './storage.js';
import { onAuthChange, getUid } from './auth.js';

export async function load() {
  // Hide normal UI
  const header = document.getElementById('header');
  const carryOver = document.getElementById('carry-over');
  if (header) header.style.display = 'none';
  if (carryOver) carryOver.style.display = 'none';

  const container = document.getElementById('list-container');
  container.innerHTML = '<div class="stats-loading">Loading...</div>';

  // Wait for auth
  await new Promise((resolve) => {
    onAuthChange((user) => resolve(user));
  });

  const uid = getUid();
  if (!uid) {
    container.innerHTML = '<div class="stats-error">Sign in required.</div>';
    return;
  }

  let logins;
  try {
    logins = await storage.getAllLogins();
  } catch (err) {
    container.innerHTML = '<div class="stats-error">Access denied.</div>';
    return;
  }

  render(container, logins);
}

function render(container, logins) {
  const total = logins.length;

  // New users per day (from createdAt)
  const newPerDay = {};
  logins.forEach(u => {
    const d = u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : 'unknown';
    newPerDay[d] = (newPerDay[d] || 0) + 1;
  });
  const newDays = Object.entries(newPerDay).filter(([d]) => d !== 'unknown').sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);

  // Daily active (from loginDays arrays)
  const activePerDay = {};
  logins.forEach(u => {
    (u.loginDays || []).forEach(d => {
      activePerDay[d] = (activePerDay[d] || 0) + 1;
    });
  });
  const activeDays = Object.entries(activePerDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30);

  const maxNew = Math.max(...newDays.map(([, c]) => c), 1);
  const maxActive = Math.max(...activeDays.map(([, c]) => c), 1);

  let html = `
    <div class="stats-page">
      <div class="stats-header">
        <h1>STATS</h1>
        <a href="/" class="stats-back">&larr; back</a>
      </div>

      <div class="stats-big-number">${total} <span class="stats-label">total users</span></div>

      <div class="stats-charts">
        <div class="stats-chart">
          <h2>NEW USERS</h2>
          ${newDays.map(([day, count]) =>
            `<div class="stats-bar-row">
              <span class="stats-day">${fmtDate(day)}</span>
              <span class="stats-bar" style="width:${(count / maxNew) * 120}px"></span>
              <span class="stats-count">${count}</span>
            </div>`
          ).join('')}
        </div>
        <div class="stats-chart">
          <h2>DAILY ACTIVE</h2>
          ${activeDays.map(([day, count]) =>
            `<div class="stats-bar-row">
              <span class="stats-day">${fmtDate(day)}</span>
              <span class="stats-bar" style="width:${(count / maxActive) * 120}px"></span>
              <span class="stats-count">${count}</span>
            </div>`
          ).join('')}
        </div>
      </div>

      <div class="stats-table-section">
        <h2>USERS</h2>
        <table class="stats-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Timezone</th>
              <th>Platform</th>
              <th>Screen</th>
              <th>Language</th>
              <th>Created</th>
              <th>Last active</th>
              <th>Logins</th>
            </tr>
          </thead>
          <tbody>
            ${logins.sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0)).map(u => `
              <tr>
                <td>${esc(u.displayName || '—')}</td>
                <td>${esc(u.email || '—')}</td>
                <td>${esc(shortTz(u.timezone))}</td>
                <td>${esc(parsePlatform(u.userAgent, u.platform))}</td>
                <td>${esc(u.screenSize || '—')}</td>
                <td>${esc(u.language || '—')}</td>
                <td>${u.createdAt ? fmtDate(new Date(u.createdAt).toISOString().slice(0, 10)) : '—'}</td>
                <td>${u.lastLoginAt ? fmtRelative(u.lastLoginAt) : '—'}</td>
                <td>${u.loginCount || 0}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtRelative(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return fmtDate(new Date(ts).toISOString().slice(0, 10));
}

function shortTz(tz) {
  if (!tz) return '—';
  return tz.replace('America/', '').replace('Europe/', '').replace('Asia/', '').replace('Australia/', '').replace('Africa/', '').replace('Pacific/', '');
}

function parsePlatform(ua, platform) {
  if (!ua) return platform || '—';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('Android')) return 'Android';
  return platform || '—';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
