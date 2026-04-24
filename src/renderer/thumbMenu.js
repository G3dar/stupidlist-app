import * as storage from './storage.js';
import { hapticFeedback } from '../shared/platform.js';
import * as multiSelector from './multiSelector.js';
import * as undoManager from './undoManager.js';

let menuEl = null;
let lastTapTime = 0;
let lastTapX = 0;
let lastTapY = 0;
let dismissListener = null;
let callbacks = {};

const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;
const EDGE_MARGIN = 12;

export function init(cbs) {
  callbacks = cbs;
  document.addEventListener('touchstart', onTouchStart, true);
}

function isExcluded(target) {
  return target.closest('#header') ||
    target.closest('.thumb-menu') ||
    target.closest('.ctx-menu') ||
    target.closest('.auth-overlay') ||
    target.closest('.help-overlay') ||
    target.closest('.delete-confirm-overlay') ||
    target.closest('.mobile-menu') ||
    target.closest('.carry-over-overlay') ||
    target.closest('.status-select');
}

function onTouchStart(e) {
  if (e.touches.length > 1) return;
  const touch = e.touches[0];
  const x = touch.clientX;
  const y = touch.clientY;
  const target = e.target;

  if (isExcluded(target)) {
    lastTapTime = 0;
    return;
  }

  const now = Date.now();
  const dt = now - lastTapTime;
  const dx = Math.abs(x - lastTapX);
  const dy = Math.abs(y - lastTapY);

  if (dt < DOUBLE_TAP_MS && dx < DOUBLE_TAP_PX && dy < DOUBLE_TAP_PX) {
    // Prevent focus/keyboard before it happens
    e.preventDefault();
    e.stopPropagation();
    lastTapTime = 0;
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    openMenu(x, y);
  } else {
    lastTapTime = now;
    lastTapX = x;
    lastTapY = y;
  }
}

function openMenu(x, y) {
  close();
  hapticFeedback();

  menuEl = document.createElement('div');
  menuEl.className = 'thumb-menu';
  menuEl.style.left = x + 'px';
  menuEl.style.top = y + 'px';

  renderMainMenu();
  document.body.appendChild(menuEl);

  // Adjust position after render
  requestAnimationFrame(() => {
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;

    if (rect.right > vw - EDGE_MARGIN) left = vw - rect.width - EDGE_MARGIN;
    if (rect.bottom > vh - EDGE_MARGIN) top = y - rect.height;
    if (left < EDGE_MARGIN) left = EDGE_MARGIN;
    if (top < EDGE_MARGIN) top = EDGE_MARGIN;

    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
  });

  // Dismiss on tap outside (delayed to avoid self-close)
  setTimeout(() => {
    dismissListener = (ev) => {
      if (menuEl && !menuEl.contains(ev.target)) {
        close();
      }
    };
    document.addEventListener('click', dismissListener, true);
    document.addEventListener('touchstart', dismissListener, true);
  }, 0);
}

function renderMainMenu() {
  menuEl.innerHTML = '';

  const items = [
    { label: 'Lists', action: () => showListsSubmenu() },
    { label: 'Projects', action: () => showProjectsSubmenu() },
    { label: 'Views', action: () => showViewsSubmenu() },
    { label: 'Today', action: () => { close(); callbacks.onToday(); } }
  ];

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'thumb-menu-item';
    btn.textContent = item.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      item.action();
    });
    menuEl.appendChild(btn);
  });
}

async function showProjectsSubmenu() {
  if (!menuEl) return;
  menuEl.innerHTML = '';

  const back = createBackButton();
  menuEl.appendChild(back);

  const projects = (await storage.getAllProjects()).filter(p => !p.deleted);

  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'thumb-menu-empty';
    empty.textContent = 'No projects';
    menuEl.appendChild(empty);
    return;
  }

  for (const project of projects) {
    const lists = (await storage.getListsForProject(project.id)).filter(l => !l.deleted);
    if (lists.length === 0) continue;

    const header = document.createElement('div');
    header.className = 'thumb-menu-header';
    header.textContent = project.name || 'Untitled';
    menuEl.appendChild(header);

    lists.forEach(list => {
      const btn = document.createElement('button');
      btn.className = 'thumb-menu-item thumb-menu-subitem';
      btn.textContent = list.name || 'Untitled';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        callbacks.onProjectSelect(project.id, list.id);
      });
      menuEl.appendChild(btn);
    });
  }

  repositionMenu();
}

function addLongPressTo(element, callback) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  element.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    timer = setTimeout(() => {
      element._longPressed = true;
      hapticFeedback();
      callback();
    }, 500);
  }, { passive: true });
  element.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (Math.sqrt((touch.clientX - startX) ** 2 + (touch.clientY - startY) ** 2) > 10) {
      clearTimeout(timer);
    }
  }, { passive: true });
  element.addEventListener('touchend', () => clearTimeout(timer));
  element.addEventListener('touchcancel', () => clearTimeout(timer));
}

async function showViewsSubmenu() {
  if (!menuEl) return;
  menuEl.innerHTML = '';

  const back = createBackButton();
  menuEl.appendChild(back);

  // "+ Multi..." button to create a new custom view
  const newBtn = document.createElement('button');
  newBtn.className = 'thumb-menu-item thumb-menu-new';
  newBtn.textContent = '+ Multi view...';
  newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
    openMultiSelector(null);
  });
  menuEl.appendChild(newBtn);

  const customViews = await storage.getAllCustomViews();

  if (customViews.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'thumb-menu-empty';
    empty.textContent = 'No custom views yet';
    menuEl.appendChild(empty);
    repositionMenu();
    return;
  }

  customViews.forEach((view) => {
    const btn = document.createElement('button');
    btn.className = 'thumb-menu-item';
    btn.textContent = view.name || 'Untitled view';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn._longPressed) { btn._longPressed = false; return; }
      close();
      if (callbacks.onCustomViewSelect) callbacks.onCustomViewSelect(view.id);
    });
    addLongPressTo(btn, () => {
      close();
      openMultiSelector(view);
    });
    menuEl.appendChild(btn);
  });

  repositionMenu();
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
        if (callbacks.onCustomViewSelect) callbacks.onCustomViewSelect(existing.id);
      } else {
        const view = await storage.addCustomView(name, selections);
        undoManager.push({ type: 'create', entityType: 'customView', id: view.id, data: { ...view } });
        if (callbacks.onCustomViewSelect) callbacks.onCustomViewSelect(view.id);
      }
    },
    onDelete: existing ? async (view) => {
      undoManager.push({ type: 'delete', entityType: 'customView', id: view.id, data: { ...view } });
      await storage.deleteCustomView(view.id);
      if (callbacks.onToday) callbacks.onToday();
    } : null
  });
}

async function showListsSubmenu() {
  if (!menuEl) return;
  menuEl.innerHTML = '';

  const back = createBackButton();
  menuEl.appendChild(back);

  const lists = (await storage.getStandaloneLists()).filter(l => !l.deleted);
  // Filter out empty untitled lists
  const visibleLists = lists.filter(l => l.name || (l.items && l.items.length > 0));

  if (visibleLists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'thumb-menu-empty';
    empty.textContent = 'No lists';
    menuEl.appendChild(empty);
    return;
  }

  visibleLists.forEach(list => {
    const btn = document.createElement('button');
    btn.className = 'thumb-menu-item';
    btn.textContent = list.name || 'Untitled';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      callbacks.onListSelect(list.id);
    });
    menuEl.appendChild(btn);
  });

  repositionMenu();
}

function createBackButton() {
  const btn = document.createElement('button');
  btn.className = 'thumb-menu-back';
  btn.textContent = '\u2190 Back';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderMainMenu();
    repositionMenu();
  });
  return btn;
}

function repositionMenu() {
  if (!menuEl) return;
  requestAnimationFrame(() => {
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = parseInt(menuEl.style.left);
    let top = parseInt(menuEl.style.top);

    if (rect.right > vw - EDGE_MARGIN) left = vw - rect.width - EDGE_MARGIN;
    if (rect.bottom > vh - EDGE_MARGIN) top = vh - rect.height - EDGE_MARGIN;
    if (left < EDGE_MARGIN) left = EDGE_MARGIN;
    if (top < EDGE_MARGIN) top = EDGE_MARGIN;

    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
  });
}

function close() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  if (dismissListener) {
    document.removeEventListener('click', dismissListener, true);
    document.removeEventListener('touchstart', dismissListener, true);
    dismissListener = null;
  }
}
