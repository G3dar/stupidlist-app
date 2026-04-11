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
import * as thumbMenu from './thumbMenu.js';
import { migrateStatuses } from './statusConfig.js';

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
  // Show instant editable placeholder while data loads
  updateDateDisplay();
  dayList.renderInstantPlaceholder();

  // Non-blocking: set up UI and load data in parallel
  const dataReady = (async () => {
    await storage.open();
    await migrateStatuses();
  })();

  // Check for stats page
  if (isStatsPage()) {
    await dataReady;
    authUI.init(() => {});
    await statsView.load();
    return;
  }

  // Check for shared list URL before setting up normal UI
  const shareCode = getShareCode();
  if (shareCode) {
    await dataReady;
    authUI.init(() => {}); // no-op reload for share view
    await shareView.load(shareCode);
    return;
  }

  projectNav.init({
    onProjectSelect: loadProject,
    onListSelect: loadList,
    onMoveList: (projectId, listId) => {
      if (projectId) loadProject(projectId, listId);
      else loadStandaloneList(listId);
    },
    onBack: switchToDay
  });

  listsNav.init({
    onNewList: loadStandaloneList,
    onListSelect: loadStandaloneList,
    onMoveToProject: loadProject,
    onBack: switchToDay
  });

  thumbMenu.init({
    onProjectSelect: loadProject,
    onListSelect: loadStandaloneList,
    onToday: goToToday
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

  // Mouse back button → go back to day view
  document.addEventListener('mouseup', (e) => {
    if (e.button === 3 && (currentView === 'standalone' || currentView === 'project')) {
      e.preventDefault();
      switchToDay();
    }
  });

  // Wait for data before loading real items
  await dataReady;

  // Restore view from URL hash
  const restored = await restoreFromHash();
  if (!restored) {
    await loadDay(currentDateKey);
  }
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
    updateHash();
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
      scheduleRemoteRender(() => dayList.render(dateKey, { skipLoading: true }));
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
  updateHash();

  // Hide carry-over in project mode
  document.getElementById('carry-over').innerHTML = '';

  // Update header
  await projectNav.showProjectHeader(projectId, listId);

  // Render items
  await projectList.render(listId);

  // Subscribe to real-time updates from other devices
  storage.subscribe('list', listId, () => {
    scheduleRemoteRender(() => projectList.render(listId, null, { skipLoading: true }));
  });
}

async function loadList(listId) {
  currentListId = listId;
  updateHash();
  await projectList.render(listId);

  storage.subscribe('list', listId, () => {
    scheduleRemoteRender(() => projectList.render(listId, null, { skipLoading: true }));
  });
}

async function loadStandaloneList(listId, autoFocusTitle) {
  currentView = 'standalone';
  currentListId = listId;
  currentProjectId = null;
  updateHash();

  // Hide carry-over in standalone mode
  document.getElementById('carry-over').innerHTML = '';

  // Update header
  await listsNav.showStandaloneListHeader(listId, autoFocusTitle);

  // Render items (reuse project list renderer)
  await projectList.render(listId);

  // Subscribe to real-time updates
  storage.subscribe('list', listId, () => {
    scheduleRemoteRender(() => projectList.render(listId, null, { skipLoading: true }));
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

function setupSwipeNavigation() {
  const container = document.getElementById('list-container');
  let startX = 0, startY = 0, swiping = false;

  container.addEventListener('touchstart', (e) => {
    // Only swipe-navigate if touch is NOT on an item
    if (e.target.closest('.item')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = false;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (e.target.closest('.item')) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!swiping && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
      swiping = true;
    }
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (!swiping || currentView !== 'day') return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 80) {
      if (dx < 0) navigateDay(1);   // swipe left → next day
      else navigateDay(-1);          // swipe right → prev day
    }
    swiping = false;
  });
}

function setupHamburgerMenu() {
  const menuBtn = document.getElementById('btn-menu');
  if (!menuBtn) return;

  let menuEl = null;

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuEl) { closeMenu(); return; }

    menuEl = document.createElement('div');
    menuEl.className = 'menu-dropdown';

    const listsBtn = document.createElement('button');
    listsBtn.className = 'menu-dropdown-item';
    listsBtn.textContent = 'Lists';
    listsBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeMenu();
      // Delay to avoid outside-click listeners closing it immediately
      setTimeout(() => listsNav.toggleDropdown(), 10);
    });

    const projectsBtn = document.createElement('button');
    projectsBtn.className = 'menu-dropdown-item';
    projectsBtn.textContent = 'Projects';
    projectsBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeMenu();
      setTimeout(() => projectNav.toggleDropdown(), 10);
    });

    menuEl.appendChild(listsBtn);
    menuEl.appendChild(projectsBtn);
    menuBtn.parentElement.appendChild(menuEl);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function handler(ev) {
        if (!menuEl || !menuEl.contains(ev.target)) {
          closeMenu();
          document.removeEventListener('click', handler);
        }
      });
    }, 0);
  });
}

function setupNavigation() {
  document.getElementById('btn-prev').addEventListener('click', () => navigateDay(-1));
  document.getElementById('btn-next').addEventListener('click', () => navigateDay(1));
  document.getElementById('btn-today').addEventListener('click', goToToday);
  document.getElementById('btn-copy-list').addEventListener('click', copyListToClipboard);
  setupSwipeNavigation();
  setupHamburgerMenu();

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

function updateHash() {
  if (currentView === 'project' && currentProjectId && currentListId) {
    history.replaceState(null, '', '#project/' + currentProjectId + '/' + currentListId);
  } else if (currentView === 'standalone' && currentListId) {
    history.replaceState(null, '', '#list/' + currentListId);
  } else {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

async function restoreFromHash() {
  const hash = window.location.hash;
  const listMatch = hash.match(/^#list\/(.+)$/);
  if (listMatch) {
    const listId = listMatch[1];
    // Verify the list exists
    const list = await storage.getList(listId);
    if (list) {
      await loadStandaloneList(listId);
      return true;
    }
    return false;
  }
  const projMatch = hash.match(/^#project\/([^/]+)\/(.+)$/);
  if (projMatch) {
    const projectId = projMatch[1];
    const listId = projMatch[2];
    const list = await storage.getList(listId);
    if (list) {
      await loadProject(projectId, listId);
      return true;
    }
    return false;
  }
  return false;
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
