import { STATUS_CYCLE, STATUS_LABELS, STATUS_ICONS } from '../shared/constants.js';
import * as storage from './storage.js';
import { markdownToHtml } from './formatting.js';
import * as contextMenu from './contextMenu.js';
import * as statusConfig from './statusConfig.js';
import { getTagColor } from './tagColors.js';
import * as undoManager from './undoManager.js';

export function create(itemData, callbacks) {
  const { onDelete, onNewBelow, onFocusPrev, onFocusNext, onReorder, onPasteMultiple, onIndent, onUnindent, onToggleDone, onConvertToSpacer, onRefresh, isParent, listContext } = callbacks;

  // Spacer: minimal half-height element
  if (itemData.isSpacer) {
    const li = document.createElement('li');
    li.className = 'item item--spacer';
    li.dataset.id = itemData.id;
    li.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        onDelete(itemData.id, li);
      }
    });
    return li;
  }

  const li = document.createElement('li');
  li.className = 'item';
  li.dataset.id = itemData.id;
  if (itemData.depth > 0) li.classList.add('item--child');
  if (isParent) li.classList.add('item--parent');
  if (itemData._isTagged) li.classList.add('item--tagged');
  applyClasses(li, itemData);

  // Apply saved colors
  if (itemData.color) li.style.color = itemData.color;
  if (itemData.bgColor) li.style.backgroundColor = itemData.bgColor;

  // Right-click: context menu for project actions
  li.addEventListener('contextmenu', (e) => {
    contextMenu.showForItem(e, itemData, onRefresh || (() => {}), () => onDelete(itemData.id, li), listContext);
  });

  // Touch: long press (still) = context menu, long press + drag = reorder
  {
    let touchTimer = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let longPressed = false;
    let dragging = false;
    let dropTarget = null;

    li.addEventListener('touchstart', (e) => {
      if (e.target.closest('.item-status') || e.target.closest('.item-done')) return;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      longPressed = false;
      dragging = false;
      dropTarget = null;

      touchTimer = setTimeout(() => {
        longPressed = true;
        if (navigator.vibrate) navigator.vibrate(50);
        li.classList.add('touch-active');
      }, 500);
    }, { passive: true });

    li.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!longPressed) {
        if (dist > 10) clearTimeout(touchTimer);
        return;
      }

      // Long press active — start dragging
      if (!dragging) {
        dragging = true;
        li.classList.add('dragging');
        li.classList.remove('touch-active');
      }

      e.preventDefault();

      // Find target item under finger
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetLi = el ? el.closest('.item') : null;

      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      if (targetLi && targetLi !== li) {
        targetLi.classList.add('drag-over');
        dropTarget = targetLi;
      } else {
        dropTarget = null;
      }
    }, { passive: false });

    li.addEventListener('touchend', (e) => {
      clearTimeout(touchTimer);
      li.classList.remove('touch-active');

      if (dragging) {
        li.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
        if (dropTarget && dropTarget.dataset.id !== itemData.id) {
          onReorder(itemData.id, dropTarget.dataset.id);
        }
        dragging = false;
        dropTarget = null;
      } else if (longPressed) {
        // Long press without drag = context menu
        const touch = e.changedTouches[0];
        const fakeEvent = {
          preventDefault() {},
          stopPropagation() {},
          clientX: touch.clientX,
          clientY: touch.clientY,
          target: li
        };
        contextMenu.showForItem(fakeEvent, itemData, onRefresh || (() => {}), () => onDelete(itemData.id, li), listContext);
      }

      longPressed = false;
    });

    li.addEventListener('touchcancel', () => {
      clearTimeout(touchTimer);
      li.classList.remove('touch-active', 'dragging');
      document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      longPressed = false;
      dragging = false;
    });
  }

  // Middle-click: delete if not_started, otherwise reset status
  li.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      if (itemData.status !== 'not_started') {
        const oldStatus = itemData.status;
        itemData.status = 'not_started';
        storage.updateItem(itemData.id, { status: 'not_started' });
        undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: { status: oldStatus }, after: { status: 'not_started' } });
        applyClasses(li, itemData);
        const statusBtn = li.querySelector('.item-status');
        if (statusBtn) updateStatusBtn(statusBtn, 'not_started');
      } else {
        onDelete(itemData.id, li);
      }
    }
  });

  // Drag handle (number)
  const num = document.createElement('span');
  num.className = 'item-number';
  num.textContent = '';
  num.draggable = true;

  num.addEventListener('dragstart', (e) => {
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemData.id);
  });

  num.addEventListener('dragend', () => {
    li.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  li.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = document.querySelector('.dragging');
    if (dragging && dragging !== li) {
      li.classList.add('drag-over');
    }
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('drag-over');
  });

  li.addEventListener('drop', (e) => {
    e.preventDefault();
    li.classList.remove('drag-over');
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== itemData.id) {
      onReorder(draggedId, itemData.id);
    }
  });

  // Text content
  const text = document.createElement('span');
  text.className = 'item-text';
  text.contentEditable = 'true';
  text.spellcheck = false;
  text.dataset.placeholder = isParent ? 'Group title...' : 'Type something...';

  if (itemData.text) {
    // Migrate old markdown text to HTML on first load
    const hasHtml = /<[a-z][\s\S]*>/i.test(itemData.text) || /&[a-z]+;/i.test(itemData.text);
    text.innerHTML = hasHtml ? itemData.text : markdownToHtml(itemData.text);
  }

  let textBeforeEdit = null;

  text.addEventListener('focus', () => {
    // Capture text for undo
    textBeforeEdit = itemData.text || '';

    // Keep HTML formatting — just move cursor to end
    const range = document.createRange();
    const sel = window.getSelection();
    if (text.childNodes.length > 0) {
      range.selectNodeContents(text);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // Debounced auto-save while typing (every 500ms)
  let saveTimer = null;
  function saveText() {
    const html = text.innerHTML;
    const plain = text.textContent.trim();
    if (html !== itemData.text) {
      itemData.text = plain ? html : '';
      storage.updateItem(itemData.id, { text: itemData.text });
    }
  }

  text.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveText, 500);
  });

  text.addEventListener('blur', () => {
    clearTimeout(saveTimer);
    saveText();
    // Push undo entry for the whole edit session
    if (textBeforeEdit !== null && itemData.text !== textBeforeEdit) {
      undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: { text: textBeforeEdit }, after: { text: itemData.text } });
    }
    textBeforeEdit = null;
  });

  text.addEventListener('paste', (e) => {
    const clipboard = (e.clipboardData || window.clipboardData).getData('text');
    const lines = clipboard.split(/\r?\n/).filter(l => l.trim() !== '');

    if (lines.length > 1) {
      e.preventDefault();
      text.textContent = lines[0].trim();
      itemData.text = lines[0].trim();
      storage.updateItem(itemData.id, { text: itemData.text });
      onPasteMultiple(itemData.id, lines.slice(1).map(l => l.trim()));
    }
  });

  text.addEventListener('keydown', (e) => {
    // Tab: indent as sub-item
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (itemData.depth === 0) {
        onIndent(itemData.id, li);
      }
    }

    // Shift+Tab: un-indent
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (itemData.depth > 0) {
        onUnindent(itemData.id, li);
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.textContent.trim() === '') {
        onConvertToSpacer(itemData.id, li);
        return;
      }
      text.blur();
      onNewBelow(itemData.id);
    }

    if (e.key === 'Backspace' && text.textContent.trim() === '') {
      e.preventDefault();
      onDelete(itemData.id, li);
    }

    if (e.key === 'ArrowUp' && !e.shiftKey) {
      if (isOnFirstLine(text)) {
        e.preventDefault();
        onFocusPrev(li);
      }
    }

    if (e.key === 'ArrowDown' && !e.shiftKey) {
      if (isOnLastLine(text)) {
        e.preventDefault();
        onFocusNext(li);
      }
    }

    // Ctrl+D: toggle done
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      onToggleDone(itemData.id, li);
    }

    // Ctrl+B: bold
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      document.execCommand('bold');
    }

    // Ctrl+I: italic
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      document.execCommand('italic');
    }

    // Ctrl+U: underline
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      document.execCommand('underline');
    }
  });

  // Status button (hidden for parents)
  const statusBtn = document.createElement('button');
  statusBtn.className = 'item-status';

  // Resolve statuses for this item's context
  const listId = itemData.listId || null;
  const resolvedStatuses = getResolvedStatuses(listId);
  const isStatusHidden = resolvedStatuses.length === 0;

  if (isStatusHidden) {
    statusBtn.style.display = 'none';
  } else {
    updateStatusBtn(statusBtn, itemData.status, resolvedStatuses);
  }

  statusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleStatus(li, itemData, resolvedStatuses);
  });

  // Right-click on status button: configure statuses
  statusBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    statusConfig.showConfigPopup(e, listId, () => {
      if (onRefresh) onRefresh();
    });
  });

  // Done button (checkbox for items, group-done for parents)
  const doneBtn = document.createElement('button');
  doneBtn.className = 'item-done';
  doneBtn.innerHTML = itemData.done ? '☑' : '☐';
  doneBtn.title = isParent ? 'Mark all done' : (itemData.done ? 'Mark not done' : 'Mark done');

  doneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleDone(itemData.id, li);
  });

  li.appendChild(num);
  li.appendChild(text);

  // Project tag badge (after text, before status)
  if (itemData.projectTag) {
    const tag = document.createElement('span');
    tag.className = 'item-tag';
    tag.textContent = `#${itemData.projectTag}`;
    const colors = getTagColor(itemData.projectTag);
    tag.style.backgroundColor = colors.bg;
    tag.style.color = colors.text;
    li.appendChild(tag);
  }

  if (!isParent) {
    li.appendChild(statusBtn);
  }
  li.appendChild(doneBtn);

  return li;
}

function getResolvedStatuses(listId) {
  // Synchronous read from localStorage
  try {
    const key = listId ? `listStatuses_${listId}` : 'dayStatuses';
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed) return parsed;
    }
  } catch {}
  return statusConfig.getGlobalDefaults();
}

function cycleStatus(li, itemData, statuses) {
  if (!statuses || statuses.length === 0) return;
  const cycle = statusConfig.getCycle(statuses);
  const currentIndex = cycle.indexOf(itemData.status);
  const nextStatus = cycle[(currentIndex + 1) % cycle.length];

  const oldStatus = itemData.status;
  itemData.status = nextStatus;
  storage.updateItem(itemData.id, { status: nextStatus });
  undoManager.push({ type: 'update', entityType: 'item', id: itemData.id, before: { status: oldStatus }, after: { status: nextStatus } });

  applyClasses(li, itemData);
  const statusBtn = li.querySelector('.item-status');
  updateStatusBtn(statusBtn, nextStatus, statuses);
}

function updateStatusBtn(btn, status, statuses) {
  let label, icon;
  if (statuses) {
    label = statusConfig.getLabel(statuses, status);
    icon = statusConfig.getIcon(statuses, status);
  } else {
    label = STATUS_LABELS[status] || '—';
    icon = STATUS_ICONS[status] || '○';
  }
  btn.innerHTML = `<span class="status-icon">${icon}</span><span class="status-label"> ${label}</span>`;
  btn.title = `Status: ${label}`;
  btn.dataset.status = status;
}

function applyClasses(li, itemData) {
  li.classList.remove('item--done', 'item--in_progress', 'item--waiting', 'item--tbd');
  if (itemData.done) {
    li.classList.add('item--done');
  }
  if (itemData.status && itemData.status !== 'not_started') {
    li.classList.add(`item--${itemData.status}`);
  }
}

function isOnFirstLine(el) {
  if (!el.textContent) return true;
  const sel = window.getSelection();
  if (!sel.rangeCount) return true;

  const cursorRange = sel.getRangeAt(0).cloneRange();
  cursorRange.collapse(true);

  const startRange = document.createRange();
  startRange.setStart(el, 0);
  startRange.collapse(true);

  const cursorRect = cursorRange.getBoundingClientRect();
  const startRect = startRange.getBoundingClientRect();

  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return Math.abs(cursorRect.top - startRect.top) < lineHeight * 0.5;
}

function isOnLastLine(el) {
  if (!el.textContent) return true;
  const sel = window.getSelection();
  if (!sel.rangeCount) return true;

  const cursorRange = sel.getRangeAt(0).cloneRange();
  cursorRange.collapse(false);

  const endRange = document.createRange();
  endRange.selectNodeContents(el);
  endRange.collapse(false);

  const cursorRect = cursorRange.getBoundingClientRect();
  const endRect = endRange.getBoundingClientRect();

  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return Math.abs(cursorRect.top - endRect.top) < lineHeight * 0.5;
}

export function focusText(li) {
  const text = li.querySelector('.item-text');
  if (text) {
    text.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    if (text.childNodes.length > 0) {
      range.selectNodeContents(text);
      range.collapse(false);
    } else {
      range.setStart(text, 0);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
