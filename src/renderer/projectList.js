import * as storage from './storage.js';
import * as item from './item.js';

let currentListId = null;
let itemsCache = [];
const undoStack = [];
let showDone = localStorage.getItem('showDone') !== 'false';

export async function render(listId) {
  currentListId = listId;
  const list = document.getElementById('item-list');
  list.innerHTML = '';

  const items = await storage.getItemsForList(listId);

  if (items.length === 0) {
    const newItem = await storage.addItemToList(listId, '');
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
      render(currentListId);
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
    onConvertToSpacer: handleConvertToSpacer,
    onRefresh: () => render(currentListId),
    isParent
  });
}

async function handleConvertToSpacer(id, li) {
  await storage.updateItem(id, { isSpacer: true });
  await render(currentListId);
}

async function handleToggleDone(id, li) {
  const items = await storage.getItemsForList(currentListId);
  const targetItem = items.find(i => i.id === id);
  if (!targetItem) return;

  const newDone = !targetItem.done;
  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));
  const isParent = parentIds.has(id);

  await storage.updateItem(id, { done: newDone });

  if (isParent) {
    const children = items.filter(i => i.parentId === id);
    for (const child of children) {
      await storage.updateItem(child.id, { done: newDone });
    }
  }

  await render(currentListId);
}

async function handleNewBelow(afterId) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);
  const afterIndex = domItems.findIndex(li => li.dataset.id === afterId);

  const items = await storage.getItemsForList(currentListId);
  const afterItem = items.find(i => i.id === afterId);

  const newItemData = await storage.addItemToList(currentListId, '');

  if (afterItem && afterItem.parentId) {
    await storage.updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
    newItemData.parentId = afterItem.parentId;
    newItemData.depth = 1;
  }

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

  const items = await storage.getItemsForList(currentListId);
  const deletedItem = items.find(i => i.id === id);
  const parentId = deletedItem ? deletedItem.parentId : null;

  if (deletedItem) {
    undoStack.push({ ...deletedItem });
    if (undoStack.length > 10) undoStack.shift();
  }

  await storage.deleteItem(id);
  element.remove();

  if (parentId) {
    const remainingChildren = items.filter(i => i.parentId === parentId && i.id !== id && !i.deleted);
    if (remainingChildren.length === 0) {
      await render(currentListId);
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

  const items = await storage.getItemsForList(currentListId);
  const prevItem = items.find(i => i.id === prevId);

  if (prevItem && prevItem.depth > 0) {
    const parentId = prevItem.parentId;
    if (parentId) {
      await storage.updateItem(id, { parentId: parentId, depth: 1 });
      await render(currentListId);
    }
    return;
  }

  await storage.updateItem(id, { parentId: prevId, depth: 1 });
  await render(currentListId);

  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

async function handleUnindent(id, li) {
  const items = await storage.getItemsForList(currentListId);
  const currentItem = items.find(i => i.id === id);
  if (!currentItem || !currentItem.parentId) return;

  await storage.updateItem(id, { parentId: null, depth: 0 });
  await render(currentListId);

  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

function handleFocusPrev(currentLi) {
  let prev = currentLi.previousElementSibling;
  while (prev && prev.classList.contains('item--spacer')) prev = prev.previousElementSibling;
  if (prev) item.focusText(prev);
}

function handleFocusNext(currentLi) {
  let next = currentLi.nextElementSibling;
  while (next && next.classList.contains('item--spacer')) next = next.nextElementSibling;
  if (next) item.focusText(next);
}

async function handlePasteMultiple(afterId, lines) {
  const list = document.getElementById('item-list');
  const domItems = Array.from(list.children);
  let afterIndex = domItems.findIndex(li => li.dataset.id === afterId);

  const items = await storage.getItemsForList(currentListId);
  const afterItem = items.find(i => i.id === afterId);
  const inheritParent = afterItem && afterItem.parentId;

  for (const lineText of lines) {
    const newItemData = await storage.addItemToList(currentListId, lineText);
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

export async function undo() {
  if (undoStack.length === 0) return;
  const itemData = undoStack.pop();
  await storage.updateItem(itemData.id, { deleted: false });
  await render(currentListId);
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
  const ids = Array.from(list.children).map(li => li.dataset.id).filter(Boolean);
  await storage.reorderListItems(currentListId, ids);
}
