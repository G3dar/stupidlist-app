import { getGlobalDefaults, saveGlobalDefaults } from './statusConfig.js';

let overlay = null;

export function init() {
  const btn = document.getElementById('btn-settings');
  if (btn) {
    btn.addEventListener('click', showSettings);
  }
}

function close() {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
}

function showSettings() {
  close();

  overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const dialog = document.createElement('div');
  dialog.className = 'settings-dialog';

  const title = document.createElement('h3');
  title.textContent = 'Settings';
  dialog.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'settings-subtitle';
  subtitle.textContent = 'Default statuses for new lists';
  dialog.appendChild(subtitle);

  const statuses = getGlobalDefaults();
  const statusList = document.createElement('div');
  statusList.className = 'settings-status-list';

  function renderStatuses() {
    statusList.innerHTML = '';
    statuses.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'settings-status-row';

      const icon = document.createElement('span');
      icon.className = 'settings-status-icon';
      icon.textContent = s.icon;

      const label = document.createElement('input');
      label.className = 'settings-status-label';
      label.value = s.label;
      label.addEventListener('change', () => {
        s.label = label.value.trim() || s.label;
      });

      const iconInput = document.createElement('input');
      iconInput.className = 'settings-status-icon-input';
      iconInput.value = s.icon;
      iconInput.maxLength = 2;
      iconInput.addEventListener('change', () => {
        s.icon = iconInput.value || s.icon;
        icon.textContent = s.icon;
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'settings-status-remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', () => {
        statuses.splice(i, 1);
        renderStatuses();
      });

      row.appendChild(icon);
      row.appendChild(label);
      row.appendChild(iconInput);
      row.appendChild(removeBtn);
      statusList.appendChild(row);
    });
  }

  renderStatuses();
  dialog.appendChild(statusList);

  // Add new status
  const addRow = document.createElement('div');
  addRow.className = 'settings-add-row';
  const addInput = document.createElement('input');
  addInput.className = 'settings-add-input';
  addInput.placeholder = '+ New status...';
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && addInput.value.trim()) {
      const name = addInput.value.trim();
      const id = name.toLowerCase().replace(/\s+/g, '_');
      statuses.push({ id, label: name, icon: '○', color: null });
      addInput.value = '';
      renderStatuses();
    }
  });
  addRow.appendChild(addInput);
  dialog.appendChild(addRow);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'settings-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'settings-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'settings-btn settings-btn--primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    saveGlobalDefaults(statuses);
    close();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  dialog.appendChild(actions);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}
