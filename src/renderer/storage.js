import * as local from './storage-local.js';
import * as cloud from './storage-firestore.js';
import { authState, onAuthChange } from './auth.js';

// ─── Local-first architecture ───
// All reads go to IndexedDB (instant).
// All writes go to IndexedDB first, then sync to Firestore in background.

function syncToCloud(fn) {
  if (!authState.isLoggedIn) return;
  const attempt = (retries, delay) => {
    fn().catch(err => {
      if (retries > 0) {
        setTimeout(() => attempt(retries - 1, delay * 2), delay);
      } else {
        console.warn('Cloud sync failed after retries:', err.message);
      }
    });
  };
  attempt(3, 1000);
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
export function revokeReadShare(lid, code) { return cloud.revokeReadShare(lid, code); }
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

// ─── Bidirectional sync (on login / app load / reconnect) ───

let syncInProgress = false;
let syncQueued = false;

export async function syncWithCloud() {
  if (!authState.isLoggedIn) return;
  if (syncInProgress) {
    syncQueued = true;
    return;
  }
  syncInProgress = true;
  try {
    const cloudData = await cloud.exportAll();
    await local.open();
    const localData = await local.exportAllRaw();

    const localItemMap = new Map(localData.items.map(i => [i.id, i]));
    const localProjMap = new Map(localData.projects.map(p => [p.id, p]));
    const localListMap = new Map(localData.lists.map(l => [l.id, l]));

    const cloudItemMap = new Map(cloudData.items.map(i => [i.id, i]));
    const cloudProjMap = new Map(cloudData.projects.map(p => [p.id, p]));
    const cloudListMap = new Map(cloudData.lists.map(l => [l.id, l]));

    // Cloud → Local (cloud wins if newer)
    for (const ci of cloudData.items) {
      const li = localItemMap.get(ci.id);
      if (!li || ci.updatedAt > li.updatedAt) {
        await local.upsertItem(ci);
      }
    }
    for (const cp of cloudData.projects) {
      const lp = localProjMap.get(cp.id);
      if (!lp || cp.updatedAt > lp.updatedAt) {
        await local.upsertProject(cp);
      }
    }
    for (const cl of cloudData.lists) {
      const ll = localListMap.get(cl.id);
      if (!ll || cl.updatedAt > ll.updatedAt) {
        await local.upsertList(cl);
      }
    }

    // Local → Cloud (push items that never reached cloud or are newer locally)
    for (const li of localData.items) {
      const ci = cloudItemMap.get(li.id);
      if (!ci || li.updatedAt > ci.updatedAt) {
        await cloud.upsertItem(li);
      }
    }
    for (const lp of localData.projects) {
      const cp = cloudProjMap.get(lp.id);
      if (!cp || lp.updatedAt > cp.updatedAt) {
        await cloud.upsertProject(lp);
      }
    }
    for (const ll of localData.lists) {
      const cl = cloudListMap.get(ll.id);
      if (!cl || ll.updatedAt > cl.updatedAt) {
        await cloud.upsertList(ll);
      }
    }
  } catch (err) {
    console.warn('Sync with cloud failed:', err.message);
  } finally {
    syncInProgress = false;
    if (syncQueued) {
      syncQueued = false;
      syncWithCloud();
    }
  }
}

// ─── Cleanup abandoned empty lists ───

export async function cleanupEmptyLists() {
  const now = Date.now();

  // Standalone lists
  const standaloneLists = await local.getStandaloneLists();
  for (const list of standaloneLists) {
    const isDefault = !list.name || list.name === 'Untitled list';
    if (!isDefault) continue;
    if ((now - list.createdAt) < 120000) continue;
    const items = await local.getItemsForList(list.id);
    const realItems = items.filter(i => !i.isSpacer && (i.text || '').trim() !== '');
    if (realItems.length > 0) continue;
    await deleteList(list.id);
  }

  // Project lists
  const projects = await local.getAllProjects();
  for (const project of projects) {
    const lists = await local.getListsForProject(project.id);
    if (lists.length <= 1) continue;
    for (const list of lists) {
      const isDefault = /^List \d+$/.test(list.name) || !list.name;
      if (!isDefault) continue;
      if ((now - list.createdAt) < 120000) continue;
      const items = await local.getItemsForList(list.id);
      const realItems = items.filter(i => !i.isSpacer && (i.text || '').trim() !== '');
      if (realItems.length > 0) continue;
      // Re-check count to avoid deleting the last list
      const remaining = await local.getListsForProject(project.id);
      if (remaining.filter(l => l.id !== list.id).length < 1) continue;
      await deleteList(list.id);
    }
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
