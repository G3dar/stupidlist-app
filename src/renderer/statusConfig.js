import * as storage from './storage.js';

// Hardcoded fallback
const DEFAULT_STATUSES = [
  { id: 'not_started', label: 'Not Started', icon: '○', color: null },
  { id: 'in_progress', label: 'In Progress', icon: '▶', color: '#f59e0b' },
  { id: 'waiting', label: 'Waiting', icon: '⏳', color: '#999' },
  { id: 'tbd', label: 'TBD', icon: '◇', color: '#8b5cf6' },
];

// Get global defaults (from localStorage or hardcoded)
export function getGlobalDefaults() {
  try {
    const saved = localStorage.getItem('defaultStatuses');
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_STATUSES;
}

export function saveGlobalDefaults(statuses) {
  localStorage.setItem('defaultStatuses', JSON.stringify(statuses));
}

// Get statuses for a specific context
export async function getStatusesForList(listId) {
  if (!listId) {
    // Daily view
    try {
      const saved = localStorage.getItem('dayStatuses');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) return parsed;
      }
    } catch {}
    return getGlobalDefaults();
  }

  // Project list — check list metadata
  try {
    const lists = await storage.getListsForProject(null); // can't do this directly
  } catch {}

  // Read list statuses via storage
  // Since we can't easily get a single list by ID, we store per-list in localStorage too
  try {
    const saved = localStorage.getItem(`listStatuses_${listId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.length > 0) return parsed;
    }
  } catch {}

  return getGlobalDefaults();
}

export function saveStatusesForList(listId, statuses) {
  if (!listId) {
    localStorage.setItem('dayStatuses', JSON.stringify(statuses));
  } else {
    localStorage.setItem(`listStatuses_${listId}`, JSON.stringify(statuses));
  }
}

// Get the cycle (just the IDs) for a resolved status list
export function getCycle(statuses) {
  return statuses.map(s => s.id);
}

export function getLabel(statuses, statusId) {
  const found = statuses.find(s => s.id === statusId);
  return found ? found.label : statusId;
}

export function getIcon(statuses, statusId) {
  const found = statuses.find(s => s.id === statusId);
  return found ? found.icon : '○';
}

// Show config popup for a status button
let activePopup = null;

export function closePopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

document.addEventListener('click', (e) => {
  if (activePopup && !activePopup.contains(e.target)) closePopup();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopup();
});

export function showConfigPopup(e, listId, onSave) {
  e.preventDefault();
  e.stopPropagation();
  closePopup();

  // Notify Electron to suppress native menu
  if (window.stupidlist && window.stupidlist.notifyContextMenuHandled) {
    window.stupidlist.notifyContextMenuHandled();
  }

  const currentStatuses = listId
    ? JSON.parse(localStorage.getItem(`listStatuses_${listId}`) || 'null')
    : JSON.parse(localStorage.getItem('dayStatuses') || 'null');

  const defaults = getGlobalDefaults();
  // Determine which statuses are enabled
  const enabledIds = currentStatuses ? currentStatuses.map(s => s.id) : defaults.map(s => s.id);
  const allHidden = currentStatuses && currentStatuses.length === 0;

  const popup = document.createElement('div');
  popup.className = 'status-config-popup';

  const title = document.createElement('div');
  title.className = 'status-config-title';
  title.textContent = 'Status options';
  popup.appendChild(title);

  // "Hide all" option
  const hideRow = document.createElement('label');
  hideRow.className = 'status-config-row';
  const hideCb = document.createElement('input');
  hideCb.type = 'checkbox';
  hideCb.checked = allHidden;
  const hideLabel = document.createElement('span');
  hideLabel.textContent = 'Hide status';
  hideRow.appendChild(hideCb);
  hideRow.appendChild(hideLabel);
  popup.appendChild(hideRow);

  // Individual status checkboxes
  const rows = [];
  for (const status of defaults) {
    const row = document.createElement('label');
    row.className = 'status-config-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !allHidden && enabledIds.includes(status.id);
    cb.disabled = allHidden;
    cb.dataset.statusId = status.id;

    const icon = document.createElement('span');
    icon.className = 'status-config-icon';
    icon.textContent = status.icon;
    const label = document.createElement('span');
    label.textContent = status.label;

    row.appendChild(cb);
    row.appendChild(icon);
    row.appendChild(label);
    popup.appendChild(row);
    rows.push({ cb, status });
  }

  // Hide toggle disables/enables individual checkboxes
  hideCb.addEventListener('change', () => {
    rows.forEach(r => {
      r.cb.disabled = hideCb.checked;
      if (hideCb.checked) r.cb.checked = false;
    });
  });

  // Add custom status input
  const addRow = document.createElement('div');
  addRow.className = 'status-config-row';
  const addInput = document.createElement('input');
  addInput.className = 'status-config-add';
  addInput.placeholder = '+ New status...';
  addInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && addInput.value.trim()) {
      ev.stopPropagation();
      const name = addInput.value.trim();
      const id = name.toLowerCase().replace(/\s+/g, '_');
      const newStatus = { id, label: name, icon: '○', color: null };

      const row = document.createElement('label');
      row.className = 'status-config-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.statusId = id;
      const icon = document.createElement('span');
      icon.className = 'status-config-icon';
      icon.textContent = '○';
      const label = document.createElement('span');
      label.textContent = name;
      row.appendChild(cb);
      row.appendChild(icon);
      row.appendChild(label);
      popup.insertBefore(row, addRow);
      rows.push({ cb, status: newStatus });

      addInput.value = '';
    }
  });
  addRow.appendChild(addInput);
  popup.appendChild(addRow);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'status-config-save';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    let result;
    if (hideCb.checked) {
      result = [];
    } else {
      result = rows.filter(r => r.cb.checked).map(r => r.status);
    }
    saveStatusesForList(listId, result);
    closePopup();
    onSave(result);
  });
  popup.appendChild(saveBtn);

  // Position to the left of the click point
  document.body.appendChild(popup);
  const rect = popup.getBoundingClientRect();
  let left = e.clientX - rect.width;
  let top = e.clientY;

  if (left < 8) left = 8;
  if (top + rect.height > window.innerHeight) {
    top = window.innerHeight - rect.height - 8;
  }
  if (top < 8) top = 8;

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  activePopup = popup;
}
