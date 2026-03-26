import { DB_NAME, ITEMS_STORE, PROJECTS_STORE, LISTS_STORE, generateId, migrateState } from '../shared/constants.js';

const DB_VER = 3;
let db = null;

export function open() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }

    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      const tx = e.target.transaction;

      if (!database.objectStoreNames.contains(ITEMS_STORE)) {
        const store = database.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
        store.createIndex('byDay', 'dayDate', { unique: false });
        store.createIndex('byDayOrder', ['dayDate', 'order'], { unique: false });
        store.createIndex('byList', 'listId', { unique: false });
      } else {
        const store = tx.objectStore(ITEMS_STORE);
        if (store.indexNames.contains('byState')) {
          store.deleteIndex('byState');
        }
        if (!store.indexNames.contains('byDayOrder')) {
          store.createIndex('byDayOrder', ['dayDate', 'order'], { unique: false });
        }
        if (!store.indexNames.contains('byList')) {
          store.createIndex('byList', 'listId', { unique: false });
        }
      }

      // Projects store
      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        database.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }

      // Lists store
      if (!database.objectStoreNames.contains(LISTS_STORE)) {
        const listsStore = database.createObjectStore(LISTS_STORE, { keyPath: 'id' });
        listsStore.createIndex('byProject', 'projectId', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    req.onerror = (e) => reject(e.target.error);
  });
}

// Normalize item: migrate old state field to done+status on read
function normalize(item) {
  if (item.state !== undefined && item.done === undefined) {
    const { done, status } = migrateState(item.state);
    item.done = done;
    item.status = status;
    delete item.state;
  }
  if (item.done === undefined) item.done = false;
  if (!item.status) item.status = 'not_started';
  if (item.status === 'wip') item.status = 'in_progress';
  if (item.status === 'wait' || item.status === 'later') item.status = 'waiting';
  if (item.parentId === undefined) item.parentId = null;
  if (item.depth === undefined) item.depth = 0;
  return item;
}

function getStore(storeName = ITEMS_STORE, mode = 'readonly') {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Day Items ───

export async function getItemsForDay(dayDate) {
  await open();
  const store = getStore();
  const index = store.index('byDay');
  const items = await promisify(index.getAll(dayDate));
  return items
    .filter(i => !i.deleted)
    .map(normalize)
    .sort((a, b) => a.order - b.order);
}

export async function addItem(dayDate, text = '') {
  await open();
  const existing = await getItemsForDay(dayDate);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(i => i.order)) + 1 : 0;

  const item = {
    id: generateId(),
    dayDate,
    listId: null,
    order: maxOrder,
    text,
    done: false,
    status: 'not_started',
    parentId: null,
    depth: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    movedFrom: null,
    deleted: false
  };

  const store = getStore(ITEMS_STORE, 'readwrite');
  await promisify(store.put(item));
  return item;
}

export async function getChildrenOf(parentId, dayDate) {
  const items = await getItemsForDay(dayDate);
  return items.filter(i => i.parentId === parentId);
}

export async function updateItem(id, changes) {
  await open();
  const store = getStore(ITEMS_STORE, 'readwrite');
  const item = await promisify(store.get(id));
  if (!item) return null;

  Object.assign(item, changes, { updatedAt: Date.now() });
  await promisify(store.put(item));
  return item;
}

export async function deleteItem(id) {
  await open();
  const store = getStore(ITEMS_STORE, 'readwrite');
  const item = await promisify(store.get(id));
  if (!item) return;

  item.deleted = true;
  item.updatedAt = Date.now();
  await promisify(store.put(item));
}

export async function getIncompleteItems(beforeDate) {
  await open();
  const store = getStore();
  const all = await promisify(store.getAll());

  return all
    .map(normalize)
    .filter(i => !i.deleted && !i.done && i.dayDate && i.dayDate < beforeDate && i.text.trim() !== '')
    .sort((a, b) => {
      if (a.dayDate !== b.dayDate) return b.dayDate.localeCompare(a.dayDate);
      return a.order - b.order;
    });
}

export async function moveItemToDay(itemId, newDayDate) {
  await open();
  const store = getStore(ITEMS_STORE, 'readwrite');
  const original = await promisify(store.get(itemId));
  if (!original) return null;

  original.done = true;
  original.updatedAt = Date.now();
  await promisify(store.put(original));

  return addItem(newDayDate, original.text);
}

export async function reorderItems(dayDate, orderedIds) {
  await open();
  const tx = db.transaction(ITEMS_STORE, 'readwrite');
  const store = tx.objectStore(ITEMS_STORE);
  const now = Date.now();

  for (let i = 0; i < orderedIds.length; i++) {
    const item = await promisify(store.get(orderedIds[i]));
    if (item) {
      item.order = i;
      item.updatedAt = now;
      store.put(item);
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Projects ───

export async function getAllProjects() {
  await open();
  const store = getStore(PROJECTS_STORE);
  const all = await promisify(store.getAll());
  return all.filter(p => !p.deleted).sort((a, b) => a.order - b.order);
}

export async function addProject(name) {
  await open();
  const existing = await getAllProjects();
  const project = {
    id: generateId(),
    name,
    order: existing.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };

  const store = getStore(PROJECTS_STORE, 'readwrite');
  await promisify(store.put(project));

  // Create a default list
  await addList(project.id, 'List 1');

  return project;
}

export async function updateProject(id, changes) {
  await open();
  const store = getStore(PROJECTS_STORE, 'readwrite');
  const project = await promisify(store.get(id));
  if (!project) return null;

  Object.assign(project, changes, { updatedAt: Date.now() });
  await promisify(store.put(project));
  return project;
}

export async function deleteProject(id) {
  await open();
  // Soft-delete the project
  const store = getStore(PROJECTS_STORE, 'readwrite');
  const project = await promisify(store.get(id));
  if (!project) return;
  project.deleted = true;
  project.updatedAt = Date.now();
  await promisify(store.put(project));

  // Soft-delete all its lists and their items
  const lists = await getListsForProject(id);
  for (const list of lists) {
    await deleteList(list.id);
  }
}

// ─── Lists ───

export async function getListsForProject(projectId) {
  await open();
  const store = getStore(LISTS_STORE);
  const index = store.index('byProject');
  const all = await promisify(index.getAll(projectId));
  return all.filter(l => !l.deleted).sort((a, b) => a.order - b.order);
}

export async function addList(projectId, name) {
  await open();
  const existing = await getListsForProject(projectId);
  const list = {
    id: generateId(),
    projectId,
    name,
    order: existing.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };

  const store = getStore(LISTS_STORE, 'readwrite');
  await promisify(store.put(list));
  return list;
}

export async function updateList(id, changes) {
  await open();
  const store = getStore(LISTS_STORE, 'readwrite');
  const list = await promisify(store.get(id));
  if (!list) return null;

  Object.assign(list, changes, { updatedAt: Date.now() });
  await promisify(store.put(list));
  return list;
}

export async function deleteList(id) {
  await open();
  const store = getStore(LISTS_STORE, 'readwrite');
  const list = await promisify(store.get(id));
  if (!list) return;
  list.deleted = true;
  list.updatedAt = Date.now();
  await promisify(store.put(list));

  // Soft-delete all items in this list
  const items = await getItemsForList(id);
  for (const item of items) {
    await deleteItem(item.id);
  }
}

// ─── List Items (project items) ───

export async function getItemsForList(listId) {
  await open();
  const store = getStore();
  const index = store.index('byList');
  const items = await promisify(index.getAll(listId));
  return items
    .filter(i => !i.deleted)
    .map(normalize)
    .sort((a, b) => a.order - b.order);
}

export async function addItemToList(listId, text = '') {
  await open();
  const existing = await getItemsForList(listId);
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(i => i.order)) + 1 : 0;

  const item = {
    id: generateId(),
    dayDate: null,
    listId,
    order: maxOrder,
    text,
    done: false,
    status: 'not_started',
    parentId: null,
    depth: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };

  const store = getStore(ITEMS_STORE, 'readwrite');
  await promisify(store.put(item));
  return item;
}

export async function reorderListItems(listId, orderedIds) {
  await open();
  const tx = db.transaction(ITEMS_STORE, 'readwrite');
  const store = tx.objectStore(ITEMS_STORE);
  const now = Date.now();

  for (let i = 0; i < orderedIds.length; i++) {
    const item = await promisify(store.get(orderedIds[i]));
    if (item) {
      item.order = i;
      item.updatedAt = now;
      store.put(item);
    }
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Move between contexts ───

export async function moveItemToList(itemId, listId) {
  await open();
  const store = getStore(ITEMS_STORE, 'readwrite');
  const original = await promisify(store.get(itemId));
  if (!original) return null;

  // Mark original as deleted
  original.deleted = true;
  original.updatedAt = Date.now();
  await promisify(store.put(original));

  // Create in target list
  return addItemToList(listId, original.text);
}

export async function moveItemFromListToDay(itemId, dayDate) {
  await open();
  const store = getStore(ITEMS_STORE, 'readwrite');
  const original = await promisify(store.get(itemId));
  if (!original) return null;

  original.deleted = true;
  original.updatedAt = Date.now();
  await promisify(store.put(original));

  return addItem(dayDate, original.text);
}

// ─── Upsert (for cloud→local sync) ───

export async function upsertItem(data) {
  await open();
  const store = getStore(ITEMS_STORE, 'readwrite');
  await promisify(store.put(data));
}

export async function upsertProject(data) {
  await open();
  const store = getStore(PROJECTS_STORE, 'readwrite');
  await promisify(store.put(data));
}

export async function upsertList(data) {
  await open();
  const store = getStore(LISTS_STORE, 'readwrite');
  await promisify(store.put(data));
}

// ─── Export ───

export async function exportAll() {
  await open();
  const tx = db.transaction([ITEMS_STORE, PROJECTS_STORE, LISTS_STORE], 'readonly');
  const items = await promisify(tx.objectStore(ITEMS_STORE).getAll());
  const projects = await promisify(tx.objectStore(PROJECTS_STORE).getAll());
  const lists = await promisify(tx.objectStore(LISTS_STORE).getAll());
  return {
    items: items.filter(i => !i.deleted),
    projects: projects.filter(p => !p.deleted),
    lists: lists.filter(l => !l.deleted)
  };
}

export async function clearAll() {
  await open();
  const tx = db.transaction([ITEMS_STORE, PROJECTS_STORE, LISTS_STORE], 'readwrite');
  tx.objectStore(ITEMS_STORE).clear();
  tx.objectStore(PROJECTS_STORE).clear();
  tx.objectStore(LISTS_STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
