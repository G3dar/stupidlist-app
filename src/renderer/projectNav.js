import * as storage from './storage.js';
import { authState } from './auth.js';
import * as undoManager from './undoManager.js';
import { showDeleteConfirm } from './deleteConfirm.js';
import { hapticFeedback } from '../shared/platform.js';
import * as multiSelector from './multiSelector.js';

let onProjectSelect = null;
let onListSelect = null;
let onMoveList = null;
let onBack = null;
let onCustomViewSelect = null;
let dropdownVisible = false;

function addLongPress(element, callback) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  element.addEventListener('contextmenu', (e) => e.preventDefault());
  element.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    timer = setTimeout(() => {
      element._longPressed = true;
      window.getSelection().removeAllRanges();
      hapticFeedback();
      callback(touch.clientX, touch.clientY);
    }, 500);
  }, { passive: true });
  element.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (Math.sqrt((touch.clientX - startX) ** 2 + (touch.clientY - startY) ** 2) > 10) clearTimeout(timer);
  }, { passive: true });
  element.addEventListener('touchend', () => clearTimeout(timer));
  element.addEventListener('touchcancel', () => clearTimeout(timer));
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function init(callbacks) {
  onProjectSelect = callbacks.onProjectSelect;
  onListSelect = callbacks.onListSelect;
  onMoveList = callbacks.onMoveList;
  onBack = callbacks.onBack;
  onCustomViewSelect = callbacks.onCustomViewSelect;

  document.getElementById('btn-projects').addEventListener('click', toggleDropdown);

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (dropdownVisible && !e.target.closest('#projects-dropdown') && !e.target.closest('#btn-projects')) {
      hideDropdown();
    }
  });
}

export async function toggleDropdown() {
  if (dropdownVisible) {
    hideDropdown();
  } else {
    await showDropdown();
  }
}

function hideDropdown() {
  dropdownVisible = false;
  const dd = document.getElementById('projects-dropdown');
  dd.style.display = 'none';
  document.getElementById('btn-projects').classList.remove('active');
}

async function showDropdown() {
  dropdownVisible = true;
  document.getElementById('btn-projects').classList.add('active');

  const dd = document.getElementById('projects-dropdown');
  dd.style.display = 'block';
  dd.innerHTML = '';

  const projects = await storage.getAllProjects();

  for (const project of projects) {
    const lists = await storage.getListsForProject(project.id);

    let totalItems = 0;
    let lastUpdated = project.updatedAt || 0;
    for (const list of lists) {
      const items = await storage.getItemsForList(list.id);
      totalItems += items.filter(i => !i.isSpacer && (i.text || '').trim() !== '').length;
      if (list.updatedAt > lastUpdated) lastUpdated = list.updatedAt;
      for (const item of items) {
        if (item.updatedAt > lastUpdated) lastUpdated = item.updatedAt;
      }
    }

    const row = document.createElement('div');
    row.className = 'project-row';

    const name = document.createElement('span');
    name.className = 'project-row-name';
    name.textContent = project.name;

    const count = document.createElement('span');
    count.className = 'project-row-count';
    if (totalItems === 0) {
      count.textContent = `${lists.length} list${lists.length !== 1 ? 's' : ''} · empty`;
      count.classList.add('project-row-count--empty');
      row.classList.add('project-row--empty');
    } else {
      count.textContent = `${lists.length} list${lists.length !== 1 ? 's' : ''} · ${totalItems} item${totalItems !== 1 ? 's' : ''}`;
    }

    const updated = document.createElement('span');
    updated.className = 'project-row-updated';
    updated.textContent = lastUpdated ? timeAgo(lastUpdated) : '';

    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(updated);

    row.addEventListener('click', () => {
      if (row._longPressed) { row._longPressed = false; return; }
      hideDropdown();
      onProjectSelect(project.id, lists.length > 0 ? lists[0].id : null);
    });

    // Right-click to delete
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showDeleteConfirm({
        name: project.name,
        type: 'project',
        containedLists: lists.map(l => ({ name: l.name })),
        onConfirm: () => performDeleteProject(project)
      });
    });

    // Long-press to show delete confirm (mobile)
    addLongPress(row, (cx, cy) => {
      showDeleteConfirm({
        name: project.name,
        type: 'project',
        containedLists: lists.map(l => ({ name: l.name })),
        onConfirm: () => performDeleteProject(project)
      });
    });

    // Middle-click to delete
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      showDeleteConfirm({
        name: project.name,
        type: 'project',
        containedLists: lists.map(l => ({ name: l.name })),
        onConfirm: () => performDeleteProject(project)
      });
    });

    dd.appendChild(row);
  }

  // Custom Views section
  const customViews = await storage.getAllCustomViews();
  if (customViews.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'projects-dropdown-sep';
    dd.appendChild(sep);

    for (const view of customViews) {
      const row = buildCustomViewRow(view);
      dd.appendChild(row);
    }
  }

  // "+ Multi..." button to create a new custom view
  const multiBtn = document.createElement('div');
  multiBtn.className = 'projects-dropdown-multi-btn';
  multiBtn.textContent = '+ Multi view...';
  multiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideDropdown();
    openMultiSelector(null);
  });
  dd.appendChild(multiBtn);

  // New project input
  const input = document.createElement('input');
  input.className = 'new-project-input';
  input.placeholder = '+ New project...';
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      const project = await storage.addProject(input.value.trim());
      const lists = await storage.getListsForProject(project.id);
      undoManager.startBatch('create project');
      undoManager.push({ type: 'create', entityType: 'project', id: project.id, data: { ...project } });
      for (const l of lists) {
        undoManager.push({ type: 'create', entityType: 'list', id: l.id, data: { ...l } });
      }
      undoManager.endBatch();
      hideDropdown();
      onProjectSelect(project.id, lists[0].id);
    }
    if (e.key === 'Escape') {
      hideDropdown();
    }
  });
  dd.appendChild(input);
}

function buildCustomViewRow(view) {
  const row = document.createElement('div');
  row.className = 'project-row project-row--custom-view';

  const name = document.createElement('span');
  name.className = 'project-row-name';
  name.textContent = view.name || 'Untitled view';

  const badge = document.createElement('span');
  badge.className = 'project-row-count';
  const count = Array.isArray(view.selections) ? view.selections.length : 0;
  badge.textContent = `${count} selected`;

  row.appendChild(name);
  row.appendChild(badge);

  row.addEventListener('click', () => {
    if (row._longPressed) { row._longPressed = false; return; }
    hideDropdown();
    if (onCustomViewSelect) onCustomViewSelect(view.id);
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    hideDropdown();
    openMultiSelector(view);
  });

  addLongPress(row, () => {
    hideDropdown();
    openMultiSelector(view);
  });

  return row;
}

function openMultiSelector(existing) {
  multiSelector.open({
    existing,
    onSave: async (name, selections) => {
      if (existing) {
        const before = { name: existing.name, selections: existing.selections };
        await storage.updateCustomView(existing.id, { name, selections });
        undoManager.push({
          type: 'update', entityType: 'customView', id: existing.id,
          before, after: { name, selections }
        });
        if (onCustomViewSelect) onCustomViewSelect(existing.id);
      } else {
        const view = await storage.addCustomView(name, selections);
        undoManager.push({ type: 'create', entityType: 'customView', id: view.id, data: { ...view } });
        if (onCustomViewSelect) onCustomViewSelect(view.id);
      }
    },
    onDelete: existing ? async (view) => {
      undoManager.push({ type: 'delete', entityType: 'customView', id: view.id, data: { ...view } });
      await storage.deleteCustomView(view.id);
      if (onBack) onBack();
    } : null
  });
}

async function performDeleteProject(project) {
  undoManager.startBatch('delete project');
  const listsToDelete = await storage.getListsForProject(project.id);
  for (const list of listsToDelete) {
    const listItems = await storage.getItemsForList(list.id);
    for (const item of listItems) {
      undoManager.push({ type: 'delete', entityType: 'item', id: item.id, data: { ...item } });
    }
    undoManager.push({ type: 'delete', entityType: 'list', id: list.id, data: { ...list } });
  }
  undoManager.push({ type: 'delete', entityType: 'project', id: project.id, data: { ...project } });
  undoManager.endBatch();
  await storage.deleteProject(project.id);
  await showDropdown();
}

export async function showCustomViewHeader(viewId) {
  const headerLeft = document.querySelector('.header-left');
  const logo = headerLeft.querySelector('.logo');
  const projectsBtn = document.getElementById('btn-projects');

  const view = await storage.getCustomView(viewId);
  if (!view) return;

  // Hide day nav + list nav; keep projects button visible so user can navigate elsewhere
  document.getElementById('day-nav').style.display = 'none';
  document.getElementById('list-nav').style.display = 'none';
  projectsBtn.style.display = '';
  const newListBtn = document.getElementById('btn-new-list');
  const listsBtn = document.getElementById('btn-lists');
  const menuBtn = document.getElementById('btn-menu');
  if (newListBtn) newListBtn.style.display = 'none';
  if (listsBtn) listsBtn.style.display = 'none';
  if (menuBtn) menuBtn.style.display = 'none';

  logo.innerHTML = '';
  const backBtn = document.createElement('button');
  backBtn.className = 'btn-back';
  backBtn.textContent = '←';
  backBtn.title = 'Back to daily view';
  backBtn.addEventListener('click', () => {
    restoreDayHeader();
    if (onBack) onBack();
  });

  const nameSpan = document.createElement('span');
  nameSpan.className = 'project-name cv-header-name';
  nameSpan.textContent = view.name || 'Untitled view';

  nameSpan.addEventListener('click', () => {
    const input = document.createElement('input');
    input.className = 'project-name-input';
    input.value = view.name || '';
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const save = async () => {
      const newName = input.value.trim() || view.name;
      if (newName !== view.name) {
        const oldName = view.name;
        await storage.updateCustomView(viewId, { name: newName });
        undoManager.push({ type: 'update', entityType: 'customView', id: viewId, before: { name: oldName }, after: { name: newName } });
        view.name = newName;
      }
      nameSpan.textContent = view.name;
      input.replaceWith(nameSpan);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = view.name;
        input.blur();
      }
    });
  });

  // Edit button opens multi-selector
  const editBtn = document.createElement('button');
  editBtn.className = 'btn-cv-edit';
  editBtn.textContent = '⋯';
  editBtn.title = 'Edit custom view';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openMultiSelector(view);
  });

  logo.appendChild(backBtn);
  logo.appendChild(nameSpan);
  logo.appendChild(editBtn);
}

export async function showProjectHeader(projectId, activeListId) {
  const headerLeft = document.querySelector('.header-left');
  const logo = headerLeft.querySelector('.logo');
  const projectsBtn = document.getElementById('btn-projects');

  // Get project info
  const projects = await storage.getAllProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return;

  // Hide day nav, show list nav
  document.getElementById('day-nav').style.display = 'none';
  document.getElementById('list-nav').style.display = 'flex';
  projectsBtn.style.display = 'none';
  const newListBtn = document.getElementById('btn-new-list');
  const listsBtn = document.getElementById('btn-lists');
  const menuBtn = document.getElementById('btn-menu');
  if (newListBtn) newListBtn.style.display = 'none';
  if (listsBtn) listsBtn.style.display = 'none';
  if (menuBtn) menuBtn.style.display = 'none';

  // Replace logo with back button + project name
  logo.innerHTML = '';
  const backBtn = document.createElement('button');
  backBtn.className = 'btn-back';
  backBtn.textContent = '←';
  backBtn.title = 'Back to daily view';
  backBtn.addEventListener('click', () => {
    restoreDayHeader();
    onBack();
  });

  const nameSpan = document.createElement('span');
  nameSpan.className = 'project-name';
  nameSpan.textContent = project.name;

  // Single click to rename
  nameSpan.addEventListener('click', () => {
    const input = document.createElement('input');
    input.className = 'project-name-input';
    input.value = project.name;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const save = async () => {
      const newName = input.value.trim() || project.name;
      if (newName !== project.name) {
        const oldName = project.name;
        await storage.updateProject(projectId, { name: newName });
        undoManager.push({ type: 'update', entityType: 'project', id: projectId, before: { name: oldName }, after: { name: newName } });
        project.name = newName;
      }
      nameSpan.textContent = project.name;
      input.replaceWith(nameSpan);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = project.name;
        input.blur();
      }
    });
  });

  logo.appendChild(backBtn);
  logo.appendChild(nameSpan);

  // Render list tabs
  await renderListTabs(projectId, activeListId);
}

function startRenameTab(tab, list) {
  const input = document.createElement('input');
  input.className = 'project-name-input';
  input.style.fontSize = '11px';
  input.style.width = `${Math.max(60, tab.offsetWidth)}px`;
  input.value = list.name;
  tab.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newName = input.value.trim() || list.name;
    if (newName !== list.name) {
      const oldName = list.name;
      await storage.updateList(list.id, { name: newName });
      undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { name: oldName }, after: { name: newName } });
      list.name = newName;
    }
    tab.textContent = list.name;
    input.replaceWith(tab);
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = list.name;
      input.blur();
    }
  });
}

function showListTabContextMenu(e, list, currentProjectId, lists) {
  const old = document.querySelector('.lists-ctx-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.className = 'lists-ctx-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = '9999';

  // "Move to..." option
  const moveItem = document.createElement('div');
  moveItem.className = 'lists-ctx-item';
  moveItem.textContent = 'Move to...';
  moveItem.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    menu.remove();
    await showMoveListMenu(e, list, currentProjectId);
  });
  menu.appendChild(moveItem);

  // Delete option (only if more than one list)
  if (lists.length > 1) {
    const deleteItem = document.createElement('div');
    deleteItem.className = 'lists-ctx-item lists-ctx-item--danger';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.remove();
      showDeleteConfirm({
        name: list.name,
        type: 'list',
        onConfirm: async () => {
          undoManager.startBatch('delete list');
          const listItems = await storage.getItemsForList(list.id);
          for (const item of listItems) {
            undoManager.push({ type: 'delete', entityType: 'item', id: item.id, data: { ...item } });
          }
          undoManager.push({ type: 'delete', entityType: 'list', id: list.id, data: { ...list } });
          undoManager.endBatch();
          await storage.deleteList(list.id);
          const remaining = await storage.getListsForProject(currentProjectId);
          if (remaining.length > 0) {
            onListSelect(remaining[0].id);
            await renderListTabs(currentProjectId, remaining[0].id);
          }
        }
      });
    });
    menu.appendChild(deleteItem);
  }

  document.body.appendChild(menu);

  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function showMoveListMenu(e, list, currentProjectId) {
  const old = document.querySelector('.lists-ctx-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.className = 'lists-ctx-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = '9999';

  // "Lists" option — move to standalone
  const listsItem = document.createElement('div');
  listsItem.className = 'lists-ctx-item';
  listsItem.textContent = 'Lists';
  listsItem.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    menu.remove();
    await storage.moveListToProject(list.id, null);
    undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { projectId: currentProjectId }, after: { projectId: null } });
    onMoveList(null, list.id);
  });
  menu.appendChild(listsItem);

  const projects = await storage.getAllProjects();
  const otherProjects = projects.filter(p => p.id !== currentProjectId);

  if (otherProjects.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'lists-ctx-sep';
    menu.appendChild(sep);
  }

  for (const project of otherProjects) {
    const item = document.createElement('div');
    item.className = 'lists-ctx-item';
    item.textContent = project.name;
    item.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      menu.remove();
      await storage.moveListToProject(list.id, project.id);
      undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { projectId: currentProjectId }, after: { projectId: project.id } });
      onMoveList(project.id, list.id);
    });
    menu.appendChild(item);
  }

  document.body.appendChild(menu);

  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function renderListTabs(projectId, activeListId) {
  const listNav = document.getElementById('list-nav');
  listNav.innerHTML = '';

  const allLists = await storage.getListsForProject(projectId);

  // Filter out abandoned empty lists with default names (keep at least 1, keep active)
  const now = Date.now();
  const lists = [];
  for (const list of allLists) {
    if (allLists.length <= 1 || list.id === activeListId) { lists.push(list); continue; }
    const isDefault = /^List \d+$/.test(list.name) || !list.name;
    const isFresh = (now - list.createdAt) < 120000;
    if (isDefault && !isFresh) {
      const items = await storage.getItemsForList(list.id);
      const realItems = items.filter(i => !i.isSpacer && (i.text || '').trim() !== '');
      if (realItems.length === 0) continue;
    }
    lists.push(list);
  }

  for (const list of lists) {
    const tab = document.createElement('button');
    tab.className = 'list-tab' + (list.id === activeListId ? ' active' : '');
    tab.textContent = list.name;

    tab.addEventListener('click', () => {
      if (tab._longPressed) { tab._longPressed = false; return; }
      if (tab.classList.contains('active')) {
        // Already active — rename
        startRenameTab(tab, list);
      } else {
        // Switch to this list
        onListSelect(list.id);
        listNav.querySelectorAll('.list-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      }
    });

    // Long-press context menu (mobile)
    addLongPress(tab, (cx, cy) => {
      const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: cx, clientY: cy, target: tab };
      showListTabContextMenu(fakeEvent, list, projectId, lists);
    });

    // Middle-click to delete
    tab.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      if (lists.length <= 1) return;
      showDeleteConfirm({
        name: list.name,
        type: 'list',
        onConfirm: async () => {
          undoManager.startBatch('delete list');
          const listItems = await storage.getItemsForList(list.id);
          for (const item of listItems) {
            undoManager.push({ type: 'delete', entityType: 'item', id: item.id, data: { ...item } });
          }
          undoManager.push({ type: 'delete', entityType: 'list', id: list.id, data: { ...list } });
          undoManager.endBatch();
          await storage.deleteList(list.id);
          const remaining = await storage.getListsForProject(projectId);
          if (remaining.length > 0) {
            onListSelect(remaining[0].id);
            await renderListTabs(projectId, remaining[0].id);
          }
        }
      });
    });

    // Right-click context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showListTabContextMenu(e, list, projectId, lists);
    });

    listNav.appendChild(tab);
  }

  // Add list button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-list';
  addBtn.textContent = '+';
  addBtn.title = 'New list';
  addBtn.addEventListener('click', async () => {
    const newList = await storage.addList(projectId, `List ${lists.length + 1}`);
    undoManager.push({ type: 'create', entityType: 'list', id: newList.id, data: { ...newList } });
    onListSelect(newList.id);
    await renderListTabs(projectId, newList.id);
  });
  listNav.appendChild(addBtn);

  // Share buttons (only when logged in)
  if (authState.isLoggedIn) {
    const listData = await storage.getList(activeListId);

    // Read-only share button
    const readShareBtn = document.createElement('button');
    readShareBtn.className = 'btn-share-list';
    readShareBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    readShareBtn.title = 'Share read-only link';
    if (listData && listData.readShareCode) readShareBtn.classList.add('btn-share-list--read-active');

    readShareBtn.addEventListener('click', async () => {
      const ld = await storage.getList(activeListId);
      if (ld && ld.readShareCode) {
        showSharePopup(readShareBtn, ld.readShareCode);
        return;
      }
      const projects = await storage.getAllProjects();
      const project = projects.find(p => p.id === projectId);
      const activeList = lists.find(l => l.id === activeListId);
      const shareCode = await storage.shareList(
        activeListId, projectId,
        project ? project.name : 'Project',
        activeList ? activeList.name : 'List'
      );
      readShareBtn.classList.add('btn-share-list--read-active');
      showSharePopup(readShareBtn, shareCode);
    });

    readShareBtn.addEventListener('auxclick', async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const ld = await storage.getList(activeListId);
      if (!ld || !ld.readShareCode) return;
      await storage.revokeReadShare(activeListId, ld.readShareCode);
      readShareBtn.classList.remove('btn-share-list--read-active');
      readShareBtn.title = 'Read share revoked';
      const orig = readShareBtn.innerHTML;
      readShareBtn.textContent = '\u2717';
      setTimeout(() => { readShareBtn.innerHTML = orig; readShareBtn.title = 'Share read-only link'; }, 1500);
    });

    listNav.appendChild(readShareBtn);

    // Write share button
    const writeShareBtn = document.createElement('button');
    writeShareBtn.className = 'btn-share-list';
    writeShareBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><path d="M17.5 15.5l-2 2"/><path d="M19 14l2 2-5 5-2-2 5-5z"/></svg>';
    writeShareBtn.title = 'Share editable link';
    if (listData && listData.writeShareCode) writeShareBtn.classList.add('btn-share-list--write-active');

    writeShareBtn.addEventListener('click', async () => {
      const ld = await storage.getList(activeListId);
      if (ld && ld.writeShareCode) {
        showSharePopup(writeShareBtn, ld.writeShareCode);
        return;
      }
      const projects = await storage.getAllProjects();
      const project = projects.find(p => p.id === projectId);
      const activeList = lists.find(l => l.id === activeListId);
      const shareCode = await storage.shareListForWrite(
        activeListId, projectId,
        project ? project.name : 'Project',
        activeList ? activeList.name : 'List'
      );
      writeShareBtn.classList.add('btn-share-list--write-active');
      showSharePopup(writeShareBtn, shareCode);
    });

    writeShareBtn.addEventListener('auxclick', async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const ld = await storage.getList(activeListId);
      if (!ld || !ld.writeShareCode) return;
      await storage.revokeWriteShare(activeListId);
      writeShareBtn.classList.remove('btn-share-list--write-active');
      writeShareBtn.title = 'Write share revoked';
      const origHTML = writeShareBtn.innerHTML;
      writeShareBtn.textContent = '\u2717';
      setTimeout(() => { writeShareBtn.innerHTML = origHTML; writeShareBtn.title = 'Share editable link'; }, 1500);
    });

    listNav.appendChild(writeShareBtn);
  }
}

function showSharePopup(anchor, shareCode) {
  // Remove any existing popup
  const old = document.querySelector('.share-popup');
  if (old) old.remove();

  const baseUrl = (window.location.origin && window.location.origin !== 'file://') ? window.location.origin : 'https://stupidlist.app';
  const url = `${baseUrl}/s/${shareCode}`;

  // Auto-copy to clipboard immediately
  navigator.clipboard.writeText(url);

  const popup = document.createElement('div');
  popup.className = 'share-popup';

  const label = document.createElement('div');
  label.className = 'share-popup-label';
  label.textContent = 'Copied to clipboard';

  const urlRow = document.createElement('div');
  urlRow.className = 'share-popup-url-row';

  const urlInput = document.createElement('input');
  urlInput.className = 'share-popup-url';
  urlInput.value = url;
  urlInput.readOnly = true;
  urlInput.addEventListener('click', () => urlInput.select());

  const copyBtn = document.createElement('button');
  copyBtn.className = 'share-popup-copy';
  copyBtn.textContent = 'Copied!';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(url);
    copyBtn.textContent = 'Copied!';
    label.textContent = 'Copied to clipboard';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });

  urlRow.appendChild(urlInput);
  urlRow.appendChild(copyBtn);
  popup.appendChild(label);
  popup.appendChild(urlRow);

  // Position below anchor
  const rect = anchor.getBoundingClientRect();
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(popup);

  // Close on click outside
  const closeHandler = (e) => {
    if (!popup.contains(e.target) && e.target !== anchor) {
      popup.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

export function restoreDayHeader() {
  const logo = document.querySelector('.logo');
  // Logo text will be restored by app.js updateDateDisplay
  logo.innerHTML = '';

  document.getElementById('day-nav').style.display = 'flex';
  document.getElementById('list-nav').style.display = 'none';
  document.getElementById('btn-projects').style.display = '';
  const newListBtn = document.getElementById('btn-new-list');
  const listsBtn = document.getElementById('btn-lists');
  const menuBtn = document.getElementById('btn-menu');
  if (newListBtn) newListBtn.style.display = '';
  if (listsBtn) listsBtn.style.display = '';
  if (menuBtn) menuBtn.style.display = '';

  hideDropdown();
}
