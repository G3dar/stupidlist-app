import * as storage from './storage.js';
import * as item from './item.js';
import * as undoManager from './undoManager.js';

let currentViewId = null;
let showDone = localStorage.getItem('showDone') !== 'false';

// Map itemId → listId, rebuilt on every render so handlers can route ops correctly.
const itemListMap = new Map();

export async function render(viewId, opts = {}) {
  currentViewId = viewId;
  const listEl = document.getElementById('item-list');

  const activeText = listEl.querySelector('.item-text:focus');
  const focusedId = activeText ? activeText.closest('.item')?.dataset?.id : null;
  if (activeText) activeText.blur();

  if (!opts.skipLoading) {
    listEl.innerHTML = '<li class="list-loading"></li>';
  }

  const view = await storage.getCustomView(viewId);
  if (!view) {
    listEl.innerHTML = '<li class="cv-empty">Custom view not found</li>';
    return;
  }

  const sections = await resolveSelections(view.selections || []);
  itemListMap.clear();

  listEl.innerHTML = '';

  if (sections.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'cv-empty';
    empty.textContent = 'This view has no lists or projects selected.';
    listEl.appendChild(empty);
    return;
  }

  // First pass: render headers + not-done items per section.
  // Second pass: collect all done items across sections and render them at the very end.
  const doneBuckets = [];

  for (const section of sections) {
    renderSectionNotDone(listEl, section, doneBuckets);
  }

  const totalDone = doneBuckets.reduce((n, b) => n + b.items.length, 0);
  if (totalDone > 0) {
    const toggle = document.createElement('li');
    toggle.className = 'done-toggle cv-done-toggle';
    const btn = document.createElement('button');
    btn.className = 'done-toggle-btn';
    btn.addEventListener('click', () => {
      showDone = !showDone;
      localStorage.setItem('showDone', showDone);
      render(currentViewId);
    });
    const eye = document.createElement('span');
    eye.className = 'done-toggle-eye';
    eye.textContent = showDone ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}';
    const label = document.createElement('span');
    label.textContent = `${totalDone} finished`;
    btn.appendChild(eye);
    btn.appendChild(label);
    toggle.appendChild(btn);
    listEl.appendChild(toggle);

    if (showDone) {
      for (const bucket of doneBuckets) {
        if (bucket.items.length === 0) continue;
        const subHeader = document.createElement('li');
        subHeader.className = 'cv-list-header';
        if (bucket.project) {
          subHeader.textContent = `${bucket.project.name || 'Untitled'} \u00B7 ${bucket.list.name || 'Untitled list'}`;
        } else {
          subHeader.textContent = bucket.list.name || 'Untitled list';
        }
        listEl.appendChild(subHeader);
        for (const itemData of bucket.items) {
          const li = createInteractiveItem(itemData, itemData._isParent, bucket.list);
          listEl.appendChild(li);
        }
      }
    }
  }

  if (focusedId) {
    const restoredLi = listEl.querySelector(`[data-id="${focusedId}"]`);
    if (restoredLi) item.focusText(restoredLi);
  }
}

async function resolveSelections(selections) {
  const sections = [];
  const seenListIds = new Set();

  for (const sel of selections) {
    if (sel.kind === 'project' && sel.projectId) {
      const project = await storage.getProject(sel.projectId);
      if (!project) continue;
      const lists = await storage.getListsForProject(sel.projectId);
      const projectLists = [];
      for (const l of lists) {
        if (seenListIds.has(l.id)) continue;
        seenListIds.add(l.id);
        const items = await storage.getItemsForList(l.id);
        projectLists.push({ list: l, items });
      }
      sections.push({ kind: 'project', project, lists: projectLists });
    } else if (sel.kind === 'list' && sel.listId) {
      if (seenListIds.has(sel.listId)) continue;
      seenListIds.add(sel.listId);
      const list = await storage.getList(sel.listId);
      if (!list) continue;
      const items = await storage.getItemsForList(sel.listId);
      let project = null;
      if (list.projectId) project = await storage.getProject(list.projectId);
      sections.push({ kind: 'list', project, list, items });
    }
  }

  return sections;
}

function renderSectionNotDone(listEl, section, doneBuckets) {
  if (section.kind === 'project') {
    const header = document.createElement('li');
    header.className = 'cv-project-header';
    header.textContent = section.project.name || 'Untitled project';
    listEl.appendChild(header);

    for (const entry of section.lists) {
      const subHeader = document.createElement('li');
      subHeader.className = 'cv-list-header cv-list-header--nested';
      subHeader.textContent = entry.list.name || 'Untitled list';
      listEl.appendChild(subHeader);
      renderListNotDone(listEl, entry.list, entry.items, doneBuckets, section.project);
    }
  } else if (section.kind === 'list') {
    const header = document.createElement('li');
    header.className = section.project ? 'cv-project-header' : 'cv-list-header';
    if (section.project) {
      header.textContent = `${section.project.name || 'Untitled'} \u00B7 ${section.list.name || 'Untitled list'}`;
    } else {
      header.textContent = section.list.name || 'Untitled list';
    }
    listEl.appendChild(header);
    renderListNotDone(listEl, section.list, section.items, doneBuckets, section.project);
  }
}

function renderListNotDone(listEl, list, items, doneBuckets, project) {
  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));

  const topLevel = items.filter(i => !i.parentId);
  const sorted = [];
  for (const parent of topLevel) {
    const children = items.filter(i => i.parentId === parent.id).sort((a, b) => a.order - b.order);
    const groupDone = parent.done;
    sorted.push({ ...parent, _isParent: parentIds.has(parent.id), _groupDone: groupDone });
    for (const child of children) sorted.push(child);
  }

  const notDone = sorted.filter(i => !i.done && !i._groupDone);
  const done = sorted.filter(i => i.done || i._groupDone);

  notDone.forEach((itemData) => {
    const isParent = itemData._isParent || parentIds.has(itemData.id);
    const li = createInteractiveItem(itemData, isParent, list);
    listEl.appendChild(li);
  });

  if (done.length > 0) {
    doneBuckets.push({ list, project: project || null, items: done });
  }

  // Empty state: create a placeholder empty item inline for typing
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'cv-list-empty';
    empty.textContent = '(empty)';
    empty.addEventListener('click', async () => {
      const newItem = await storage.addItemToList(list.id, '');
      undoManager.push({ type: 'create', entityType: 'item', id: newItem.id, data: { ...newItem } });
      await render(currentViewId);
      const newLi = document.querySelector(`[data-id="${newItem.id}"]`);
      if (newLi) item.focusText(newLi);
    });
    listEl.appendChild(empty);
  }
}

function createInteractiveItem(itemData, isParent, list) {
  itemListMap.set(itemData.id, list.id);

  const li = item.create(itemData, {
    onDelete: (id, el) => handleDelete(id, el, list.id),
    onNewBelow: (afterId) => handleNewBelow(afterId, list.id),
    onFocusPrev: handleFocusPrev,
    onFocusNext: handleFocusNext,
    onReorder: (draggedId, targetId) => handleReorder(draggedId, targetId),
    onPasteMultiple: (afterId, lines) => handlePasteMultiple(afterId, lines, list.id),
    onIndent: (id, el) => handleIndent(id, el, list.id),
    onUnindent: (id, el) => handleUnindent(id, el, list.id),
    onToggleDone: (id, el) => handleToggleDone(id, el, list.id),
    onConvertToSpacer: (id, el) => handleConvertToSpacer(id, el, list.id),
    onRefresh: () => render(currentViewId),
    isParent,
    listContext: { type: 'list', id: list.id, onRefresh: () => render(currentViewId), isSharedView: false }
  });
  li.dataset.listId = list.id;
  return li;
}

async function handleDelete(id, element, listId) {
  const items = await storage.getItemsForList(listId);
  const deletedItem = items.find(i => i.id === id);
  if (deletedItem && deletedItem._isTagged) {
    undoManager.push({
      type: 'update', entityType: 'item', id,
      before: { tagListId: deletedItem.tagListId, tagOrder: deletedItem.tagOrder, projectId: deletedItem.projectId, projectTag: deletedItem.projectTag },
      after: { tagListId: null, tagOrder: null, projectId: null, projectTag: null }
    });
    await storage.untagItem(id);
  } else if (deletedItem) {
    undoManager.push({ type: 'delete', entityType: 'item', id, data: { ...deletedItem } });
    await storage.deleteItem(id);
  } else {
    await storage.deleteItem(id);
  }
  await render(currentViewId);
}

async function handleNewBelow(afterId, listId) {
  const items = await storage.getItemsForList(listId);
  const afterItem = items.find(i => i.id === afterId);

  const newItemData = await storage.addItemToList(listId, '');

  if (afterItem && afterItem.parentId) {
    await storage.updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
    newItemData.parentId = afterItem.parentId;
    newItemData.depth = 1;
  }

  undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });

  await render(currentViewId);
  setTimeout(() => {
    const newLi = document.querySelector(`[data-id="${newItemData.id}"]`);
    if (newLi) item.focusText(newLi);
  }, 0);
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

async function handleReorder(draggedId, targetId) {
  const draggedListId = itemListMap.get(draggedId);
  const targetListId = itemListMap.get(targetId);
  if (!draggedListId || draggedListId !== targetListId) {
    // Cross-list reorder not supported in v1 — re-render to cancel any drop animation.
    await render(currentViewId);
    return;
  }

  const items = await storage.getItemsForList(draggedListId);
  const orderedIds = items.map(i => i.id);
  const fromIdx = orderedIds.indexOf(draggedId);
  const toIdx = orderedIds.indexOf(targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  orderedIds.splice(fromIdx, 1);
  orderedIds.splice(toIdx, 0, draggedId);

  const beforeIds = items.map(i => i.id);
  undoManager.push({ type: 'reorder', context: { listId: draggedListId }, beforeIds, afterIds: orderedIds });
  await storage.reorderListItems(draggedListId, orderedIds);
  await render(currentViewId);
}

async function handlePasteMultiple(afterId, lines, listId) {
  const items = await storage.getItemsForList(listId);
  const afterItem = items.find(i => i.id === afterId);
  const inheritParent = afterItem && afterItem.parentId;

  undoManager.startBatch('paste multiple');
  let lastId = null;
  for (const lineText of lines) {
    const newItemData = await storage.addItemToList(listId, lineText);
    if (inheritParent) {
      await storage.updateItem(newItemData.id, { parentId: afterItem.parentId, depth: 1 });
    }
    undoManager.push({ type: 'create', entityType: 'item', id: newItemData.id, data: { ...newItemData } });
    lastId = newItemData.id;
  }
  undoManager.endBatch();

  await render(currentViewId);
  if (lastId) {
    const newLi = document.querySelector(`[data-id="${lastId}"]`);
    if (newLi) item.focusText(newLi);
  }
}

async function handleIndent(id, li, listId) {
  const prevLi = li.previousElementSibling;
  if (!prevLi || !prevLi.classList.contains('item')) return;
  if (prevLi.dataset.listId !== listId) return;

  const prevId = prevLi.dataset.id;
  const items = await storage.getItemsForList(listId);
  const prevItem = items.find(i => i.id === prevId);
  const currentItem = items.find(i => i.id === id);
  if (!currentItem) return;

  const oldParentId = currentItem.parentId;
  const oldDepth = currentItem.depth;

  let newParentId;
  if (prevItem && prevItem.depth > 0 && prevItem.parentId) {
    newParentId = prevItem.parentId;
  } else {
    newParentId = prevId;
  }

  undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: oldParentId, depth: oldDepth }, after: { parentId: newParentId, depth: 1 } });
  await storage.updateItem(id, { parentId: newParentId, depth: 1 });
  await render(currentViewId);

  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

async function handleUnindent(id, li, listId) {
  const items = await storage.getItemsForList(listId);
  const currentItem = items.find(i => i.id === id);
  if (!currentItem || !currentItem.parentId) return;

  undoManager.push({ type: 'update', entityType: 'item', id, before: { parentId: currentItem.parentId, depth: currentItem.depth }, after: { parentId: null, depth: 0 } });
  await storage.updateItem(id, { parentId: null, depth: 0 });
  await render(currentViewId);

  const newLi = document.querySelector(`[data-id="${id}"]`);
  if (newLi) item.focusText(newLi);
}

async function handleToggleDone(id, element, listId) {
  const items = await storage.getItemsForList(listId);
  const targetItem = items.find(i => i.id === id);
  if (!targetItem) return;

  if (!targetItem.done && (!targetItem.text || !targetItem.text.trim())) {
    await handleDelete(id, element, listId);
    return;
  }

  const newDone = !targetItem.done;
  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));
  const isParent = parentIds.has(id);

  undoManager.startBatch('toggle done');
  undoManager.push({ type: 'update', entityType: 'item', id, before: { done: targetItem.done }, after: { done: newDone } });
  await storage.updateItem(id, { done: newDone });

  if (isParent) {
    const children = items.filter(i => i.parentId === id);
    for (const child of children) {
      undoManager.push({ type: 'update', entityType: 'item', id: child.id, before: { done: child.done }, after: { done: newDone } });
      await storage.updateItem(child.id, { done: newDone });
    }
  }
  undoManager.endBatch();

  await render(currentViewId);
}

async function handleConvertToSpacer(id, li, listId) {
  const before = await storage.getItem(id);
  undoManager.startBatch('insert spacer');
  await storage.updateItem(id, { isSpacer: true });
  if (before) {
    undoManager.push({ type: 'update', entityType: 'item', id, before: { isSpacer: before.isSpacer || false }, after: { isSpacer: true } });
  }
  undoManager.endBatch();
  await render(currentViewId);
}
