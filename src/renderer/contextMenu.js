import * as storage from './storage.js';
import { toDateKey } from '../shared/constants.js';
import { saveStatusesForList, getGlobalDefaults } from './statusConfig.js';

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

const FONT_COLORS = [
  { color: null, label: 'Normal' },
  { color: '#1a1a1a', label: 'Black' },
  { color: '#dc2626', label: 'Red' },
  { color: '#2563eb', label: 'Blue' },
  { color: '#16a34a', label: 'Green' },
  { color: '#ea580c', label: 'Orange' },
  { color: '#9333ea', label: 'Purple' },
];

const BG_COLORS = [
  { color: null, label: 'None' },
  { color: '#fef9e7', label: 'Yellow' },
  { color: '#e8f5e9', label: 'Green' },
  { color: '#e8f0fe', label: 'Blue' },
  { color: '#fce4ec', label: 'Pink' },
  { color: '#fff3e0', label: 'Orange' },
];

export async function showForItem(e, itemData, onRefresh, onDelete) {
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
        await storage.updateItem(itemData.id, { color: color });
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
        await storage.updateItem(itemData.id, { bgColor: color });
        itemData.bgColor = color;
        if (li) li.style.backgroundColor = color || '';
      });
      bgRow.appendChild(swatch);
    }
    menu.appendChild(bgRow);
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

  // ── Project section ──
  const projects = await storage.getAllProjects();

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
        await storage.moveItemFromListToDay(itemData.id, toDateKey(new Date()));
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
          await storage.moveItemToList(itemData.id, list.id);
          onRefresh();
        });
        listSubmenu.appendChild(listItem);
      }

      projectItem.appendChild(listSubmenu);
      moveSubmenu.appendChild(projectItem);
    }

    moveItem.appendChild(moveSubmenu);
    menu.appendChild(moveItem);

    // "Tag as..." as a single item with nested submenu of projects
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
      await storage.updateItem(itemData.id, { projectId: null, projectTag: null });
      itemData.projectId = null;
      itemData.projectTag = null;
      onRefresh();
    });
    tagSubmenu.appendChild(noTag);

    for (const project of projects) {
      const tagOpt = document.createElement('div');
      tagOpt.className = 'ctx-menu-item';
      tagOpt.textContent = `#${project.name}`;
      tagOpt.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        close();
        await storage.updateItem(itemData.id, { projectId: project.id, projectTag: project.name });
        itemData.projectId = project.id;
        itemData.projectTag = project.name;
        onRefresh();
      });
      tagSubmenu.appendChild(tagOpt);
    }

    tagItem.appendChild(tagSubmenu);
    menu.appendChild(tagItem);
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
