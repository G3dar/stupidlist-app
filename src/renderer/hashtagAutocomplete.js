import * as storage from './storage.js';
import { getTagColor } from './tagColors.js';

let dropdown = null;
let selectedIndex = 0;
let selectableItems = [];
let cachedData = null; // { projects, listsByProject }

export function init() {
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('blur', (e) => {
    if (e.target.classList && e.target.classList.contains('item-text')) {
      setTimeout(() => close(), 150);
    }
  }, true);
}

// ── Detect # context near caret ──

function getHashContext(textEl) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return null;

  const node = sel.focusNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  if (!textEl.contains(node)) return null;

  const offset = sel.focusOffset;
  const text = node.textContent.substring(0, offset);

  const match = text.match(/#([^\s#]*)$/);
  if (!match) return null;

  const hashPos = text.lastIndexOf('#' + match[1]);
  // Only trigger if # is at start or preceded by whitespace
  if (hashPos > 0 && text[hashPos - 1] !== ' ' && text[hashPos - 1] !== '\u00a0') return null;

  return { node, hashOffset: hashPos, query: match[1], endOffset: offset };
}

// ── Input handler ──

function onInput(e) {
  const textEl = e.target.closest ? e.target.closest('.item-text') : null;
  if (!textEl) { close(); return; }

  const ctx = getHashContext(textEl);
  if (!ctx) { close(); return; }

  showDropdown(textEl, ctx);
}

// ── Build & show dropdown ──

async function showDropdown(textEl, context) {
  // Cache project/list data for this session
  if (!cachedData) {
    const projects = (await storage.getAllProjects()).filter(p => !p.deleted);
    const listsByProject = {};
    for (const p of projects) {
      listsByProject[p.id] = (await storage.getListsForProject(p.id)).filter(l => !l.deleted);
    }
    cachedData = { projects, listsByProject };
  }

  const { projects, listsByProject } = cachedData;
  const query = context.query.toLowerCase();

  // Build filtered list
  const items = [];
  for (const project of projects) {
    const lists = listsByProject[project.id] || [];
    const matchesProject = !query || project.name.toLowerCase().includes(query);
    const matchingLists = lists.filter(l => l.name.toLowerCase().includes(query));

    if (matchesProject) {
      items.push({ type: 'project', project, name: project.name });
      for (const list of lists) {
        items.push({ type: 'list', project, list, name: list.name });
      }
    } else if (matchingLists.length > 0) {
      items.push({ type: 'project-header', project, name: project.name });
      for (const list of matchingLists) {
        items.push({ type: 'list', project, list, name: list.name });
      }
    }
  }

  if (items.length === 0) { close(); return; }

  // Create or reuse dropdown
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'hashtag-dropdown';
    document.body.appendChild(dropdown);
  }
  dropdown.innerHTML = '';
  selectableItems = [];
  selectedIndex = 0;

  for (const item of items) {
    const row = document.createElement('div');

    if (item.type === 'project-header') {
      // Non-selectable project header (shown for context when only lists match)
      row.className = 'hashtag-dropdown-project-header';
      const colors = getTagColor(item.name);
      row.innerHTML = `<span class="hashtag-dropdown-dot" style="background:${colors.text}"></span>${esc(item.name)}`;
      dropdown.appendChild(row);
      continue;
    }

    if (item.type === 'project') {
      row.className = 'hashtag-dropdown-item hashtag-dropdown-project';
      const colors = getTagColor(item.name);
      row.innerHTML = `<span class="hashtag-dropdown-dot" style="background:${colors.text}"></span>${esc(item.name)}`;
      row.dataset.projectId = item.project.id;
      row.dataset.tagName = item.project.name;
    } else {
      row.className = 'hashtag-dropdown-item hashtag-dropdown-list';
      row.textContent = item.name;
      row.dataset.projectId = item.project.id;
      row.dataset.tagName = `${item.project.name} / ${item.name}`;
    }

    const idx = selectableItems.length;
    row.dataset.index = idx;
    selectableItems.push(row);

    row.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur
    });
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const ctx = getHashContext(textEl);
      if (ctx) selectItem(row, textEl, ctx);
      else close();
    });

    dropdown.appendChild(row);
  }

  updateSelection();
  positionDropdown(textEl, context);
}

function esc(str) {
  const d = document.createElement('span');
  d.textContent = str;
  return d.innerHTML;
}

// ── Position near caret ──

function positionDropdown(textEl, context) {
  const range = document.createRange();
  range.setStart(context.node, context.hashOffset);
  range.setEnd(context.node, context.hashOffset);
  const rect = range.getBoundingClientRect();

  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top = `${rect.bottom + 4}px`;

  // Adjust if off-screen
  const ddRect = dropdown.getBoundingClientRect();
  if (ddRect.right > window.innerWidth) {
    dropdown.style.left = `${window.innerWidth - ddRect.width - 8}px`;
  }
  if (ddRect.bottom > window.innerHeight) {
    dropdown.style.top = `${rect.top - ddRect.height - 4}px`;
  }
}

// ── Keyboard navigation (capture phase) ──

function onKeydown(e) {
  if (!dropdown) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    selectedIndex = Math.min(selectedIndex + 1, selectableItems.length - 1);
    updateSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    selectedIndex = Math.max(selectedIndex - 1, 0);
    updateSelection();
  } else if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    const row = selectableItems[selectedIndex];
    if (row) {
      const textEl = document.activeElement;
      if (textEl && textEl.classList.contains('item-text')) {
        const ctx = getHashContext(textEl);
        if (ctx) { selectItem(row, textEl, ctx); return; }
      }
    }
    close();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close();
  } else if (e.key === ' ') {
    close();
  }
}

function updateSelection() {
  selectableItems.forEach((row, i) => {
    row.classList.toggle('hashtag-dropdown-selected', i === selectedIndex);
  });
  // Scroll selected into view
  const sel = selectableItems[selectedIndex];
  if (sel && dropdown) sel.scrollIntoView({ block: 'nearest' });
}

// ── Select item: replace text, set tag ──

function selectItem(row, textEl, context) {
  const projectId = row.dataset.projectId;
  const tagName = row.dataset.tagName;

  // Remove the #... text from contenteditable
  const range = document.createRange();
  range.setStart(context.node, context.hashOffset);
  range.setEnd(context.node, context.endOffset);
  range.deleteContents();
  textEl.normalize();

  // Get item element and ID
  const li = textEl.closest('.item');
  const itemId = li ? li.dataset.id : null;

  if (itemId) {
    storage.updateItem(itemId, { projectId, projectTag: tagName });

    // Update or create the visible tag badge
    let tagEl = li.querySelector('.item-tag');
    if (!tagEl) {
      tagEl = document.createElement('span');
      tagEl.className = 'item-tag';
      const statusBtn = li.querySelector('.item-status');
      if (statusBtn) li.insertBefore(tagEl, statusBtn);
      else li.appendChild(tagEl);
    }
    tagEl.textContent = `#${tagName}`;
    const colors = getTagColor(tagName);
    tagEl.style.backgroundColor = colors.bg;
    tagEl.style.color = colors.text;
  }

  close();

  // Trigger text save (now without the # text)
  textEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── Dismiss ──

function close() {
  if (dropdown) {
    dropdown.remove();
    dropdown = null;
  }
  selectableItems = [];
  selectedIndex = 0;
  cachedData = null;
}

function onDocumentClick(e) {
  if (dropdown && !dropdown.contains(e.target)) {
    close();
  }
}
