import * as local from './storage-local.js';
import * as cloud from './storage-firestore.js';
import { authState, onAuthChange } from './auth.js';

// ─── Local-first architecture ───
// All reads go to IndexedDB (instant).
// All writes go to IndexedDB first, then sync to Firestore in background.

function syncToCloud(fn) {
  if (!authState.isLoggedIn) return;
  fn().catch(err => console.warn('Cloud sync:', err.message));
}

// ─── Init ───

export async function open() {
  await local.open();
}

// ─── Reads (always local — instant) ───

export function getItem(id) { return local.getItem(id); }
export function getProject(id) { return local.getProject(id); }
export function getItemsForDay(d) { return local.getItemsForDay(d); }
export function getChildrenOf(p, d) { return local.getChildrenOf(p, d); }
export function getIncompleteItems(b) { return local.getIncompleteItems(b); }
export function getAllProjects() { return local.getAllProjects(); }
export function getListsForProject(pid) { return local.getListsForProject(pid); }
export function getItemsForList(lid) { return local.getItemsForList(lid); }
export function getStandaloneLists() { return local.getStandaloneLists(); }
export function getList(id) { return local.getList(id); }
export function exportAll() { return local.exportAll(); }

// ─── Writes (local first, cloud background via upsert) ───

export async function addItem(d, t) {
  const item = await local.addItem(d, t);
  syncToCloud(() => cloud.upsertItem(item));
  return item;
}

export async function updateItem(id, c) {
  const item = await local.updateItem(id, c);
  if (item) syncToCloud(() => cloud.upsertItem(item));
  return item;
}

export async function deleteItem(id) {
  await local.deleteItem(id);
  syncToCloud(() => cloud.updateItem(id, { deleted: true, updatedAt: Date.now() }));
}

export async function moveItemToDay(id, d) {
  // local.moveItemToDay marks original as done and creates a new item
  const newItem = await local.moveItemToDay(id, d);
  syncToCloud(async () => {
    await cloud.updateItem(id, { done: true, updatedAt: Date.now() });
    if (newItem) await cloud.upsertItem(newItem);
  });
  return newItem;
}

export async function reorderItems(d, ids) {
  await local.reorderItems(d, ids);
  syncToCloud(() => cloud.reorderItems(d, ids));
}

export async function addProject(n) {
  const project = await local.addProject(n);
  syncToCloud(async () => {
    await cloud.upsertProject(project);
    // Also sync the auto-created default list
    const lists = await local.getListsForProject(project.id);
    for (const list of lists) await cloud.upsertList(list);
  });
  return project;
}

export async function updateProject(id, c) {
  const project = await local.updateProject(id, c);
  if (project) syncToCloud(() => cloud.upsertProject(project));
  return project;
}

export async function deleteProject(id) {
  await local.deleteProject(id);
  syncToCloud(() => cloud.deleteProject(id));
}

export async function addStandaloneList(name) {
  const list = await local.addList(null, name);
  syncToCloud(() => cloud.upsertList(list));
  return list;
}

export async function moveListToProject(lid, pid) {
  const list = await local.moveListToProject(lid, pid);
  if (list) syncToCloud(() => cloud.upsertList(list));
  return list;
}

export async function addList(pid, n) {
  const list = await local.addList(pid, n);
  syncToCloud(() => cloud.upsertList(list));
  return list;
}

export async function updateList(id, c) {
  const list = await local.updateList(id, c);
  if (list) syncToCloud(() => cloud.upsertList(list));
  return list;
}

export async function deleteList(id) {
  await local.deleteList(id);
  syncToCloud(() => cloud.deleteList(id));
}

export async function addItemToList(lid, t) {
  const item = await local.addItemToList(lid, t);
  syncToCloud(() => cloud.upsertItem(item));
  return item;
}

export async function reorderListItems(lid, ids) {
  await local.reorderListItems(lid, ids);
  syncToCloud(() => cloud.reorderListItems(lid, ids));
}

export async function tagItemToList(itemId, listId, projectId, projectTag) {
  const item = await local.tagItemToList(itemId, listId, projectId, projectTag);
  if (item) syncToCloud(() => cloud.upsertItem(item));
  return item;
}

export async function untagItem(itemId) {
  const item = await local.untagItem(itemId);
  if (item) syncToCloud(() => cloud.upsertItem(item));
  return item;
}

export async function getOrCreateDefaultTagList(projectId) {
  const list = await local.getOrCreateDefaultTagList(projectId);
  syncToCloud(() => cloud.upsertList(list));
  return list;
}

export async function moveItemToList(iid, lid) {
  const newItem = await local.moveItemToList(iid, lid);
  syncToCloud(async () => {
    await cloud.updateItem(iid, { deleted: true, updatedAt: Date.now() });
    if (newItem) await cloud.upsertItem(newItem);
  });
  return newItem;
}

export async function moveItemFromListToDay(iid, d) {
  const newItem = await local.moveItemFromListToDay(iid, d);
  syncToCloud(async () => {
    await cloud.updateItem(iid, { deleted: true, updatedAt: Date.now() });
    if (newItem) await cloud.upsertItem(newItem);
  });
  return newItem;
}

// ─── Sharing (cloud only) ───

export function shareList(lid, pid, pn, ln) { return cloud.shareList(lid, pid, pn, ln); }
export function shareListForWrite(lid, pid, pn, ln) { return cloud.shareListForWrite(lid, pid, pn, ln); }
export function revokeWriteShare(lid) { return cloud.revokeWriteShare(lid); }
export function getSharedList(code) { return cloud.getSharedList(code); }
export function getSharedListItems(uid, lid) { return cloud.getSharedListItems(uid, lid); }
export function sharedAddItemToList(uid, lid, t) { return cloud.sharedAddItemToList(uid, lid, t); }
export function sharedUpdateItem(uid, id, c) { return cloud.sharedUpdateItem(uid, id, c); }
export function sharedDeleteItem(uid, id) { return cloud.sharedDeleteItem(uid, id); }
export function sharedReorderListItems(uid, lid, ids) { return cloud.sharedReorderListItems(uid, lid, ids); }
export function sharedListenToList(uid, lid, cb) { return cloud.sharedListenToList(uid, lid, cb); }

// ─── Login tracking (cloud only) ───

export function recordLogin(user) { return cloud.recordLogin(user); }
export function getAllLogins() { return cloud.getAllLogins(); }

// ─── Cloud → Local sync (on login / app load) ───

export async function pullFromCloud() {
  if (!authState.isLoggedIn) return;
  try {
    const cloudData = await cloud.exportAll();
    await local.open();
    const localData = await local.exportAll();

    // Merge cloud items into local (cloud wins if newer)
    const localItemMap = new Map(localData.items.map(i => [i.id, i]));
    for (const ci of cloudData.items) {
      const li = localItemMap.get(ci.id);
      if (!li || ci.updatedAt > li.updatedAt) {
        await local.upsertItem(ci);
      }
    }

    const localProjMap = new Map(localData.projects.map(p => [p.id, p]));
    for (const cp of cloudData.projects) {
      const lp = localProjMap.get(cp.id);
      if (!lp || cp.updatedAt > lp.updatedAt) {
        await local.upsertProject(cp);
      }
    }

    const localListMap = new Map(localData.lists.map(l => [l.id, l]));
    for (const cl of cloudData.lists) {
      const ll = localListMap.get(cl.id);
      if (!ll || cl.updatedAt > ll.updatedAt) {
        await local.upsertList(cl);
      }
    }
  } catch (err) {
    console.warn('Pull from cloud failed:', err.message);
  }
}

// ─── Real-time subscriptions ───

let currentUnsub = null;

export function subscribe(type, key, onRemoteChange) {
  unsubscribe();
  if (!authState.isLoggedIn) return;
  if (document.visibilityState !== 'visible') return;

  const handleChanges = async ({ upserted, removedIds }) => {
    for (const item of upserted) {
      await local.upsertItem(item);
    }
    for (const id of removedIds) {
      await local.upsertItem({ id, deleted: true, updatedAt: Date.now() });
    }
    onRemoteChange();
  };

  if (type === 'day') {
    currentUnsub = cloud.listenToDay(key, handleChanges);
  } else if (type === 'list') {
    currentUnsub = cloud.listenToList(key, handleChanges);
  }
}

export function unsubscribe() {
  if (currentUnsub) {
    currentUnsub();
    currentUnsub = null;
  }
}

// Expose local backend for migration
export { local };
