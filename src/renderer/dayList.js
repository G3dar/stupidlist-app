import * as storage from './storage.js';
import * as item from './item.js';

let currentDayDate = null;
let itemsCache = []; // cached item data for the current day
const undoStack = []; // max 10 deleted items for Ctrl+Z restore
let showDone = localStorage.getItem('showDone') !== 'false'; // default true

export async function render(dayDate) {
  currentDayDate = dayDate;
  const list = document.getElementById('item-list');
  list.innerHTML = '';

  const items = await storage.getItemsForDay(dayDate);

  if (items.length === 0) {
    const newItem = await storage.addItem(dayDate, '');
    items.push(newItem);
  }

  // Build parent set
  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));

  // Sort: group children after their parent, done groups at bottom
  const topLevel = items.filter(i => !i.parentId);
  const sorted = [];
  for (const parent of topLevel) {
    const children = items.filter(i => i.parentId === parent.id).sort((a, b) => a.order - b.order);
    const groupDone = parent.done;
    sorted.push({ ...parent, _isParent: parentIds.has(parent.id), _groupDone: groupDone });
    for (const child of children) {
      sorted.push(child);
    }
  }

  // Split done / not done
  const notDone = sorted.filter(i => !i.done && !i._groupDone);
  const done = sorted.filter(i => i.done || i._groupDone);

  itemsCache = [...notDone, ...done];

  // Render active items
  notDone.forEach((itemData) => {
    const isParent = itemData._isParent || parentIds.has(itemData.id);
    const li = createItemElement(itemData, isParent);
    list.appendChild(li);
  });

  // Done section
  if (done.length > 0) {
    const doneToggle = document.createElement('li');
    doneToggle.className = 'done-toggle';
    const btn = document.createElement('button');
    btn.className = 'done-toggle-btn';
    btn.addEventListener('click', () => {
      showDone = !showDone;
      localStorage.setItem('showDone', showDone);
      render(currentDayDate);
    });
    const eye = document.createElement('span');
    eye.className = 'done-toggle-eye';
    eye.textContent = showDone ? '👁' : '👁‍🗨';
    const span = document.createElement('span');
    span.textContent = `${done.length} finished`;
    btn.appendChild(eye);
    btn.appendChild(span);
    doneToggle.appendChild(btn);
    list.appendChild(doneToggle);

    if (showDone) {
      done.forEach((itemData) => {
        const isParent = itemData._isParent || parentIds.has(itemData.id);
        const li = createItemElement(itemData, isParent);
        list.appendChild(li);
      });
    }
  }

  renumber();
}

function createItemElement(itemData, isParent = false) {
  return item.create(itemData, {
    onDelete: handleDelete,
    onNewBelow: handleNewBelow,
    onFocusPrev: handleFocusPrev,
    onFocusNext: handleFocusNext,
    onReorder: handleReorder,
    onPasteMultiple: handlePasteMultiple,
    onIndent: handleIndent,
    onUnindent: handleUnindent,
    onToggleDone: handleToggleDone,
    onRefresh: () => render(currentDayDate),
    isParent
  });
}

async function handleToggleDone(id, li) {
  const items = await storage.getItemsForDay(currentDayDate);
  const targetItem = items.find(i => i.id === id);
  if (!targetItem) return;

  const newDone = !targetItem.done;
  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));
  const isParent = parentIds.has(id);

  // Toggle done on this item
  await storage.updateItem(id, { done: newDone });

  // If it's a parent, toggle all children too
  if (isParent) {
    const children = items.filter(i => i.parentId === id);
    for (const child of children) {
      await storage.updateItem(child.id, { done: newDone });
    }
  }

  // Re-render the whole list to reorder
  await render(currentDayDate);
}

async function handleNewBelow(afterId) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);
  const afterIndex = domItems.findIndex(li => li.dataset.id === afterId);

  // Get the item to check if it's a child
  const items = await storage.getItemsForDay(currentDayDate);
  const afterItem = items.find(i => i.id === afterId);

  const newItemData = await storage.addItem(currentDayDate, '');

  // If the current item is a child, new item is also a child of the same parent
  if (afterItem && afterItem.parentId) {
    await storage.updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
    newItemData.parentId = afterItem.parentId;
    newItemData.depth = 1;
  }

  const isParent = false;
  const li = createItemElement(newItemData, isParent);

  if (afterIndex >= 0 && afterIndex < domItems.length - 1) {
    list.insertBefore(li, domItems[afterIndex + 1]);
  } else {
    list.appendChild(li);
  }

  renumber();
  await saveOrder();
  item.focusText(li);
}

async function handleDelete(id, element) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);

  if (domItems.length <= 1) return;

  const index = domItems.indexOf(element);

  // Check if this item was a child — if parent has no more children after this, re-render parent
  const items = await storage.getItemsForDay(currentDayDate);
  const deletedItem = items.find(i => i.id === id);
  const parentId = deletedItem ? deletedItem.parentId : null;

  // Push to undo stack before deleting
  if (deletedItem) {
    undoStack.push({ ...deletedItem });
    if (undoStack.length > 10) undoStack.shift();
  }

  await storage.deleteItem(id);
  element.remove();

  // Check if parent should revert to normal item
  if (parentId) {
    const remainingChildren = items.filter(i => i.parentId === parentId && i.id !== id && !i.deleted);
    if (remainingChildren.length === 0) {
      // Re-render to update parent display
      await render(currentDayDate);
      return;
    }
  }

  renumber();
  await saveOrder();

  const remaining = Array.from(list.children);
  if (remaining.length > 0) {
    const focusIndex = Math.max(0, index - 1);
    item.focusText(remaining[focusIndex]);
  }
}

async function handleIndent(id, li) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);
  const index = domItems.indexOf(li);

  if (index <= 0) return; // Can't indent the first item

  // Find the item above
  const prevLi = domItems[index - 1];
  const prevId = prevLi.dataset.id;

  // Get item data
  const items = await storage.getItemsForDay(currentDayDate);
  const prevItem = items.find(i => i.id === prevId);

  // Don't indent under a child (only 1 level deep)
  if (prevItem && prevItem.depth > 0) {
    // Find the parent of the prev item instead
    const parentId = prevItem.parentId;
    if (parentId) {
      await storage.updateItem(id, { parentId: parentId, depth: 1 });
      await render(currentDayDate);
    }
    return;
  }

  // Make this item a child of the previous item
  await storage.updateItem(id, { parentId: prevId, depth: 1 });

  // Re-render to update parent/child display
  await render(currentDayDate);

  // Re-focus the indented item
  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

async function handleUnindent(id, li) {
  const items = await storage.getItemsForDay(currentDayDate);
  const currentItem = items.find(i => i.id === id);
  if (!currentItem || !currentItem.parentId) return;

  const oldParentId = currentItem.parentId;

  // Remove parent relationship
  await storage.updateItem(id, { parentId: null, depth: 0 });

  // Re-render
  await render(currentDayDate);

  // Re-focus
  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

function handleFocusPrev(currentLi) {
  const prev = currentLi.previousElementSibling;
  if (prev) item.focusText(prev);
}

function handleFocusNext(currentLi) {
  const next = currentLi.nextElementSibling;
  if (next) item.focusText(next);
}

async function handlePasteMultiple(afterId, lines) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);
  let afterIndex = domItems.findIndex(li => li.dataset.id === afterId);

  // Check if current item is a child
  const items = await storage.getItemsForDay(currentDayDate);
  const afterItem = items.find(i => i.id === afterId);
  const inheritParent = afterItem && afterItem.parentId;

  for (const lineText of lines) {
    const newItemData = await storage.addItem(currentDayDate, lineText);
    if (inheritParent) {
      await storage.updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
      newItemData.parentId = afterItem.parentId;
      newItemData.depth = 1;
    }
    const li = createItemElement(newItemData, false);
    const currentItems = Array.from(list.children);

    if (afterIndex >= 0 && afterIndex < currentItems.length - 1) {
      list.insertBefore(li, currentItems[afterIndex + 1]);
    } else {
      list.appendChild(li);
    }
    afterIndex++;
  }

  renumber();
  await saveOrder();

  const lastNew = list.children[afterIndex];
  if (lastNew) item.focusText(lastNew);
}

async function handleReorder(draggedId, targetId) {
  const list = document.getElementById('item-list');
  const draggedEl = list.querySelector(`[data-id="${draggedId}"]`);
  const targetEl = list.querySelector(`[data-id="${targetId}"]`);

  if (!draggedEl || !targetEl) return;

  list.insertBefore(draggedEl, targetEl);

  renumber();
  await saveOrder();
}

export async function pasteAsItems(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return;

  const list = document.getElementById('item-list');
  const focused = document.activeElement.closest('.item');
  let afterId = focused ? focused.dataset.id : null;

  if (afterId) {
    const focusedText = focused.querySelector('.item-text');
    if (focusedText && focusedText.textContent.trim() === '') {
      const firstLine = lines.shift();
      focusedText.textContent = firstLine;
      focusedText.blur();
      await storage.updateItem(afterId, { text: firstLine });
    }
  }

  if (lines.length === 0) return;

  let domItems = Array.from(list.children);
  let afterIndex = afterId ? domItems.findIndex(li => li.dataset.id === afterId) : domItems.length - 1;

  for (const lineText of lines) {
    const newItemData = await storage.addItem(currentDayDate, lineText);
    const li = createItemElement(newItemData, false);
    const currentItems = Array.from(list.children);

    if (afterIndex >= 0 && afterIndex < currentItems.length - 1) {
      list.insertBefore(li, currentItems[afterIndex + 1]);
    } else {
      list.appendChild(li);
    }
    afterIndex++;
  }

  renumber();
  await saveOrder();

  const lastNew = list.children[afterIndex];
  if (lastNew) item.focusText(lastNew);
}

export async function undo() {
  if (undoStack.length === 0) return;
  const itemData = undoStack.pop();
  await storage.updateItem(itemData.id, { deleted: false });
  await render(currentDayDate);
}

function renumber() {
  const list = document.getElementById('item-list');
  const items = Array.from(list.children);
  let topNum = 0;
  let childNum = 0;
  items.forEach((li) => {
    const num = li.querySelector('.item-number');
    if (!num) return;
    if (li.classList.contains('item--child')) {
      childNum++;
      num.textContent = `${topNum}.${childNum}`;
    } else {
      topNum++;
      childNum = 0;
      num.textContent = `${topNum}.`;
    }
  });
}

async function saveOrder() {
  const list = document.getElementById('item-list');
  const ids = Array.from(list.children).map(li => li.dataset.id);
  await storage.reorderItems(currentDayDate, ids);
}
