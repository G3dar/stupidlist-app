import * as storage from './storage.js';
import { authState } from './auth.js';
import * as undoManager from './undoManager.js';
import { showDeleteConfirm } from './deleteConfirm.js';

let onNewList = null;
let onListSelect = null;
let onMoveToProject = null;
let onBack = null;
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
      if (navigator.vibrate) navigator.vibrate(50);
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
  onNewList = callbacks.onNewList;
  onListSelect = callbacks.onListSelect;
  onMoveToProject = callbacks.onMoveToProject;
  onBack = callbacks.onBack;

  document.getElementById('btn-new-list').addEventListener('click', handleNewList);
  document.getElementById('btn-lists').addEventListener('click', toggleDropdown);

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (dropdownVisible && !e.target.closest('#lists-dropdown') && !e.target.closest('#btn-lists')) {
      hideDropdown();
    }
  });
}

async function handleNewList() {
  hideDropdown();
  const list = await storage.addStandaloneList('Untitled list');
  undoManager.push({ type: 'create', entityType: 'list', id: list.id, data: { ...list } });
  onNewList(list.id, true); // true = auto-focus title for rename
}

async function toggleDropdown() {
  if (dropdownVisible) {
    hideDropdown();
  } else {
    await showDropdown();
  }
}

function hideDropdown() {
  dropdownVisible = false;
  const dd = document.getElementById('lists-dropdown');
  dd.style.display = 'none';
  document.getElementById('btn-lists').classList.remove('active');
}

async function showDropdown() {
  dropdownVisible = true;
  document.getElementById('btn-lists').classList.add('active');

  const dd = document.getElementById('lists-dropdown');
  dd.style.display = 'block';
  dd.innerHTML = '';

  const allLists = await storage.getStandaloneLists();

  // Filter out abandoned empty lists with default names (grace period: 2 min)
  const now = Date.now();
  const visibleLists = [];
  for (const list of allLists) {
    const items = await storage.getItemsForList(list.id);
    const realItems = items.filter(i => !i.isSpacer && (i.text || '').trim() !== '');
    const isDefault = !list.name || list.name === 'Untitled list';
    const isFresh = (now - list.createdAt) < 120000;
    if (realItems.length === 0 && isDefault && !isFresh) continue;
    visibleLists.push({ list, items, realItems });
  }

  if (visibleLists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-row list-row-empty';
    empty.textContent = 'No lists yet. Click "new" to create one.';
    dd.appendChild(empty);
    return;
  }

  for (const { list, items, realItems } of visibleLists) {
    let lastUpdated = list.updatedAt || 0;
    for (const item of items) {
      if (item.updatedAt > lastUpdated) lastUpdated = item.updatedAt;
    }

    const row = document.createElement('div');
    row.className = 'list-row';

    const name = document.createElement('span');
    name.className = 'list-row-name';
    name.textContent = list.name;

    const count = document.createElement('span');
    count.className = 'list-row-count';
    if (realItems.length === 0) {
      count.textContent = 'empty';
      count.classList.add('list-row-count--empty');
      row.classList.add('list-row--empty');
    } else {
      count.textContent = `${realItems.length} item${realItems.length !== 1 ? 's' : ''}`;
    }

    const updated = document.createElement('span');
    updated.className = 'list-row-updated';
    updated.textContent = lastUpdated ? timeAgo(lastUpdated) : '';

    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(updated);

    row.addEventListener('click', () => {
      if (row._longPressed) { row._longPressed = false; return; }
      hideDropdown();
      onListSelect(list.id);
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showListContextMenu(e, list);
    });

    // Long-press context menu (mobile)
    addLongPress(row, (cx, cy) => {
      const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: cx, clientY: cy, target: row };
      showListContextMenu(fakeEvent, list);
    });

    // Middle-click to delete
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      showDeleteConfirm({
        name: list.name,
        type: 'list',
        onConfirm: () => performDeleteList(list)
      });
    });

    dd.appendChild(row);
  }
}

async function performDeleteList(list) {
  undoManager.startBatch('delete list');
  const listItems = await storage.getItemsForList(list.id);
  for (const item of listItems) {
    undoManager.push({ type: 'delete', entityType: 'item', id: item.id, data: { ...item } });
  }
  undoManager.push({ type: 'delete', entityType: 'list', id: list.id, data: { ...list } });
  undoManager.endBatch();
  await storage.deleteList(list.id);
  await showDropdown();
}

function showListContextMenu(e, list) {
  // Remove any existing context menu
  const old = document.querySelector('.lists-ctx-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.className = 'lists-ctx-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = '9999';

  // Move to project option
  const moveItem = document.createElement('div');
  moveItem.className = 'lists-ctx-item';
  moveItem.textContent = 'Move to...';
  moveItem.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    menu.remove();
    await showMoveToProjectMenu(e, list);
  });
  menu.appendChild(moveItem);

  // Delete option
  const deleteItem = document.createElement('div');
  deleteItem.className = 'lists-ctx-item lists-ctx-item--danger';
  deleteItem.textContent = 'Delete';
  deleteItem.addEventListener('click', (ev) => {
    ev.stopPropagation();
    menu.remove();
    showDeleteConfirm({
      name: list.name,
      type: 'list',
      onConfirm: () => performDeleteList(list)
    });
  });
  menu.appendChild(deleteItem);

  document.body.appendChild(menu);

  // Close on click outside
  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function showMoveToProjectMenu(e, list) {
  const old = document.querySelector('.lists-ctx-menu');
  if (old) old.remove();

  const menu = document.createElement('div');
  menu.className = 'lists-ctx-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.style.zIndex = '9999';

  const projects = await storage.getAllProjects();
  const currentProjectId = list.projectId || null;

  // "Lists" option — move to standalone (only if currently in a project)
  if (currentProjectId) {
    const listsItem = document.createElement('div');
    listsItem.className = 'lists-ctx-item';
    listsItem.textContent = 'Lists';
    listsItem.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      menu.remove();
      hideDropdown();
      await storage.moveListToProject(list.id, null);
      undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { projectId: currentProjectId }, after: { projectId: null } });
      list.projectId = null;
      onListSelect(list.id);
    });
    menu.appendChild(listsItem);

    if (projects.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'lists-ctx-sep';
      menu.appendChild(sep);
    }
  }

  for (const project of projects) {
    // Skip the project the list is already in
    if (project.id === currentProjectId) continue;

    const item = document.createElement('div');
    item.className = 'lists-ctx-item';
    item.textContent = project.name;
    item.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      menu.remove();
      hideDropdown();
      await storage.moveListToProject(list.id, project.id);
      undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { projectId: currentProjectId }, after: { projectId: project.id } });
      list.projectId = project.id;
      onMoveToProject(project.id, list.id);
    });
    menu.appendChild(item);
  }

  // Separator
  const visibleProjects = projects.filter(p => p.id !== currentProjectId);
  if (visibleProjects.length > 0 || currentProjectId) {
    const sep = document.createElement('div');
    sep.className = 'lists-ctx-sep';
    menu.appendChild(sep);
  }

  // New project option
  const newProjItem = document.createElement('div');
  newProjItem.className = 'lists-ctx-item';
  newProjItem.textContent = '+ New project...';
  newProjItem.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    menu.remove();
    const name = prompt('Project name:');
    if (name && name.trim()) {
      const project = await storage.addProject(name.trim());
      const projectLists = await storage.getListsForProject(project.id);
      undoManager.startBatch('new project + move list');
      undoManager.push({ type: 'create', entityType: 'project', id: project.id, data: { ...project } });
      for (const l of projectLists) {
        undoManager.push({ type: 'create', entityType: 'list', id: l.id, data: { ...l } });
      }
      await storage.moveListToProject(list.id, project.id);
      undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { projectId: currentProjectId }, after: { projectId: project.id } });
      undoManager.endBatch();
      list.projectId = project.id;
      onMoveToProject(project.id, list.id);
    }
  });
  menu.appendChild(newProjItem);

  document.body.appendChild(menu);

  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

export async function showStandaloneListHeader(listId, autoFocusTitle) {
  const headerLeft = document.querySelector('.header-left');
  const logo = headerLeft.querySelector('.logo');

  const list = await storage.getList(listId);
  if (!list) return;

  // Hide day nav
  document.getElementById('day-nav').style.display = 'none';
  document.getElementById('list-nav').style.display = 'flex';

  // Replace logo with back button + list name
  logo.innerHTML = '';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn-back';
  backBtn.textContent = '\u2190';
  backBtn.title = 'Back to daily view';
  backBtn.addEventListener('click', () => {
    onBack();
  });

  const nameSpan = document.createElement('span');
  nameSpan.className = 'project-name';
  nameSpan.textContent = list.name;

  // Click to rename
  const startRename = () => {
    const input = document.createElement('input');
    input.className = 'project-name-input';
    input.value = list.name;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const save = async () => {
      const newName = input.value.trim() || list.name;
      if (newName !== list.name) {
        const oldName = list.name;
        await storage.updateList(listId, { name: newName });
        undoManager.push({ type: 'update', entityType: 'list', id: listId, before: { name: oldName }, after: { name: newName } });
        list.name = newName;
      }
      nameSpan.textContent = list.name;
      input.replaceWith(nameSpan);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = list.name;
        input.blur();
      }
    });
  };

  nameSpan.addEventListener('click', () => {
    if (nameSpan._longPressed) { nameSpan._longPressed = false; return; }
    startRename();
  });

  // Right-click on name for "Move to project"
  nameSpan.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMoveToProjectMenu(e, list);
  });

  // Long-press on name for "Move to project" (mobile)
  addLongPress(nameSpan, (cx, cy) => {
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: cx, clientY: cy, target: nameSpan };
    showMoveToProjectMenu(fakeEvent, list);
  });

  logo.appendChild(backBtn);
  logo.appendChild(nameSpan);

  // Render list-nav with share button only (no tabs for standalone lists)
  const listNav = document.getElementById('list-nav');
  listNav.innerHTML = '';

  if (authState.isLoggedIn) {
    const listData = await storage.getList(listId);

    // Read-only share button
    const readShareBtn = document.createElement('button');
    readShareBtn.className = 'btn-share-list';
    readShareBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    readShareBtn.title = 'Share read-only link';
    if (listData && listData.readShareCode) readShareBtn.classList.add('btn-share-list--read-active');

    readShareBtn.addEventListener('click', async () => {
      const ld = await storage.getList(listId);
      if (ld && ld.readShareCode) {
        showSharePopup(readShareBtn, ld.readShareCode);
        return;
      }
      const shareCode = await storage.shareList(listId, null, list.name, list.name);
      readShareBtn.classList.add('btn-share-list--read-active');
      showSharePopup(readShareBtn, shareCode);
    });

    readShareBtn.addEventListener('auxclick', async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const ld = await storage.getList(listId);
      if (!ld || !ld.readShareCode) return;
      await storage.revokeReadShare(listId, ld.readShareCode);
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
      const ld = await storage.getList(listId);
      if (ld && ld.writeShareCode) {
        showSharePopup(writeShareBtn, ld.writeShareCode);
        return;
      }
      const shareCode = await storage.shareListForWrite(listId, null, list.name, list.name);
      writeShareBtn.classList.add('btn-share-list--write-active');
      showSharePopup(writeShareBtn, shareCode);
    });

    writeShareBtn.addEventListener('auxclick', async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const ld = await storage.getList(listId);
      if (!ld || !ld.writeShareCode) return;
      await storage.revokeWriteShare(listId);
      writeShareBtn.classList.remove('btn-share-list--write-active');
      writeShareBtn.title = 'Write share revoked';
      const origHTML = writeShareBtn.innerHTML;
      writeShareBtn.textContent = '\u2717';
      setTimeout(() => { writeShareBtn.innerHTML = origHTML; writeShareBtn.title = 'Share editable link'; }, 1500);
    });

    listNav.appendChild(writeShareBtn);
  }

  // Auto-focus title for new lists
  if (autoFocusTitle) {
    setTimeout(startRename, 100);
  }
}

function showSharePopup(anchor, shareCode) {
  const old = document.querySelector('.share-popup');
  if (old) old.remove();

  const baseUrl = (window.location.origin && window.location.origin !== 'file://') ? window.location.origin : 'https://stupidlist.app';
  const url = `${baseUrl}/s/${shareCode}`;

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

  const rect = anchor.getBoundingClientRect();
  popup.style.top = `${rect.bottom + 6}px`;
  popup.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(popup);

  const closeHandler = (e) => {
    if (!popup.contains(e.target) && e.target !== anchor) {
      popup.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}
