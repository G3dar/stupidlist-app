import { toDateKey, formatDateLabel, addDays, getDayName } from '../shared/constants.js';
import * as storage from './storage.js';
import * as dayList from './dayList.js';
import * as projectList from './projectList.js';
import * as carryOver from './carryOver.js';
import * as projectNav from './projectNav.js';
import * as authUI from './authUI.js';
import * as settings from './settings.js';
import * as shareView from './shareView.js';
import * as statsView from './statsView.js';
import * as listsNav from './listsNav.js';
import * as helpOverlay from './helpOverlay.js';
import * as multiSelect from './multiSelect.js';
import * as undoManager from './undoManager.js';
import * as hashtagAutocomplete from './hashtagAutocomplete.js';

let currentDateKey = toDateKey(new Date());
let currentView = 'day'; // 'day', 'project', or 'standalone'
let currentProjectId = null;
let currentListId = null;
let loadDayPromise = null;
let remoteRenderTimer = null;
let pendingRemoteRender = null;

function scheduleRemoteRender(renderFn) {
  clearTimeout(remoteRenderTimer);
  remoteRenderTimer = setTimeout(() => {
    const active = document.activeElement;
    if (active && active.closest && active.closest('.item-text')) {
      // User is editing — defer until they finish
      pendingRemoteRender = renderFn;
      return;
    }
    renderFn();
  }, 300);
}

// Flush deferred remote render when user finishes editing
document.addEventListener('blur', () => {
  if (pendingRemoteRender) {
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active.closest && active.closest('.item-text')) return;
      if (pendingRemoteRender) {
        const fn = pendingRemoteRender;
        pendingRemoteRender = null;
        fn();
      }
    }, 150);
  }
}, true); // capture phase to catch contentEditable blur

export async function init() {
  await storage.open();

  // Check for stats page
  if (isStatsPage()) {
    authUI.init(() => {});
    await statsView.load();
    return;
  }

  // Check for shared list URL before setting up normal UI
  const shareCode = getShareCode();
  if (shareCode) {
    authUI.init(() => {}); // no-op reload for share view
    await shareView.load(shareCode);
    return;
  }

  projectNav.init({
    onProjectSelect: loadProject,
    onListSelect: loadList,
    onBack: switchToDay
  });

  listsNav.init({
    onNewList: loadStandaloneList,
    onListSelect: loadStandaloneList,
    onBack: switchToDay
  });

  // Init auth UI with reload callback
  authUI.init(async () => {
    await storage.open();
    if (currentView === 'day') {
      await loadDay(currentDateKey);
    } else if (currentView === 'project' && currentProjectId) {
      await loadProject(currentProjectId, currentListId);
    } else if (currentView === 'standalone' && currentListId) {
      await loadStandaloneList(currentListId);
    }
  });

  settings.init();
  helpOverlay.init();
  hashtagAutocomplete.init();
  setupNavigation();
  setupPasteAsItems();
  setupFlushSaves();
  await loadDay(currentDateKey);
}

async function loadDay(dateKey) {
  // Serialize concurrent calls to prevent duplicate empty items
  while (loadDayPromise) await loadDayPromise;

  let resolve;
  loadDayPromise = new Promise(r => { resolve = r; });

  try {
    multiSelect.exit();
    currentView = 'day';
    currentDateKey = dateKey;
    currentProjectId = null;
    currentListId = null;
    updateDateDisplay();
    await dayList.render(dateKey);

    const today = toDateKey(new Date());
    if (dateKey >= today) {
      await carryOver.check(dateKey, () => dayList.render(dateKey));
    } else {
      document.getElementById('carry-over').innerHTML = '';
    }

    // Subscribe to real-time updates from other devices
    storage.subscribe('day', dateKey, () => {
      scheduleRemoteRender(() => dayList.render(dateKey));
    });
  } finally {
    resolve();
    loadDayPromise = null;
  }
}

async function loadProject(projectId, listId) {
  multiSelect.exit();
  currentView = 'project';
  currentProjectId = projectId;

  // If no listId provided, get the first list
  if (!listId) {
    const lists = await storage.getListsForProject(projectId);
    if (lists.length === 0) return;
    listId = lists[0].id;
  }

  currentListId = listId;

  // Hide carry-over in project mode
  document.getElementById('carry-over').innerHTML = '';

  // Update header
  await projectNav.showProjectHeader(projectId, listId);

  // Render items
  await projectList.render(listId);

  // Subscribe to real-time updates from other devices
  storage.subscribe('list', listId, () => {
    scheduleRemoteRender(() => projectList.render(listId));
  });
}

async function loadList(listId) {
  currentListId = listId;
  await projectList.render(listId);

  storage.subscribe('list', listId, () => {
    scheduleRemoteRender(() => projectList.render(listId));
  });
}

async function loadStandaloneList(listId, autoFocusTitle) {
  currentView = 'standalone';
  currentListId = listId;
  currentProjectId = null;

  // Hide carry-over in standalone mode
  document.getElementById('carry-over').innerHTML = '';

  // Update header
  await listsNav.showStandaloneListHeader(listId, autoFocusTitle);

  // Render items (reuse project list renderer)
  await projectList.render(listId);

  // Subscribe to real-time updates
  storage.subscribe('list', listId, () => {
    scheduleRemoteRender(() => projectList.render(listId));
  });
}

async function refreshCurrentView() {
  if (currentView === 'day') {
    await dayList.render(currentDateKey);
  } else if (currentListId) {
    await projectList.render(currentListId);
  }
}

function switchToDay() {
  projectNav.restoreDayHeader();
  loadDay(currentDateKey);
}

function updateDateDisplay() {
  const label = document.getElementById('date-label');
  const todayBtn = document.getElementById('btn-today');
  const logo = document.querySelector('.logo');
  const today = toDateKey(new Date());

  label.textContent = formatDateLabel(currentDateKey);
  logo.textContent = getDayName(currentDateKey);
  todayBtn.classList.toggle('is-today', currentDateKey === today);
}

function setupNavigation() {
  document.getElementById('btn-prev').addEventListener('click', () => navigateDay(-1));
  document.getElementById('btn-next').addEventListener('click', () => navigateDay(1));
  document.getElementById('btn-today').addEventListener('click', goToToday);
  document.getElementById('btn-copy-list').addEventListener('click', copyListToClipboard);

  document.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    const isEditing = active && active.contentEditable === 'true';

    if (e.ctrlKey && e.key === 'ArrowLeft' && !isEditing && currentView === 'day') {
      e.preventDefault();
      navigateDay(-1);
    }
    if (e.ctrlKey && e.key === 'ArrowRight' && !isEditing && currentView === 'day') {
      e.preventDefault();
      navigateDay(1);
    }

    // Ctrl+Z: undo
    if (e.ctrlKey && !e.shiftKey && e.key === 'z' && !isEditing) {
      e.preventDefault();
      undoManager.undo().then(() => refreshCurrentView());
    }

    // Ctrl+Y or Ctrl+Shift+Z: redo
    if (e.ctrlKey && e.key === 'y' && !isEditing) {
      e.preventDefault();
      undoManager.redo().then(() => refreshCurrentView());
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'Z' && !isEditing) {
      e.preventDefault();
      undoManager.redo().then(() => refreshCurrentView());
    }

    // Ctrl+E: export
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      exportData();
    }

    // Ctrl+0: reset zoom
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      document.body.style.zoom = '100%';
      localStorage.setItem('zoom', '100');
    }
  });

  // Ctrl+mouse wheel zoom
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const current = parseInt(localStorage.getItem('zoom') || '100');
      const next = e.deltaY < 0 ? Math.min(current + 10, 200) : Math.max(current - 10, 50);
      document.body.style.zoom = `${next}%`;
      localStorage.setItem('zoom', String(next));
    }
  }, { passive: false });

  // Restore zoom on load
  const savedZoom = localStorage.getItem('zoom');
  if (savedZoom) document.body.style.zoom = `${savedZoom}%`;
}

function navigateDay(offset) {
  const newDate = addDays(currentDateKey, offset);
  carryOver.reset();
  loadDay(newDate);
}

function goToToday() {
  carryOver.reset();
  loadDay(toDateKey(new Date()));
}

function setupFlushSaves() {
  if (window.stupidlist && window.stupidlist.onFlushSaves) {
    window.stupidlist.onFlushSaves(() => {
      if (document.activeElement) {
        document.activeElement.blur();
      }
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (document.activeElement) document.activeElement.blur();
      storage.unsubscribe();
    } else {
      // Tab became visible — re-sync and re-subscribe
      if (currentView === 'day') {
        loadDay(currentDateKey);
      } else if (currentView === 'project' && currentProjectId) {
        loadProject(currentProjectId, currentListId);
      } else if (currentView === 'standalone' && currentListId) {
        loadStandaloneList(currentListId);
      }
    }
  });
}

function setupPasteAsItems() {
  if (window.stupidlist && window.stupidlist.onPasteAsItems) {
    window.stupidlist.onPasteAsItems((text) => {
      if (currentView === 'day') {
        dayList.pasteAsItems(text);
      }
    });
  }
}

async function copyListToClipboard() {
  const list = document.getElementById('item-list');
  const items = Array.from(list.children);
  const lines = [];
  for (const li of items) {
    if (li.classList.contains('item--spacer') || li.classList.contains('done-toggle')) continue;
    const text = li.querySelector('.item-text');
    if (text && text.textContent.trim()) {
      const num = li.querySelector('.item-number');
      const prefix = num ? num.textContent + ' ' : '';
      lines.push(prefix + text.textContent.trim());
    }
  }
  const btn = document.getElementById('btn-copy-list');
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '⧉'; }, 1500);
  } catch {}
}

async function exportData() {
  const data = await storage.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stupidlist-export-${toDateKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isStatsPage() {
  return /^\/stats\/?$/.test(window.location.pathname);
}

function getShareCode() {
  // Check URL path: /s/{code}
  const path = window.location.pathname;
  const match = path.match(/^\/s\/([a-zA-Z0-9]+)$/);
  if (match) return match[1];

  // Check hash: #s/{code}
  const hash = window.location.hash;
  const hashMatch = hash.match(/^#s\/([a-zA-Z0-9]+)$/);
  if (hashMatch) return hashMatch[1];

  return null;
}
