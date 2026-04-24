import * as storage from './storage.js';

let overlayEl = null;

export function open({ existing = null, onSave, onDelete = null }) {
  close();

  const selectedProjectIds = new Set();
  const selectedListIds = new Set();
  const expandedProjectIds = new Set();

  if (existing && Array.isArray(existing.selections)) {
    for (const sel of existing.selections) {
      if (sel.kind === 'project' && sel.projectId) {
        selectedProjectIds.add(sel.projectId);
      } else if (sel.kind === 'list' && sel.listId) {
        selectedListIds.add(sel.listId);
      }
    }
  }

  overlayEl = document.createElement('div');
  overlayEl.className = 'multi-selector-overlay';

  const modal = document.createElement('div');
  modal.className = 'multi-selector-modal';

  const title = document.createElement('h3');
  title.className = 'multi-selector-title';
  title.textContent = existing ? 'Edit Custom View' : 'New Custom View';
  modal.appendChild(title);

  const nameInput = document.createElement('input');
  nameInput.className = 'multi-selector-name';
  nameInput.type = 'text';
  nameInput.placeholder = 'View name...';
  nameInput.value = existing ? (existing.name || '') : '';
  modal.appendChild(nameInput);

  const body = document.createElement('div');
  body.className = 'multi-selector-body';
  modal.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'multi-selector-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'multi-selector-btn multi-selector-btn--cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);
  actions.appendChild(cancelBtn);

  if (existing && onDelete) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'multi-selector-btn multi-selector-btn--delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await onDelete(existing);
      close();
    });
    actions.appendChild(deleteBtn);
  }

  const saveBtn = document.createElement('button');
  saveBtn.className = 'multi-selector-btn multi-selector-btn--save';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim() || 'Untitled view';
    const selections = buildSelections(selectedProjectIds, selectedListIds);
    if (selections.length === 0) return;
    await onSave(name, selections);
    close();
  });
  actions.appendChild(saveBtn);
  modal.appendChild(actions);

  overlayEl.appendChild(modal);

  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) close();
  });

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlayEl);

  renderBody(body, {
    selectedProjectIds,
    selectedListIds,
    expandedProjectIds
  });

  setTimeout(() => nameInput.focus(), 0);
}

function onKey(e) {
  if (e.key === 'Escape') close();
}

export function close() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  document.removeEventListener('keydown', onKey);
}

async function renderBody(body, state) {
  body.innerHTML = '<div class="multi-selector-loading">Loading...</div>';

  const [projects, standaloneLists] = await Promise.all([
    storage.getAllProjects(),
    storage.getStandaloneLists()
  ]);

  const listsByProject = new Map();
  for (const p of projects) {
    const lists = await storage.getListsForProject(p.id);
    listsByProject.set(p.id, lists);
  }

  body.innerHTML = '';

  // Standalone lists section
  const visibleStandalone = standaloneLists.filter(l => l.name || 'Untitled list');
  if (visibleStandalone.length > 0) {
    const section = document.createElement('div');
    section.className = 'multi-selector-section';
    const header = document.createElement('div');
    header.className = 'multi-selector-section-header';
    header.textContent = 'Lists';
    section.appendChild(header);

    for (const list of visibleStandalone) {
      const row = buildListRow(list, state, () => renderBody(body, state));
      section.appendChild(row);
    }
    body.appendChild(section);
  }

  // Projects section
  if (projects.length > 0) {
    const section = document.createElement('div');
    section.className = 'multi-selector-section';
    const header = document.createElement('div');
    header.className = 'multi-selector-section-header';
    header.textContent = 'Projects';
    section.appendChild(header);

    for (const project of projects) {
      const lists = listsByProject.get(project.id) || [];
      const projectRow = buildProjectRow(project, lists, state, () => renderBody(body, state));
      section.appendChild(projectRow);
    }
    body.appendChild(section);
  }

  if (projects.length === 0 && visibleStandalone.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'multi-selector-empty';
    empty.textContent = 'No projects or lists yet';
    body.appendChild(empty);
  }
}

function buildListRow(list, state, rerender) {
  const row = document.createElement('label');
  row.className = 'multi-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'multi-row-checkbox';
  checkbox.checked = state.selectedListIds.has(list.id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) state.selectedListIds.add(list.id);
    else state.selectedListIds.delete(list.id);
  });

  const name = document.createElement('span');
  name.className = 'multi-row-name';
  name.textContent = list.name || 'Untitled list';

  row.appendChild(checkbox);
  row.appendChild(name);
  return row;
}

function buildProjectRow(project, lists, state, rerender) {
  const wrap = document.createElement('div');
  wrap.className = 'multi-row-project';

  const row = document.createElement('div');
  row.className = 'multi-row multi-row--project';

  const expandBtn = document.createElement('button');
  expandBtn.className = 'multi-row-expand';
  const expanded = state.expandedProjectIds.has(project.id);
  expandBtn.textContent = expanded ? '▾' : '▸';
  expandBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (expanded) state.expandedProjectIds.delete(project.id);
    else state.expandedProjectIds.add(project.id);
    rerender();
  });

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'multi-row-checkbox';

  const isWholeProject = state.selectedProjectIds.has(project.id);
  const partialListIds = lists.filter(l => state.selectedListIds.has(l.id));
  const hasPartial = partialListIds.length > 0;

  if (isWholeProject) {
    checkbox.checked = true;
    checkbox.indeterminate = false;
  } else if (hasPartial) {
    checkbox.checked = false;
    checkbox.indeterminate = true;
  } else {
    checkbox.checked = false;
    checkbox.indeterminate = false;
  }

  checkbox.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isWholeProject || hasPartial) {
      state.selectedProjectIds.delete(project.id);
      for (const l of lists) state.selectedListIds.delete(l.id);
    } else {
      state.selectedProjectIds.add(project.id);
      for (const l of lists) state.selectedListIds.delete(l.id);
    }
    rerender();
  });

  const name = document.createElement('span');
  name.className = 'multi-row-name';
  name.textContent = project.name || 'Untitled project';
  name.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    checkbox.click();
  });

  row.appendChild(expandBtn);
  row.appendChild(checkbox);
  row.appendChild(name);
  wrap.appendChild(row);

  if (expanded) {
    const subWrap = document.createElement('div');
    subWrap.className = 'multi-row-children';
    for (const list of lists) {
      const subRow = document.createElement('label');
      subRow.className = 'multi-row multi-row--sublist';

      const subCheckbox = document.createElement('input');
      subCheckbox.type = 'checkbox';
      subCheckbox.className = 'multi-row-checkbox';
      subCheckbox.checked = isWholeProject || state.selectedListIds.has(list.id);
      subCheckbox.addEventListener('change', (e) => {
        e.stopPropagation();
        if (isWholeProject) {
          // Explode: switch from project-level to per-list selection, keeping all except the toggled one.
          state.selectedProjectIds.delete(project.id);
          for (const l of lists) {
            if (l.id !== list.id) state.selectedListIds.add(l.id);
          }
          if (subCheckbox.checked) state.selectedListIds.add(list.id);
          rerender();
          return;
        }
        if (subCheckbox.checked) state.selectedListIds.add(list.id);
        else state.selectedListIds.delete(list.id);
        rerender();
      });

      const subName = document.createElement('span');
      subName.className = 'multi-row-name';
      subName.textContent = list.name || 'Untitled list';

      subRow.appendChild(subCheckbox);
      subRow.appendChild(subName);
      subWrap.appendChild(subRow);
    }
    wrap.appendChild(subWrap);
  }

  return wrap;
}

function buildSelections(selectedProjectIds, selectedListIds) {
  const out = [];
  for (const projectId of selectedProjectIds) {
    out.push({ kind: 'project', projectId });
  }
  for (const listId of selectedListIds) {
    out.push({ kind: 'list', listId });
  }
  return out;
}
