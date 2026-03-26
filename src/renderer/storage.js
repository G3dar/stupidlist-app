import * as local from './storage-local.js';
import * as cloud from './storage-firestore.js';
import { authState } from './auth.js';

function backend() {
  return authState.isLoggedIn ? cloud : local;
}

export function open() { return backend().open(); }
export function getItemsForDay(d) { return backend().getItemsForDay(d); }
export function addItem(d, t) { return backend().addItem(d, t); }
export function getChildrenOf(p, d) { return backend().getChildrenOf(p, d); }
export function updateItem(id, c) { return backend().updateItem(id, c); }
export function deleteItem(id) { return backend().deleteItem(id); }
export function getIncompleteItems(b) { return backend().getIncompleteItems(b); }
export function moveItemToDay(id, d) { return backend().moveItemToDay(id, d); }
export function reorderItems(d, ids) { return backend().reorderItems(d, ids); }
export function getAllProjects() { return backend().getAllProjects(); }
export function addProject(n) { return backend().addProject(n); }
export function updateProject(id, c) { return backend().updateProject(id, c); }
export function deleteProject(id) { return backend().deleteProject(id); }
export function getListsForProject(pid) { return backend().getListsForProject(pid); }
export function addList(pid, n) { return backend().addList(pid, n); }
export function updateList(id, c) { return backend().updateList(id, c); }
export function deleteList(id) { return backend().deleteList(id); }
export function getItemsForList(lid) { return backend().getItemsForList(lid); }
export function addItemToList(lid, t) { return backend().addItemToList(lid, t); }
export function reorderListItems(lid, ids) { return backend().reorderListItems(lid, ids); }
export function moveItemToList(iid, lid) { return backend().moveItemToList(iid, lid); }
export function moveItemFromListToDay(iid, d) { return backend().moveItemFromListToDay(iid, d); }
export function exportAll() { return backend().exportAll(); }

// Sharing (cloud only)
export function shareList(lid, pid, pn, ln) { return cloud.shareList(lid, pid, pn, ln); }
export function getSharedList(code) { return cloud.getSharedList(code); }
export function getSharedListItems(uid, lid) { return cloud.getSharedListItems(uid, lid); }

// Expose local backend for migration
export { local };
