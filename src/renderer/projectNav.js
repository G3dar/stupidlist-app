import * as storage from './storage.js';
import { authState } from './auth.js';

let onProjectSelect = null;
let onListSelect = null;
let onBack = null;
let dropdownVisible = false;

export function init(callbacks) {
  onProjectSelect = callbacks.onProjectSelect;
  onListSelect = callbacks.onListSelect;
  onBack = callbacks.onBack;

  document.getElementById('btn-projects').addEventListener('click', toggleDropdown);

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (dropdownVisible && !e.target.closest('#projects-dropdown') && !e.target.closest('#btn-projects')) {
      hideDropdown();
    }
  });
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
    const row = document.createElement('div');
    row.className = 'project-row';

    const name = document.createElement('span');
    name.className = 'project-row-name';
    name.textContent = project.name;

    const count = document.createElement('span');
    count.className = 'project-row-count';
    count.textContent = `${lists.length} list${lists.length !== 1 ? 's' : ''}`;

    row.appendChild(name);
    row.appendChild(count);

    row.addEventListener('click', () => {
      hideDropdown();
      onProjectSelect(project.id, lists.length > 0 ? lists[0].id : null);
    });

    // Right-click to delete
    row.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (confirm(`Delete project "${project.name}"?`)) {
        await storage.deleteProject(project.id);
        await showDropdown();
      }
    });

    dd.appendChild(row);
  }

  // New project input
  const input = document.createElement('input');
  input.className = 'new-project-input';
  input.placeholder = '+ New project...';
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      const project = await storage.addProject(input.value.trim());
      const lists = await storage.getListsForProject(project.id);
      hideDropdown();
      onProjectSelect(project.id, lists[0].id);
    }
    if (e.key === 'Escape') {
      hideDropdown();
    }
  });
  dd.appendChild(input);
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
      await storage.updateProject(projectId, { name: newName });
      project.name = newName;
      nameSpan.textContent = newName;
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
    await storage.updateList(list.id, { name: newName });
    list.name = newName;
    tab.textContent = newName;
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

async function renderListTabs(projectId, activeListId) {
  const listNav = document.getElementById('list-nav');
  listNav.innerHTML = '';

  const lists = await storage.getListsForProject(projectId);

  for (const list of lists) {
    const tab = document.createElement('button');
    tab.className = 'list-tab' + (list.id === activeListId ? ' active' : '');
    tab.textContent = list.name;

    tab.addEventListener('click', () => {
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

    // Right-click to delete
    tab.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (lists.length <= 1) return; // Don't delete the last list
      if (confirm(`Delete list "${list.name}"?`)) {
        await storage.deleteList(list.id);
        const remaining = await storage.getListsForProject(projectId);
        if (remaining.length > 0) {
          onListSelect(remaining[0].id);
          await renderListTabs(projectId, remaining[0].id);
        }
      }
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
    onListSelect(newList.id);
    await renderListTabs(projectId, newList.id);
  });
  listNav.appendChild(addBtn);

  // Share button (only when logged in)
  if (authState.isLoggedIn) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'btn-share-list';
    shareBtn.textContent = '🔗';
    shareBtn.title = 'Share this list';
    shareBtn.addEventListener('click', async () => {
      // Get project info for the share doc
      const projects = await storage.getAllProjects();
      const project = projects.find(p => p.id === projectId);
      const activeList = lists.find(l => l.id === activeListId);

      const shareCode = await storage.shareList(
        activeListId,
        projectId,
        project ? project.name : 'Project',
        activeList ? activeList.name : 'List'
      );

      showSharePopup(shareBtn, shareCode);
    });
    listNav.appendChild(shareBtn);
  }
}

function showSharePopup(anchor, shareCode) {
  // Remove any existing popup
  const old = document.querySelector('.share-popup');
  if (old) old.remove();

  const baseUrl = window.location.origin || 'https://stupidlist.app';
  const url = `${baseUrl}/s/${shareCode}`;

  const popup = document.createElement('div');
  popup.className = 'share-popup';

  const label = document.createElement('div');
  label.className = 'share-popup-label';
  label.textContent = 'Share link:';

  const urlRow = document.createElement('div');
  urlRow.className = 'share-popup-url-row';

  const urlInput = document.createElement('input');
  urlInput.className = 'share-popup-url';
  urlInput.value = url;
  urlInput.readOnly = true;
  urlInput.addEventListener('click', () => urlInput.select());

  const copyBtn = document.createElement('button');
  copyBtn.className = 'share-popup-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(url);
    copyBtn.textContent = 'Copied!';
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

  hideDropdown();
}
