import * as storage from './storage.js';
import * as item from './item.js';
import * as multiSelect from './multiSelect.js';
import * as undoManager from './undoManager.js';

let currentListId = null;
let itemsCache = [];
let showDone = localStorage.getItem('showDone') !== 'false';
let sharedCtx = null; // null or { ownerUid }

function stg() {
  if (!sharedCtx) return storage;
  const uid = sharedCtx.ownerUid;
  return {
    getItemsForList: (lid) => storage.getSharedListItems(uid, lid),
    addItemToList: (lid, t) => storage.sharedAddItemToList(uid, lid, t),
    updateItem: (id, c) => storage.sharedUpdateItem(uid, id, c),
    deleteItem: (id) => storage.sharedDeleteItem(uid, id),
    reorderListItems: (lid, ids) => storage.sharedReorderListItems(uid, lid, ids),
    getItem: () => Promise.resolve(null),
  };
}

export async function render(listId, sharedContext = null, opts = {}) {
  sharedCtx = sharedContext;
  currentListId = listId;
  const list = document.getElementById('item-list');

  // Flush any unsaved text before clearing DOM — the blur handler saves immediately
  const activeText = list.querySelector('.item-text:focus');
  const focusedId = activeText ? activeText.closest('.item')?.dataset?.id : null;
  if (activeText) activeText.blur();

  if (!opts.skipLoading) {
    list.innerHTML = '<li class="list-loading"></li>';
  }

  const items = await stg().getItemsForList(listId);
  list.innerHTML = '';

  if (items.length === 0) {
    const newItem = await stg().addItemToList(listId, '');
    items.push(newItem);
  }

  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));

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

  const notDone = sorted.filter(i => !i.done && !i._groupDone);
  const done = sorted.filter(i => i.done || i._groupDone);

  itemsCache = [...notDone, ...done];

  notDone.forEach((itemData) => {
    const isParent = itemData._isParent || parentIds.has(itemData.id);
    const li = createItemElement(itemData, isParent);
    list.appendChild(li);
  });

  if (done.length > 0) {
    const doneToggle = document.createElement('li');
    doneToggle.className = 'done-toggle';
    const btn = document.createElement('button');
    btn.className = 'done-toggle-btn';
    btn.addEventListener('click', () => {
      showDone = !showDone;
      localStorage.setItem('showDone', showDone);
      render(currentListId, sharedCtx);
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
    onRefresh: () => render(currentListId, sharedCtx),
    isParent,
    listContext: { type: 'list', id: currentListId, onRefresh: () => render(currentListId, sharedCtx), isSharedView: !!sharedCtx }
  });
}

async function handleConvertToSpacer(id, li) {
  const list = document.getElementById('item-list');
  const before = sharedCtx ? null : await storage.getItem(id);

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
    if (!sharedCtx) undoManager.startBatch('insert spacer');
    await stg().updateItem(id, { isSpacer: true });
    if (before) {
      undoManager.push({ type: 'update', entityType: 'item', id, before: { isSpacer: before.isSpacer || false }, after: { isSpacer: true } });
    }
    const spacerData = before ? { ...before, isSpacer: true } : { id, isSpacer: true };
    const spacerLi = createItemElement(spacerData, false);
    li.replaceWith(spacerLi);
    if (!sharedCtx) undoManager.endBatch();
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
  if (!sharedCtx) undoManager.startBatch('insert spacer');

  await stg().updateItem(id, { isSpacer: true });
  if (before) {
    undoManager.push({ type: 'update', entityType: 'item', id, before: { isSpacer: before.isSpacer || false }, after: { isSpacer: true } });
  }

  const spacerData = before ? { ...before, isSpacer: true } : { id, isSpacer: true };
  const spacerLi = createItemElement(spacerData, false);
  li.replaceWith(spacerLi);

  // If next element is already an empty item, just focus it instead of creating another
  const nextAfterSpacer = spacerLi.nextElementSibling;
  if (nextAfterSpacer && nextAfterSpacer.classList.contains('item') && !nextAfterSpacer.classList.contains('item--spacer')) {
    const nextText = nextAfterSpacer.querySelector('.item-text');
    if (nextText && nextText.textContent.trim() === '') {
      if (!sharedCtx) undoManager.endBatch();
      renumber();
      saveOrder();
      setTimeout(() => item.focusText(nextAfterSpacer), 0);
      return;
    }
  }

  const newItemData = await stg().addItemToList(currentListId, '');
  if (!sharedCtx) undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });
  const newLi = createItemElement(newItemData, false);
  if (spacerLi.nextSibling) {
    list.insertBefore(newLi, spacerLi.nextSibling);
  } else {
    list.appendChild(newLi);
  }

  if (!sharedCtx) undoManager.endBatch();
  renumber();
  saveOrder();
  setTimeout(() => item.focusText(newLi), 0);
}

async function handleToggleDone(id, li) {
  const items = await stg().getItemsForList(currentListId);
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

  if (!sharedCtx) undoManager.startBatch('toggle done');
  if (!sharedCtx) undoManager.push({ type: 'update', entityType: 'item', id, before: { done: targetItem.done }, after: { done: newDone } });
  await stg().updateItem(id, { done: newDone });

  if (isParent) {
    const children = items.filter(i => i.parentId === id);
    for (const child of children) {
      if (!sharedCtx) undoManager.push({ type: 'update', entityType: 'item', id: child.id, before: { done: child.done }, after: { done: newDone } });
      await stg().updateItem(child.id, { done: newDone });
    }
  }
  if (!sharedCtx) undoManager.endBatch();

  // Animate when marking as done
  if (newDone) {
    const elementsToAnimate = [li];
    if (isParent) {
      const children = items.filter(i => i.parentId === id);
      for (const child of children) {
        const childLi = document.querySelector(`[data-id="${child.id}"]`);
        if (childLi) elementsToAnimate.push(childLi);
      }
    }

    for (const el of elementsToAnimate) {
      el.style.maxHeight = el.offsetHeight + 'px';
      el.classList.add('item--completing');
      const doneBtn = el.querySelector('.item-done');
      if (doneBtn) doneBtn.innerHTML = '☑';
    }

    await new Promise(resolve => setTimeout(resolve, 700));

    for (const el of elementsToAnimate) {
      el.classList.add('item--slide-out');
    }

    await new Promise(resolve => setTimeout(resolve, 350));

    await render(currentListId, sharedCtx);
  } else {
    await render(currentListId, sharedCtx);
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

  const items = await stg().getItemsForList(currentListId);
  const afterItem = items.find(i => i.id === afterId);

  const newItemData = await stg().addItemToList(currentListId, '');

  if (afterItem && afterItem.parentId) {
    await stg().updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
    newItemData.parentId = afterItem.parentId;
    newItemData.depth = 1;
  }

  if (!sharedCtx) undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });

  const li = createItemElement(newItemData, false);

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

  const index = domItems.indexOf(element);

  const items = await stg().getItemsForList(currentListId);
  const deletedItem = items.find(i => i.id === id);
  const parentId = deletedItem ? deletedItem.parentId : null;

  // Tagged items: untag instead of deleting
  if (deletedItem && deletedItem._isTagged && !sharedCtx) {
    undoManager.push({ type: 'update', entityType: 'item', id, before: { tagListId: deletedItem.tagListId, tagOrder: deletedItem.tagOrder, projectId: deletedItem.projectId, projectTag: deletedItem.projectTag }, after: { tagListId: null, tagOrder: null, projectId: null, projectTag: null } });
    await storage.untagItem(id);
    element.remove();
    renumber();
    await saveOrder();
    const remaining = Array.from(list.children);
    if (remaining.length > 0) {
      const focusIndex = Math.max(0, index - 1);
      item.focusText(remaining[focusIndex]);
    }
    return;
  }

  if (deletedItem && !sharedCtx) {
    undoManager.push({ type: 'delete', entityType: 'item', id, data: { ...deletedItem } });
  }

  await stg().deleteItem(id);
  element.remove();

  if (parentId) {
    const remainingChildren = items.filter(i => i.parentId === parentId && i.id !== id && !i.deleted);
    if (remainingChildren.length === 0) {
      await render(currentListId, sharedCtx);
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

  if (index <= 0) return;

  const prevLi = domItems[index - 1];
  const prevId = prevLi.dataset.id;

  const items = await stg().getItemsForList(currentListId);
  const prevItem = items.find(i => i.id === prevId);
  const currentItem = items.find(i => i.id === id);
  const oldParentId = currentItem ? currentItem.parentId : null;
  const oldDepth = currentItem ? currentItem.depth : 0;

  if (prevItem && prevItem.depth > 0) {
    const parentId = prevItem.parentId;
    if (parentId) {
      if (!sharedCtx) undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: oldParentId, depth: oldDepth }, after: { parentId: parentId, depth: 1 } });
      await stg().updateItem(id, { parentId: parentId, depth: 1 });
      await render(currentListId, sharedCtx);
    }
    return;
  }

  if (!sharedCtx) undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: oldParentId, depth: oldDepth }, after: { parentId: prevId, depth: 1 } });
  await stg().updateItem(id, { parentId: prevId, depth: 1 });
  await render(currentListId, sharedCtx);

  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

async function handleUnindent(id, li) {
  const items = await stg().getItemsForList(currentListId);
  const currentItem = items.find(i => i.id === id);
  if (!currentItem || !currentItem.parentId) return;

  if (!sharedCtx) undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: currentItem.parentId, depth: currentItem.depth }, after: { parentId: null, depth: 0 } });
  await stg().updateItem(id, { parentId: null, depth: 0 });
  await render(currentListId, sharedCtx);

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

  const items = await stg().getItemsForList(currentListId);
  const afterItem = items.find(i => i.id === afterId);
  const inheritParent = afterItem && afterItem.parentId;

  if (!sharedCtx) undoManager.startBatch('paste multiple');
  for (const lineText of lines) {
    const newItemData = await stg().addItemToList(currentListId, lineText);
    if (inheritParent) {
      await stg().updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
      newItemData.parentId = afterItem.parentId;
      newItemData.depth = 1;
    }
    if (!sharedCtx) undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });
    const li = createItemElement(newItemData, false);
    const currentItems = Array.from(list.children);

    if (afterIndex >= 0 && afterIndex < currentItems.length - 1) {
      list.insertBefore(li, currentItems[afterIndex + 1]);
    } else {
      list.appendChild(li);
    }
    afterIndex++;
  }
  if (!sharedCtx) undoManager.endBatch();

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

  const beforeIds = Array.from(list.children).map(li => li.dataset.id);
  list.insertBefore(draggedEl, targetEl);
  const afterIds = Array.from(list.children).map(li => li.dataset.id);
  if (!sharedCtx) undoManager.push({ type: 'reorder', context: { listId: currentListId }, beforeIds, afterIds });

  renumber();
  await saveOrder();
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
  const ids = Array.from(list.children).map(li => li.dataset.id).filter(Boolean);
  await stg().reorderListItems(currentListId, ids);
}
