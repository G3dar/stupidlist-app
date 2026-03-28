export function showDeleteConfirm({ name, type, containedLists, onConfirm }) {
  // Remove any existing dialog
  const old = document.querySelector('.delete-confirm-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.className = 'delete-confirm-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'delete-confirm-dialog';

  // Warning icon
  const icon = document.createElement('div');
  icon.className = 'delete-confirm-icon';
  icon.textContent = '\u26A0';
  dialog.appendChild(icon);

  // Title
  const title = document.createElement('h3');
  title.className = 'delete-confirm-title';
  title.textContent = type === 'project' ? 'Delete project?' : 'Delete list?';
  dialog.appendChild(title);

  // Entity name
  const nameEl = document.createElement('p');
  nameEl.className = 'delete-confirm-name';
  nameEl.textContent = name;
  dialog.appendChild(nameEl);

  // Cascade warning for projects with lists
  if (type === 'project' && containedLists && containedLists.length > 0) {
    const warning = document.createElement('div');
    warning.className = 'delete-confirm-warning';

    const p = document.createElement('p');
    p.textContent = `This will also delete ${containedLists.length} list${containedLists.length !== 1 ? 's' : ''}:`;
    warning.appendChild(p);

    const ul = document.createElement('ul');
    ul.className = 'delete-confirm-list-names';
    for (const l of containedLists) {
      const li = document.createElement('li');
      li.textContent = l.name;
      ul.appendChild(li);
    }
    warning.appendChild(ul);
    dialog.appendChild(warning);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'delete-confirm-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'delete-confirm-btn delete-confirm-btn--cancel';
  cancelBtn.textContent = 'Cancel';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-confirm-btn delete-confirm-btn--delete';
  deleteBtn.textContent = 'Delete';

  actions.appendChild(cancelBtn);
  actions.appendChild(deleteBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);

  function dismiss() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') dismiss();
  }

  // Overlay click (outside dialog) dismisses
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      e.stopPropagation();
      dismiss();
    }
  });
  overlay.addEventListener('click', (e) => e.stopPropagation());

  cancelBtn.addEventListener('click', dismiss);
  deleteBtn.addEventListener('click', () => {
    dismiss();
    onConfirm();
  });

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  // Focus cancel for safety
  cancelBtn.focus();
}
