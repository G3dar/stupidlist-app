import * as storage from './storage.js';
import * as item from './item.js';
import * as multiSelect from './multiSelect.js';
import * as undoManager from './undoManager.js';

let currentDayDate = null;
let itemsCache = []; // cached item data for the current day
let showDone = localStorage.getItem('showDone') !== 'false'; // default true
let placeholderText = null; // text typed in placeholder before data loads

// Show an instant editable item before storage is ready
export function renderInstantPlaceholder() {
  const list = document.getElementById('item-list');
  list.innerHTML = '';

  const li = document.createElement('li');
  li.className = 'item';
  li.dataset.placeholder = 'true';

  const num = document.createElement('span');
  num.className = 'item-number';
  num.textContent = '1.';
  li.appendChild(num);

  const text = document.createElement('div');
  text.className = 'item-text';
  text.contentEditable = 'true';
  text.setAttribute('data-placeholder', 'Type something...');
  text.addEventListener('input', () => {
    placeholderText = text.textContent;
  });
  li.appendChild(text);

  list.appendChild(li);
  setTimeout(() => text.focus(), 0);
}

export async function render(dayDate, opts = {}) {
  currentDayDate = dayDate;
  const list = document.getElementById('item-list');

  // Flush any unsaved text before clearing DOM — the blur handler saves immediately
  const activeText = list.querySelector('.item-text:focus');
  const focusedId = activeText ? activeText.closest('.item')?.dataset?.id : null;
  if (activeText) activeText.blur();

  if (!opts.skipLoading) {
    list.innerHTML = '<li class="list-loading"></li>';
  }

  const items = await storage.getItemsForDay(dayDate);
  list.innerHTML = '';

  // Absorb text typed in the instant placeholder
  const pendingText = placeholderText;
  placeholderText = null;

  if (items.length === 0) {
    const newItem = await storage.addItem(dayDate, pendingText || '');
    items.push(newItem);
  } else if (pendingText) {
    // User typed while loading — save it to the first empty item or create a new one
    const emptyItem = items.find(i => !i.text && !i.done);
    if (emptyItem) {
      await storage.updateItem(emptyItem.id, { text: pendingText });
      emptyItem.text = pendingText;
    } else {
      const newItem = await storage.addItem(dayDate, pendingText);
      items.push(newItem);
    }
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

  // Remove consecutive empty items (keep only the first one)
  for (let i = notDone.length - 1; i > 0; i--) {
    const cur = notDone[i];
    const prev = notDone[i - 1];
    if (!cur.isSpacer && !prev.isSpacer && !cur.text?.trim() && !prev.text?.trim()) {
      storage.deleteItem(cur.id);
      notDone.splice(i, 1);
    }
  }

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
  multiSelect.reapply();

  // Restore focus to the item the user was editing
  if (focusedId) {
    const restoredLi = list.querySelector(`[data-id="${focusedId}"]`);
    if (restoredLi) item.focusText(restoredLi);
  }
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
    onConvertToSpacer: handleConvertToSpacer,
    onRefresh: () => render(currentDayDate),
    isParent,
    listContext: { type: 'day', id: currentDayDate, onRefresh: () => render(currentDayDate) }
  });
}

async function handleConvertToSpacer(id, li) {
  const list = document.getElementById('item-list');
  const before = await storage.getItem(id);

  // Check if this is the last active item (nothing after, or next is done-toggle)
  const nextSibling = li.nextElementSibling;
  const isLastActiveItem = !nextSibling || nextSibling.classList.contains('done-toggle');

  if (isLastActiveItem) {
    const prevSibling = li.previousElementSibling;
    const prevHasContent = prevSibling
      && !prevSibling.classList.contains('item--spacer')
      && !prevSibling.classList.contains('done-toggle')
      && prevSibling.querySelector('.item-text')
      && prevSibling.querySelector('.item-text').textContent.trim() !== '';

    if (!prevHasContent) return; // prev is empty/spacer/null → no-op

    // Previous has content → convert to spacer only, no new empty item
    undoManager.startBatch('insert spacer');
    await storage.updateItem(id, { isSpacer: true });
    if (before) {
      undoManager.push({ type: 'update', entityType: 'item', id, before: { isSpacer: before.isSpacer || false }, after: { isSpacer: true } });
    }
    const spacerData = { ...before, isSpacer: true };
    const spacerLi = createItemElement(spacerData, false);
    li.replaceWith(spacerLi);
    undoManager.endBatch();
    renumber();
    saveOrder();

    // Focus previous text item
    let focusTarget = spacerLi.previousElementSibling;
    while (focusTarget && !focusTarget.querySelector('.item-text')) {
      focusTarget = focusTarget.previousElementSibling;
    }
    if (focusTarget) setTimeout(() => item.focusText(focusTarget), 0);
    return;
  }

  // Middle of list → existing behavior: spacer + new empty item
  undoManager.startBatch('insert spacer');

  await storage.updateItem(id, { isSpacer: true });
  if (before) {
    undoManager.push({ type: 'update', entityType: 'item', id, before: { isSpacer: before.isSpacer || false }, after: { isSpacer: true } });
  }

  const spacerData = { ...before, isSpacer: true };
  const spacerLi = createItemElement(spacerData, false);
  li.replaceWith(spacerLi);

  // If next element is already an empty item, just focus it instead of creating another
  const nextAfterSpacer = spacerLi.nextElementSibling;
  if (nextAfterSpacer && nextAfterSpacer.classList.contains('item') && !nextAfterSpacer.classList.contains('item--spacer')) {
    const nextText = nextAfterSpacer.querySelector('.item-text');
    if (nextText && nextText.textContent.trim() === '') {
      undoManager.endBatch();
      renumber();
      saveOrder();
      setTimeout(() => item.focusText(nextAfterSpacer), 0);
      return;
    }
  }

  const newItemData = await storage.addItem(currentDayDate, '');
  undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });
  const newLi = createItemElement(newItemData, false);
  if (spacerLi.nextSibling) {
    list.insertBefore(newLi, spacerLi.nextSibling);
  } else {
    list.appendChild(newLi);
  }

  undoManager.endBatch();
  renumber();
  saveOrder();
  setTimeout(() => item.focusText(newLi), 0);
}

async function handleToggleDone(id, li) {
  const items = await storage.getItemsForDay(currentDayDate);
  const targetItem = items.find(i => i.id === id);
  if (!targetItem) return;

  // If marking done and item has no text, delete it instead
  if (!targetItem.done && (!targetItem.text || !targetItem.text.trim())) {
    await handleDelete(id, li);
    return;
  }

  const newDone = !targetItem.done;
  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));
  const isParent = parentIds.has(id);

  undoManager.startBatch('toggle done');

  // Toggle done on this item
  undoManager.push({ type: 'update', entityType: 'item', id, before: { done: targetItem.done }, after: { done: newDone } });
  await storage.updateItem(id, { done: newDone });

  // If it's a parent, toggle all children too
  if (isParent) {
    const children = items.filter(i => i.parentId === id);
    for (const child of children) {
      undoManager.push({ type: 'update', entityType: 'item', id: child.id, before: { done: child.done }, after: { done: newDone } });
      await storage.updateItem(child.id, { done: newDone });
    }
  }

  undoManager.endBatch();

  // Animate when marking as done
  if (newDone) {
    // Collect elements to animate (parent + children if group)
    const elementsToAnimate = [li];
    if (isParent) {
      const children = items.filter(i => i.parentId === id);
      for (const child of children) {
        const childLi = document.querySelector(`[data-id="${child.id}"]`);
        if (childLi) elementsToAnimate.push(childLi);
      }
    }

    // Phase 1: Turn green + strikethrough
    for (const el of elementsToAnimate) {
      el.style.maxHeight = el.offsetHeight + 'px';
      el.classList.add('item--completing');
      const doneBtn = el.querySelector('.item-done');
      if (doneBtn) doneBtn.innerHTML = '☑';
    }

    // Phase 2: After a moment, slide out then re-render
    await new Promise(resolve => setTimeout(resolve, 700));

    for (const el of elementsToAnimate) {
      el.classList.add('item--slide-out');
    }

    await new Promise(resolve => setTimeout(resolve, 350));

    await render(currentDayDate);
  } else {
    // Un-marking done: just re-render immediately
    await render(currentDayDate);
  }
}

async function handleNewBelow(afterId) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);
  const afterIndex = domItems.findIndex(li => li.dataset.id === afterId);

  // If next sibling is already an empty item, just focus it
  const nextLi = afterIndex >= 0 ? domItems[afterIndex + 1] : null;
  if (nextLi && nextLi.classList.contains('item') && !nextLi.classList.contains('item--spacer')) {
    const nextText = nextLi.querySelector('.item-text');
    if (nextText && nextText.textContent.trim() === '') {
      setTimeout(() => item.focusText(nextLi), 0);
      return;
    }
  }

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

  undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });

  const isParent = false;
  const li = createItemElement(newItemData, isParent);

  if (afterIndex >= 0 && afterIndex < domItems.length - 1) {
    list.insertBefore(li, domItems[afterIndex + 1]);
  } else {
    list.appendChild(li);
  }

  renumber();
  saveOrder();
  setTimeout(() => item.focusText(li), 0);
}

async function handleDelete(id, element) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);

  if (domItems.length <= 1) return;

  const scrollY = window.scrollY;
  const index = domItems.indexOf(element);

  // Check if this item was a child — if parent has no more children after this, re-render parent
  const items = await storage.getItemsForDay(currentDayDate);
  const deletedItem = items.find(i => i.id === id);
  const parentId = deletedItem ? deletedItem.parentId : null;

  // Push to undo manager before deleting
  if (deletedItem) {
    undoManager.push({ type: 'delete', entityType: 'item', id, data: { ...deletedItem } });
  }

  await storage.deleteItem(id);
  element.remove();

  // Check if parent should revert to normal item
  if (parentId) {
    const remainingChildren = items.filter(i => i.parentId === parentId && i.id !== id && !i.deleted);
    if (remainingChildren.length === 0) {
      // Re-render to update parent display
      await render(currentDayDate);
      window.scrollTo(0, scrollY);
      return;
    }
  }

  renumber();
  await saveOrder();

  const remaining = Array.from(list.children);
  if (remaining.length > 0) {
    const focusIndex = Math.max(0, index - 1);
    item.focusText(remaining[focusIndex], false, true);
  }
  window.scrollTo(0, scrollY);
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

  // Get current item for undo snapshot
  const currentItem = items.find(i => i.id === id);
  const oldParentId = currentItem ? currentItem.parentId : null;
  const oldDepth = currentItem ? currentItem.depth : 0;

  // Don't indent under a child (only 1 level deep)
  if (prevItem && prevItem.depth > 0) {
    // Find the parent of the prev item instead
    const parentId = prevItem.parentId;
    if (parentId) {
      undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: oldParentId, depth: oldDepth }, after: { parentId: parentId, depth: 1 } });
      await storage.updateItem(id, { parentId: parentId, depth: 1 });
      await render(currentDayDate);
    }
    return;
  }

  // Make this item a child of the previous item
  undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: oldParentId, depth: oldDepth }, after: { parentId: prevId, depth: 1 } });
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
  undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: oldParentId, depth: currentItem.depth }, after: { parentId: null, depth: 0 } });
  await storage.updateItem(id, { parentId: null, depth: 0 });

  // Re-render
  await render(currentDayDate);

  // Re-focus
  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

function handleFocusPrev(currentLi) {
  let prev = currentLi.previousElementSibling;
  while (prev && !prev.querySelector('.item-text')) prev = prev.previousElementSibling;
  if (prev) item.focusText(prev);
}

function handleFocusNext(currentLi) {
  let next = currentLi.nextElementSibling;
  while (next && !next.querySelector('.item-text')) next = next.nextElementSibling;
  if (next) item.focusText(next, true);
}

async function handlePasteMultiple(afterId, lines) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);
  let afterIndex = domItems.findIndex(li => li.dataset.id === afterId);

  // Check if current item is a child
  const items = await storage.getItemsForDay(currentDayDate);
  const afterItem = items.find(i => i.id === afterId);
  const inheritParent = afterItem && afterItem.parentId;

  undoManager.startBatch('paste multiple');
  for (const lineText of lines) {
    const newItemData = await storage.addItem(currentDayDate, lineText);
    if (inheritParent) {
      await storage.updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
      newItemData.parentId = afterItem.parentId;
      newItemData.depth = 1;
    }
    undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });
    const li = createItemElement(newItemData, false);
    const currentItems = Array.from(list.children);

    if (afterIndex >= 0 && afterIndex < currentItems.length - 1) {
      list.insertBefore(li, currentItems[afterIndex + 1]);
    } else {
      list.appendChild(li);
    }
    afterIndex++;
  }
  undoManager.endBatch();

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

  // Snapshot order before reorder
  const beforeIds = Array.from(list.children).map(li => li.dataset.id);

  list.insertBefore(draggedEl, targetEl);

  const afterIds = Array.from(list.children).map(li => li.dataset.id);
  undoManager.push({ type: 'reorder', context: { dayDate: currentDayDate }, beforeIds, afterIds });

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

  undoManager.startBatch('paste as items');
  for (const lineText of lines) {
    const newItemData = await storage.addItem(currentDayDate, lineText);
    undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });
    const li = createItemElement(newItemData, false);
    const currentItems = Array.from(list.children);

    if (afterIndex >= 0 && afterIndex < currentItems.length - 1) {
      list.insertBefore(li, currentItems[afterIndex + 1]);
    } else {
      list.appendChild(li);
    }
    afterIndex++;
  }
  undoManager.endBatch();

  renumber();
  await saveOrder();

  const lastNew = list.children[afterIndex];
  if (lastNew) item.focusText(lastNew);
}

function renumber() {
  const list = document.getElementById('item-list');
  const items = Array.from(list.children);
  let topNum = 0;
  let childNum = 0;
  items.forEach((li) => {
    const num = li.querySelector('.item-number');
    if (!num) return;
    if (li.classList.contains('item--restart') && !li.classList.contains('item--child')) {
      topNum = 0;
      childNum = 0;
    }
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
