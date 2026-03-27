import * as storage from './storage.js';
import { toDateKey, addDays, addWorkingDays, nextMonday, formatDateLabel } from '../shared/constants.js';
import { saveStatusesForList, getGlobalDefaults } from './statusConfig.js';
import * as multiSelect from './multiSelect.js';
import { getTagColor } from './tagColors.js';
import * as undoManager from './undoManager.js';

let activeMenu = null;
let savedSelection = null;

function close() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

document.addEventListener('click', close);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
});

function saveSelection() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    savedSelection = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  if (savedSelection) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelection);
  }
}

export const FONT_COLORS = [
  { color: null, label: 'Normal' },
  { color: '#1a1a1a', label: 'Black' },
  { color: '#dc2626', label: 'Red' },
  { color: '#2563eb', label: 'Blue' },
  { color: '#16a34a', label: 'Green' },
  { color: '#ea580c', label: 'Orange' },
  { color: '#9333ea', label: 'Purple' },
];

export const BG_COLORS = [
  { color: null, label: 'None' },
  { color: '#fef9e7', label: 'Yellow' },
  { color: '#e8f5e9', label: 'Green' },
  { color: '#e8f0fe', label: 'Blue' },
  { color: '#fce4ec', label: 'Pink' },
  { color: '#fff3e0', label: 'Orange' },
];

export async function showForItem(e, itemData, onRefresh, onDelete, listContext) {
  e.preventDefault();

  // Notify main process IMMEDIATELY (before any await) to suppress native menu
  if (window.stupidlist && window.stupidlist.notifyContextMenuHandled) {
    window.stupidlist.notifyContextMenuHandled();
  }

  close();

  // Save text selection before menu opens
  saveSelection();
  const hasSelection = window.getSelection().toString().length > 0;
  const isInText = e.target.closest('.item-text') !== null;

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';

  // Prevent menu clicks from stealing focus/selection
  menu.addEventListener('mousedown', (ev) => ev.preventDefault());

  // ── Color section (applies to entire item row) ──
  {
    const li = e.target.closest('.item');

    // Font color row
    const fontRow = document.createElement('div');
    fontRow.className = 'ctx-color-row';

    const fontIcon = document.createElement('span');
    fontIcon.className = 'ctx-color-icon';
    fontIcon.innerHTML = 'A';
    fontIcon.title = 'Font color';
    fontRow.appendChild(fontIcon);

    for (const { color, label } of FONT_COLORS) {
      const swatch = document.createElement('button');
      swatch.className = 'ctx-swatch';
      swatch.title = label;
      if (color) {
        swatch.style.background = color;
      } else {
        swatch.classList.add('ctx-swatch--reset');
        swatch.textContent = '⊘';
      }
      swatch.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        close();
        const oldColor = itemData.color || null;
        await storage.updateItem(itemData.id, { color: color });
        undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: { color: oldColor }, after: { color: color } });
        itemData.color = color;
        if (li) li.style.color = color || '';
      });
      fontRow.appendChild(swatch);
    }
    menu.appendChild(fontRow);

    // Background color row
    const bgRow = document.createElement('div');
    bgRow.className = 'ctx-color-row';

    const bgIcon = document.createElement('span');
    bgIcon.className = 'ctx-color-icon ctx-color-icon--bg';
    bgIcon.innerHTML = '<span></span>';
    bgIcon.title = 'Background color';
    bgRow.appendChild(bgIcon);

    for (const { color, label } of BG_COLORS) {
      const swatch = document.createElement('button');
      swatch.className = 'ctx-swatch';
      swatch.title = label;
      if (color) {
        swatch.style.background = color;
      } else {
        swatch.classList.add('ctx-swatch--reset');
        swatch.textContent = '⊘';
      }
      swatch.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        close();
        const oldBgColor = itemData.bgColor || null;
        await storage.updateItem(itemData.id, { bgColor: color });
        undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: { bgColor: oldBgColor }, after: { bgColor: color } });
        itemData.bgColor = color;
        if (li) li.style.backgroundColor = color || '';
      });
      bgRow.appendChild(swatch);
    }
    menu.appendChild(bgRow);
  }

  // ── Select items (multi-select mode) ──
  if (listContext && !multiSelect.isActive()) {
    const selectItem = document.createElement('div');
    selectItem.className = 'ctx-menu-item';
    selectItem.textContent = 'Select items';
    selectItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      close();
      multiSelect.enter(itemData.id, listContext);
    });
    menu.appendChild(selectItem);
  }

  // ── Show status option (only if hidden) ──
  {
    const listId = itemData.listId || null;
    const key = listId ? `listStatuses_${listId}` : 'dayStatuses';
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length === 0) {
          const showStatusItem = document.createElement('div');
          showStatusItem.className = 'ctx-menu-item';
          showStatusItem.textContent = 'Show status';
          showStatusItem.addEventListener('click', (ev) => {
            ev.stopPropagation();
            close();
            saveStatusesForList(listId, getGlobalDefaults());
            onRefresh();
          });
          menu.appendChild(showStatusItem);
        }
      }
    } catch {}
  }

  // ── Project section (hidden in shared view) ──
  const projects = (!listContext || !listContext.isSharedView) ? await storage.getAllProjects() : [];

  if (projects.length > 0) {
    // "Move to..." as a single item with nested submenu of projects
    const moveItem = document.createElement('div');
    moveItem.className = 'ctx-menu-item ctx-menu-parent';
    moveItem.innerHTML = '<span>Move to...</span><span class="ctx-menu-arrow">▸</span>';

    const moveSubmenu = document.createElement('div');
    moveSubmenu.className = 'ctx-submenu';

    // "Today" option — move item to today's daily list
    if (itemData.listId) {
      const todayItem = document.createElement('div');
      todayItem.className = 'ctx-menu-item';
      todayItem.textContent = 'Today';
      todayItem.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        close();
        const originalSnapshot = await storage.getItem(itemData.id);
        const newItem = await storage.moveItemFromListToDay(itemData.id, toDateKey(new Date()));
        if (originalSnapshot && newItem) {
          undoManager.startBatch('move to today');
          undoManager.push({ type: 'delete', entityType: 'item', id: itemData.id, data: { ...originalSnapshot } });
          undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
          undoManager.endBatch();
        }
        onRefresh();
      });
      moveSubmenu.appendChild(todayItem);
    }

    for (const project of projects) {
      const lists = await storage.getListsForProject(project.id);
      const projectItem = document.createElement('div');
      projectItem.className = 'ctx-menu-item ctx-menu-parent';

      const label = document.createElement('span');
      label.textContent = project.name;
      const arrow = document.createElement('span');
      arrow.className = 'ctx-menu-arrow';
      arrow.textContent = '▸';

      projectItem.appendChild(label);
      projectItem.appendChild(arrow);

      const listSubmenu = document.createElement('div');
      listSubmenu.className = 'ctx-submenu';

      for (const list of lists) {
        const listItem = document.createElement('div');
        listItem.className = 'ctx-menu-item';
        listItem.textContent = list.name;
        listItem.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          close();
          const originalSnapshot = await storage.getItem(itemData.id);
          const newItem = await storage.moveItemToList(itemData.id, list.id);
          if (originalSnapshot && newItem) {
            undoManager.startBatch('move to list');
            undoManager.push({ type: 'delete', entityType: 'item', id: itemData.id, data: { ...originalSnapshot } });
            undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
            undoManager.endBatch();
          }
          onRefresh();
        });
        listSubmenu.appendChild(listItem);
      }

      projectItem.appendChild(listSubmenu);
      moveSubmenu.appendChild(projectItem);
    }

    moveItem.appendChild(moveSubmenu);
    menu.appendChild(moveItem);

    // "Tag as..." with nested Project > List submenus
    const tagItem = document.createElement('div');
    tagItem.className = 'ctx-menu-item ctx-menu-parent';
    tagItem.innerHTML = '<span>Tag as...</span><span class="ctx-menu-arrow">▸</span>';

    const tagSubmenu = document.createElement('div');
    tagSubmenu.className = 'ctx-submenu';

    // "No tag" option to remove
    const noTag = document.createElement('div');
    noTag.className = 'ctx-menu-item';
    noTag.textContent = '⊘ None';
    noTag.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      close();
      const oldData = { projectId: itemData.projectId || null, projectTag: itemData.projectTag || null, tagListId: itemData.tagListId || null, tagOrder: itemData.tagOrder ?? null };
      await storage.untagItem(itemData.id);
      undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: oldData, after: { projectId: null, projectTag: null, tagListId: null, tagOrder: null } });
      itemData.projectId = null;
      itemData.projectTag = null;
      itemData.tagListId = null;
      itemData.tagOrder = null;
      onRefresh();
    });
    tagSubmenu.appendChild(noTag);

    for (const project of projects) {
      const lists = await storage.getListsForProject(project.id);
      const tagColors = getTagColor(project.name);

      const projectOpt = document.createElement('div');
      projectOpt.className = 'ctx-menu-item ctx-menu-parent';

      const label = document.createElement('span');
      label.textContent = `#${project.name}`;
      label.style.color = tagColors.text;
      const arrow = document.createElement('span');
      arrow.className = 'ctx-menu-arrow';
      arrow.textContent = '▸';

      projectOpt.appendChild(label);
      projectOpt.appendChild(arrow);

      const listSubmenu = document.createElement('div');
      listSubmenu.className = 'ctx-submenu';

      // Each list in the project
      for (const list of lists) {
        const listOpt = document.createElement('div');
        listOpt.className = 'ctx-menu-item';
        listOpt.textContent = list.name;
        listOpt.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          close();
          const oldData = { projectId: itemData.projectId || null, projectTag: itemData.projectTag || null, tagListId: itemData.tagListId || null, tagOrder: itemData.tagOrder ?? null };
          await storage.tagItemToList(itemData.id, list.id, project.id, project.name);
          undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: oldData, after: { projectId: project.id, projectTag: project.name, tagListId: list.id } });
          itemData.projectId = project.id;
          itemData.projectTag = project.name;
          itemData.tagListId = list.id;
          onRefresh();
        });
        listSubmenu.appendChild(listOpt);
      }

      // Separator + default "Tagged" list option
      const sep = document.createElement('div');
      sep.className = 'ctx-submenu-separator';
      listSubmenu.appendChild(sep);

      const defaultOpt = document.createElement('div');
      defaultOpt.className = 'ctx-menu-item';
      defaultOpt.textContent = `#${project.name}`;
      defaultOpt.style.color = tagColors.text;
      defaultOpt.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        close();
        const oldData = { projectId: itemData.projectId || null, projectTag: itemData.projectTag || null, tagListId: itemData.tagListId || null, tagOrder: itemData.tagOrder ?? null };
        const tagList = await storage.getOrCreateDefaultTagList(project.id);
        await storage.tagItemToList(itemData.id, tagList.id, project.id, project.name);
        undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: oldData, after: { projectId: project.id, projectTag: project.name, tagListId: tagList.id } });
        itemData.projectId = project.id;
        itemData.projectTag = project.name;
        itemData.tagListId = tagList.id;
        onRefresh();
      });
      listSubmenu.appendChild(defaultOpt);

      projectOpt.appendChild(listSubmenu);
      tagSubmenu.appendChild(projectOpt);
    }

    tagItem.appendChild(tagSubmenu);
    menu.appendChild(tagItem);
  }

  // ── Snooze submenu (hidden in shared view) ──
  if (!listContext || !listContext.isSharedView) {
    const snoozeItem = document.createElement('div');
    snoozeItem.className = 'ctx-menu-item ctx-menu-parent';
    snoozeItem.innerHTML = '<span>Snooze</span><span class="ctx-menu-arrow">▸</span>';

    const snoozeSubmenu = document.createElement('div');
    snoozeSubmenu.className = 'ctx-submenu';

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
      optItem.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        close();
        const originalSnapshot = await storage.getItem(itemData.id);
        let newItem;
        if (itemData.listId) {
          newItem = await storage.moveItemFromListToDay(itemData.id, opt.dateKey);
        } else {
          newItem = await storage.moveItemToDay(itemData.id, opt.dateKey);
        }
        if (originalSnapshot && newItem) {
          undoManager.startBatch('snooze');
          if (itemData.listId) {
            undoManager.push({ type: 'delete', entityType: 'item', id: itemData.id, data: { ...originalSnapshot } });
          } else {
            undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: { done: originalSnapshot.done }, after: { done: true } });
          }
          undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
          undoManager.endBatch();
        }
        onRefresh();
      });
      snoozeSubmenu.appendChild(optItem);
    }

    // "Choose date..." option
    const chooseDateItem = document.createElement('div');
    chooseDateItem.className = 'ctx-menu-item';
    chooseDateItem.textContent = 'Choose date...';
    chooseDateItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const menuX = parseInt(activeMenu.style.left);
      const menuY = parseInt(activeMenu.style.top);
      close();
      showDatePicker(menuX, menuY, async (dateKey) => {
        const originalSnapshot = await storage.getItem(itemData.id);
        let newItem;
        if (itemData.listId) {
          newItem = await storage.moveItemFromListToDay(itemData.id, dateKey);
        } else {
          newItem = await storage.moveItemToDay(itemData.id, dateKey);
        }
        if (originalSnapshot && newItem) {
          undoManager.startBatch('snooze to date');
          if (itemData.listId) {
            undoManager.push({ type: 'delete', entityType: 'item', id: itemData.id, data: { ...originalSnapshot } });
          } else {
            undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: { done: originalSnapshot.done }, after: { done: true } });
          }
          undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
          undoManager.endBatch();
        }
        onRefresh();
      });
    });
    snoozeSubmenu.appendChild(chooseDateItem);

    snoozeItem.appendChild(snoozeSubmenu);
    menu.appendChild(snoozeItem);
  }

  // ── Delete option ──
  if (onDelete) {
    const deleteItem = document.createElement('div');
    deleteItem.className = 'ctx-menu-item ctx-menu-item--danger';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      close();
      onDelete();
    });
    menu.appendChild(deleteItem);
  }

  // If menu is empty (no selection, no projects), don't show
  if (menu.children.length === 0) return;

  // Position
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 8}px`;
  }

  activeMenu = menu;

  e.stopPropagation();
}

function showDatePicker(x, y, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'ctx-date-overlay';

  const picker = document.createElement('div');
  picker.className = 'ctx-date-picker';
  picker.style.left = `${x}px`;
  picker.style.top = `${y}px`;

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'ctx-date-input';

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  input.min = toDateKey(tomorrow);
  input.value = toDateKey(tomorrow);

  input.addEventListener('change', () => {
    if (input.value) {
      overlay.remove();
      onSelect(input.value);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') overlay.remove();
    if (e.key === 'Enter' && input.value) {
      overlay.remove();
      onSelect(input.value);
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  picker.appendChild(input);
  overlay.appendChild(picker);
  document.body.appendChild(overlay);
  input.focus();
  input.showPicker?.();
}
