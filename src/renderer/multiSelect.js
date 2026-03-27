import * as storage from './storage.js';
import { FONT_COLORS, BG_COLORS } from './contextMenu.js';
import { toDateKey, addDays, addWorkingDays, nextMonday, formatDateLabel } from '../shared/constants.js';
import * as undoManager from './undoManager.js';

let active = false;
const selectedIds = new Set();
let ctx = null; // { type: 'day'|'list', id, onRefresh }
let barEl = null;
let colorPopupEl = null;
let movePopupEl = null;
let snoozePopupEl = null;

export function isActive() {
  return active;
}

export function enter(itemId, listContext) {
  if (active) return;
  active = true;
  ctx = listContext;
  selectedIds.clear();
  selectedIds.add(itemId);

  const list = document.getElementById('item-list');
  list.classList.add('multiselect-active');

  applyCheckboxes();
  showBar();
}

export function exit() {
  if (!active) return;
  active = false;
  selectedIds.clear();
  ctx = null;

  const list = document.getElementById('item-list');
  if (list) list.classList.remove('multiselect-active');

  // Remove checkboxes
  document.querySelectorAll('.item-select-cb').forEach(cb => cb.remove());

  // Restore contentEditable and draggable
  if (list) {
    list.querySelectorAll('.item-text').forEach(t => { t.contentEditable = 'true'; });
    list.querySelectorAll('.item-number').forEach(n => { n.draggable = true; });
  }

  removeBar();
  closeColorPopup();
  closeMovePopup();
  closeSnoozePopup();
}

export function reapply() {
  if (!active) return;
  applyCheckboxes();
}

function applyCheckboxes() {
  const list = document.getElementById('item-list');
  if (!list) return;

  list.querySelectorAll('.item').forEach(li => {
    if (li.classList.contains('item--spacer')) return;
    if (li.querySelector('.item-select-cb')) return; // already has checkbox

    const id = li.dataset.id;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'item-select-cb';
    cb.checked = selectedIds.has(id);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
      updateCount();
    });

    const num = li.querySelector('.item-number');
    if (num) {
      li.insertBefore(cb, num);
    }

    // Disable editing and drag
    const text = li.querySelector('.item-text');
    if (text) text.contentEditable = 'false';
    if (num) num.draggable = false;
  });

  updateCount();
}

// ── Floating Action Bar ──

function showBar() {
  if (barEl) return;

  barEl = document.createElement('div');
  barEl.className = 'multiselect-bar';

  // Prevent clicks on bar from closing things
  barEl.addEventListener('mousedown', e => e.preventDefault());

  const count = document.createElement('span');
  count.className = 'multiselect-count';
  count.textContent = `${selectedIds.size} selected`;

  const copyBtn = makeBtn('Copy', handleCopy);
  const colorBtn = makeBtn('Color', handleColor);
  const moveBtn = makeBtn('Move to...', handleMove);
  const snoozeBtn = makeBtn('Snooze', handleSnooze);
  const deleteBtn = makeBtn('Delete', handleDelete, true);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'multiselect-done';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => exit());

  barEl.appendChild(count);
  barEl.appendChild(copyBtn);
  barEl.appendChild(colorBtn);
  barEl.appendChild(moveBtn);
  barEl.appendChild(snoozeBtn);
  barEl.appendChild(deleteBtn);
  barEl.appendChild(doneBtn);

  document.body.appendChild(barEl);
}

function makeBtn(label, handler, danger = false) {
  const btn = document.createElement('button');
  btn.className = 'multiselect-action' + (danger ? ' multiselect-action--danger' : '');
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

function removeBar() {
  if (barEl) {
    barEl.remove();
    barEl = null;
  }
}

function updateCount() {
  if (!barEl) return;
  const count = barEl.querySelector('.multiselect-count');
  if (count) count.textContent = `${selectedIds.size} selected`;

  // Disable actions when nothing selected
  barEl.querySelectorAll('.multiselect-action').forEach(btn => {
    btn.disabled = selectedIds.size === 0;
  });
}

// ── Escape key ──

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && active) {
    e.stopPropagation();
    exit();
  }
});

// ── Bulk Operations ──

async function handleCopy() {
  if (selectedIds.size === 0) return;
  const texts = [];
  for (const id of selectedIds) {
    const li = document.querySelector(`[data-id="${id}"]`);
    if (li) {
      const text = li.querySelector('.item-text');
      if (text) texts.push(text.textContent.trim());
    }
  }
  await navigator.clipboard.writeText(texts.join('\n'));

  // Brief feedback
  const copyBtn = barEl.querySelector('.multiselect-action');
  if (copyBtn) {
    const orig = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = orig; }, 1200);
  }
}

async function handleDelete() {
  if (selectedIds.size === 0) return;
  undoManager.startBatch('delete multiple');
  for (const id of selectedIds) {
    const snapshot = await storage.getItem(id);
    if (snapshot) {
      undoManager.push({ type: 'delete', entityType: 'item', id, data: { ...snapshot } });
    }
    await storage.deleteItem(id);
  }
  undoManager.endBatch();
  const refresh = ctx?.onRefresh;
  exit();
  if (refresh) refresh();
}

// ── Color Popup ──

function closeColorPopup() {
  if (colorPopupEl) {
    colorPopupEl.remove();
    colorPopupEl = null;
  }
}

function handleColor(e) {
  if (selectedIds.size === 0) return;
  closeColorPopup();
  closeMovePopup();

  colorPopupEl = document.createElement('div');
  colorPopupEl.className = 'multiselect-popup';

  // Font color row
  const fontLabel = document.createElement('div');
  fontLabel.className = 'multiselect-popup-label';
  fontLabel.textContent = 'Font';
  colorPopupEl.appendChild(fontLabel);

  const fontRow = document.createElement('div');
  fontRow.className = 'ctx-color-row';
  for (const { color, label } of FONT_COLORS) {
    const swatch = document.createElement('button');
    swatch.className = 'ctx-swatch';
    swatch.title = label;
    if (color) {
      swatch.style.background = color;
    } else {
      swatch.classList.add('ctx-swatch--reset');
      swatch.textContent = '\u2298';
    }
    swatch.addEventListener('click', () => applyColor('color', color));
    fontRow.appendChild(swatch);
  }
  colorPopupEl.appendChild(fontRow);

  // Background color row
  const bgLabel = document.createElement('div');
  bgLabel.className = 'multiselect-popup-label';
  bgLabel.textContent = 'Background';
  colorPopupEl.appendChild(bgLabel);

  const bgRow = document.createElement('div');
  bgRow.className = 'ctx-color-row';
  for (const { color, label } of BG_COLORS) {
    const swatch = document.createElement('button');
    swatch.className = 'ctx-swatch';
    swatch.title = label;
    if (color) {
      swatch.style.background = color;
    } else {
      swatch.classList.add('ctx-swatch--reset');
      swatch.textContent = '\u2298';
    }
    swatch.addEventListener('click', () => applyColor('bgColor', color));
    bgRow.appendChild(swatch);
  }
  colorPopupEl.appendChild(bgRow);

  // Position above the Color button
  const btnRect = e.target.getBoundingClientRect();
  colorPopupEl.style.left = `${btnRect.left}px`;
  colorPopupEl.style.bottom = `${window.innerHeight - btnRect.top + 8}px`;

  document.body.appendChild(colorPopupEl);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', onColorOutsideClick);
  }, 0);
}

function onColorOutsideClick(e) {
  if (colorPopupEl && !colorPopupEl.contains(e.target)) {
    closeColorPopup();
    document.removeEventListener('click', onColorOutsideClick);
  }
}

async function applyColor(prop, color) {
  undoManager.startBatch('color multiple');
  for (const id of selectedIds) {
    const snapshot = await storage.getItem(id);
    const oldVal = snapshot ? (snapshot[prop] || null) : null;
    await storage.updateItem(id, { [prop]: color });
    undoManager.push({ type: 'update', entityType: 'item', id, before: { [prop]: oldVal }, after: { [prop]: color } });
    const li = document.querySelector(`[data-id="${id}"]`);
    if (li) {
      if (prop === 'color') {
        li.style.color = color || '';
      } else {
        li.style.backgroundColor = color || '';
      }
    }
  }
  undoManager.endBatch();
  closeColorPopup();
  document.removeEventListener('click', onColorOutsideClick);
}

// ── Move Popup ──

function closeMovePopup() {
  if (movePopupEl) {
    movePopupEl.remove();
    movePopupEl = null;
  }
  document.removeEventListener('click', onMoveOutsideClick);
}

async function handleMove(e) {
  if (selectedIds.size === 0) return;
  closeMovePopup();
  closeColorPopup();

  movePopupEl = document.createElement('div');
  movePopupEl.className = 'multiselect-popup multiselect-popup--move';

  // "Today" option for items in project lists
  if (ctx?.type === 'list') {
    const todayOpt = document.createElement('div');
    todayOpt.className = 'ctx-menu-item';
    todayOpt.textContent = 'Today';
    todayOpt.addEventListener('click', async () => {
      const dayKey = toDateKey(new Date());
      undoManager.startBatch('move multiple to today');
      for (const id of selectedIds) {
        const snapshot = await storage.getItem(id);
        const newItem = await storage.moveItemFromListToDay(id, dayKey);
        if (snapshot && newItem) {
          undoManager.push({ type: 'delete', entityType: 'item', id, data: { ...snapshot } });
          undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
        }
      }
      undoManager.endBatch();
      const refresh = ctx?.onRefresh;
      closeMovePopup();
      exit();
      if (refresh) refresh();
    });
    movePopupEl.appendChild(todayOpt);
  }

  const projects = await storage.getAllProjects();
  for (const project of projects) {
    const lists = await storage.getListsForProject(project.id);
    if (lists.length === 0) continue;

    const projectLabel = document.createElement('div');
    projectLabel.className = 'multiselect-popup-label';
    projectLabel.textContent = project.name;
    movePopupEl.appendChild(projectLabel);

    for (const list of lists) {
      const listOpt = document.createElement('div');
      listOpt.className = 'ctx-menu-item';
      listOpt.textContent = list.name;
      listOpt.addEventListener('click', async () => {
        undoManager.startBatch('move multiple to list');
        for (const id of selectedIds) {
          const snapshot = await storage.getItem(id);
          const newItem = await storage.moveItemToList(id, list.id);
          if (snapshot && newItem) {
            undoManager.push({ type: 'delete', entityType: 'item', id, data: { ...snapshot } });
            undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
          }
        }
        undoManager.endBatch();
        const refresh = ctx?.onRefresh;
        closeMovePopup();
        exit();
        if (refresh) refresh();
      });
      movePopupEl.appendChild(listOpt);
    }
  }

  if (movePopupEl.children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'multiselect-popup-label';
    empty.textContent = 'No projects';
    movePopupEl.appendChild(empty);
  }

  // Position above the Move button
  const btnRect = e.target.getBoundingClientRect();
  movePopupEl.style.left = `${btnRect.left}px`;
  movePopupEl.style.bottom = `${window.innerHeight - btnRect.top + 8}px`;

  document.body.appendChild(movePopupEl);

  setTimeout(() => {
    document.addEventListener('click', onMoveOutsideClick);
  }, 0);
}

function onMoveOutsideClick(e) {
  if (movePopupEl && !movePopupEl.contains(e.target)) {
    closeMovePopup();
  }
}

// ── Snooze Popup ──

function closeSnoozePopup() {
  if (snoozePopupEl) {
    snoozePopupEl.remove();
    snoozePopupEl = null;
  }
  document.removeEventListener('click', onSnoozeOutsideClick);
}

async function handleSnooze(e) {
  if (selectedIds.size === 0) return;
  closeSnoozePopup();
  closeColorPopup();
  closeMovePopup();

  snoozePopupEl = document.createElement('div');
  snoozePopupEl.className = 'multiselect-popup multiselect-popup--snooze';

  const todayKey = toDateKey(new Date());
  const options = [
    { label: 'Tomorrow', dateKey: addDays(todayKey, 1) },
    { label: 'In 3 working days', dateKey: addWorkingDays(todayKey, 3) },
    { label: 'Next week', dateKey: nextMonday(todayKey) },
    { label: 'In 2 weeks', dateKey: addDays(nextMonday(todayKey), 7) },
  ];

  for (const opt of options) {
    const optItem = document.createElement('div');
    optItem.className = 'ctx-menu-item';
    optItem.innerHTML = `<span>${opt.label}</span><span class="ctx-snooze-date">${formatDateLabel(opt.dateKey)}</span>`;
    optItem.addEventListener('click', () => snoozeSelected(opt.dateKey));
    snoozePopupEl.appendChild(optItem);
  }

  const btnRect = e.target.getBoundingClientRect();
  snoozePopupEl.style.left = `${btnRect.left}px`;
  snoozePopupEl.style.bottom = `${window.innerHeight - btnRect.top + 8}px`;

  document.body.appendChild(snoozePopupEl);

  setTimeout(() => {
    document.addEventListener('click', onSnoozeOutsideClick);
  }, 0);
}

function onSnoozeOutsideClick(e) {
  if (snoozePopupEl && !snoozePopupEl.contains(e.target)) {
    closeSnoozePopup();
  }
}

async function snoozeSelected(dateKey) {
  undoManager.startBatch('snooze multiple');
  for (const id of selectedIds) {
    const snapshot = await storage.getItem(id);
    let newItem;
    if (snapshot && snapshot.listId) {
      newItem = await storage.moveItemFromListToDay(id, dateKey);
    } else {
      newItem = await storage.moveItemToDay(id, dateKey);
    }
    if (snapshot && newItem) {
      if (snapshot.listId) {
        undoManager.push({ type: 'delete', entityType: 'item', id, data: { ...snapshot } });
      } else {
        undoManager.push({ type: 'update', entityType: 'item', id, before: { done: snapshot.done }, after: { done: true } });
      }
      undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
    }
  }
  undoManager.endBatch();
  const refresh = ctx?.onRefresh;
  closeSnoozePopup();
  exit();
  if (refresh) refresh();
}
