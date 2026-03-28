import * as storage from './storage.js';
import { authState } from './auth.js';
import * as undoManager from './undoManager.js';
import { showDeleteConfirm } from './deleteConfirm.js';

let onNewList = null;
let onListSelect = null;
let onBack = null;
let dropdownVisible = false;

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

  const lists = await storage.getStandaloneLists();

  if (lists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'list-row list-row-empty';
    empty.textContent = 'No lists yet. Click "new" to create one.';
    dd.appendChild(empty);
    return;
  }

  for (const list of lists) {
    const items = await storage.getItemsForList(list.id);
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
    count.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

    const updated = document.createElement('span');
    updated.className = 'list-row-updated';
    updated.textContent = lastUpdated ? timeAgo(lastUpdated) : '';

    row.appendChild(name);
    row.appendChild(count);
    row.appendChild(updated);

    row.addEventListener('click', () => {
      hideDropdown();
      onListSelect(list.id);
    });

    // Right-click context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showListContextMenu(e, list);
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
  moveItem.textContent = 'Move to project';
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

  for (const project of projects) {
    const item = document.createElement('div');
    item.className = 'lists-ctx-item';
    item.textContent = project.name;
    item.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      menu.remove();
      const oldProjectId = list.projectId || null;
      await storage.moveListToProject(list.id, project.id);
      undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { projectId: oldProjectId }, after: { projectId: project.id } });
      await showDropdown();
    });
    menu.appendChild(item);
  }

  // Separator
  if (projects.length > 0) {
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
      const oldProjectId = list.projectId || null;
      await storage.moveListToProject(list.id, project.id);
      undoManager.push({ type: 'update', entityType: 'list', id: list.id, before: { projectId: oldProjectId }, after: { projectId: project.id } });
      undoManager.endBatch();
      await showDropdown();
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

  nameSpan.addEventListener('click', startRename);

  // Right-click on name for "Move to project"
  nameSpan.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMoveToProjectMenu(e, list);
  });

  logo.appendChild(backBtn);
  logo.appendChild(nameSpan);

  // Render list-nav with share button only (no tabs for standalone lists)
  const listNav = document.getElementById('list-nav');
  listNav.innerHTML = '';

  if (authState.isLoggedIn) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn-share-list';
    shareBtn.textContent = '\uD83D\uDD17';
    shareBtn.title = 'Share this list';
    shareBtn.addEventListener('click', async () => {
      const shareCode = await storage.shareList(
        listId,
        null,
        list.name,
        list.name
      );
      // Reuse share popup from projectNav
      showSharePopup(shareBtn, shareCode);
    });

    // Middle-click: toggle write share
    shareBtn.addEventListener('auxclick', async (e) => {
      if (e.button !== 1) return;
      e.preventDefault();

      const listData = await storage.getList(listId);

      if (listData && listData.writeShareCode) {
        // Revoke existing write share
        await storage.revokeWriteShare(listId);
        await storage.updateList(listId, { writeShareCode: null });
        shareBtn.classList.remove('btn-share-list--write-active');
        shareBtn.title = 'Write share revoked';
        const origText = shareBtn.textContent;
        shareBtn.textContent = '\u2717';
        setTimeout(() => { shareBtn.textContent = origText; shareBtn.title = 'Share this list'; }, 1500);
      } else {
        // Generate new write share
        const shareCode = await storage.shareListForWrite(
          listId,
          null,
          list.name,
          list.name
        );
        await storage.updateList(listId, { writeShareCode: shareCode });
        shareBtn.classList.add('btn-share-list--write-active');

        const baseUrl = window.location.origin || 'https://stupidlist.app';
        const url = `${baseUrl}/s/${shareCode}`;
        await navigator.clipboard.writeText(url);

        shareBtn.title = 'Write link copied!';
        const origText = shareBtn.textContent;
        shareBtn.textContent = '\u2713';
        setTimeout(() => { shareBtn.textContent = origText; shareBtn.title = 'Share this list'; }, 1500);
      }
    });

    // Show active write-share indicator
    const listData = await storage.getList(listId);
    if (listData && listData.writeShareCode) {
      shareBtn.classList.add('btn-share-list--write-active');
    }

    listNav.appendChild(shareBtn);
  }

  // Auto-focus title for new lists
  if (autoFocusTitle) {
    setTimeout(startRename, 100);
  }
}

function showSharePopup(anchor, shareCode) {
  const old = document.querySelector('.share-popup');
  if (old) old.remove();

  const baseUrl = window.location.origin || 'https://stupidlist.app';
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
