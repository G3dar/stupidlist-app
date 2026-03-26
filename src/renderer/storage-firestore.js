import { firestore } from '../shared/firebase-config.js';
import { getUid } from './auth.js';
import { generateId, migrateState } from '../shared/constants.js';
import {
  collection, doc, setDoc, getDoc, getDocs, updateDoc,
  query, where, orderBy, writeBatch, onSnapshot
} from 'firebase/firestore';

function userCol(name) {
  return collection(firestore, 'users', getUid(), name);
}

function userDoc(colName, docId) {
  return doc(firestore, 'users', getUid(), colName, docId);
}

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

// ─── Init ───

export async function open() {
  // No-op for Firestore (already initialized via firebase-config.js)
}

// ─── Day Items ───

export async function getItemsForDay(dayDate) {
  const q = query(userCol('items'), where('dayDate', '==', dayDate), where('deleted', '==', false));
  const snap = await getDocs(q);
  return snap.docs.map(d => normalize(d.data())).sort((a, b) => a.order - b.order);
}

export async function addItem(dayDate, text = '') {
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

  await setDoc(userDoc('items', item.id), item);
  return item;
}

export async function getChildrenOf(parentId, dayDate) {
  const items = await getItemsForDay(dayDate);
  return items.filter(i => i.parentId === parentId);
}

export async function updateItem(id, changes) {
  const ref = userDoc('items', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const updated = { ...changes, updatedAt: Date.now() };
  await updateDoc(ref, updated);
  return { ...snap.data(), ...updated };
}

export async function deleteItem(id) {
  const ref = userDoc('items', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  await updateDoc(ref, { deleted: true, updatedAt: Date.now() });
}

export async function getIncompleteItems(beforeDate) {
  const q = query(userCol('items'), where('deleted', '==', false), where('done', '==', false));
  const snap = await getDocs(q);

  return snap.docs
    .map(d => normalize(d.data()))
    .filter(i => i.dayDate && i.dayDate < beforeDate && i.text.trim() !== '')
    .sort((a, b) => {
      if (a.dayDate !== b.dayDate) return b.dayDate.localeCompare(a.dayDate);
      return a.order - b.order;
    });
}

export async function moveItemToDay(itemId, newDayDate) {
  const ref = userDoc('items', itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  await updateDoc(ref, { done: true, updatedAt: Date.now() });
  return addItem(newDayDate, snap.data().text);
}

export async function reorderItems(dayDate, orderedIds) {
  const batch = writeBatch(firestore);
  const now = Date.now();

  for (let i = 0; i < orderedIds.length; i++) {
    batch.update(userDoc('items', orderedIds[i]), { order: i, updatedAt: now });
  }

  await batch.commit();
}

// ─── Projects ───

export async function getAllProjects() {
  const q = query(userCol('projects'), where('deleted', '==', false));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data()).sort((a, b) => a.order - b.order);
}

export async function addProject(name) {
  const existing = await getAllProjects();
  const project = {
    id: generateId(),
    name,
    order: existing.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };

  await setDoc(userDoc('projects', project.id), project);
  await addList(project.id, 'List 1');
  return project;
}

export async function updateProject(id, changes) {
  const ref = userDoc('projects', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const updated = { ...changes, updatedAt: Date.now() };
  await updateDoc(ref, updated);
  return { ...snap.data(), ...updated };
}

export async function deleteProject(id) {
  await updateDoc(userDoc('projects', id), { deleted: true, updatedAt: Date.now() });

  const lists = await getListsForProject(id);
  for (const list of lists) {
    await deleteList(list.id);
  }
}

// ─── Lists ───

export async function getListsForProject(projectId) {
  const q = query(userCol('lists'), where('projectId', '==', projectId), where('deleted', '==', false));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data()).sort((a, b) => a.order - b.order);
}

export async function addList(projectId, name) {
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

  await setDoc(userDoc('lists', list.id), list);
  return list;
}

export async function updateList(id, changes) {
  const ref = userDoc('lists', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const updated = { ...changes, updatedAt: Date.now() };
  await updateDoc(ref, updated);
  return { ...snap.data(), ...updated };
}

export async function deleteList(id) {
  await updateDoc(userDoc('lists', id), { deleted: true, updatedAt: Date.now() });

  const items = await getItemsForList(id);
  for (const item of items) {
    await deleteItem(item.id);
  }
}

// ─── List Items (project items) ───

export async function getItemsForList(listId) {
  const q = query(userCol('items'), where('listId', '==', listId), where('deleted', '==', false));
  const snap = await getDocs(q);
  return snap.docs.map(d => normalize(d.data())).sort((a, b) => a.order - b.order);
}

export async function addItemToList(listId, text = '') {
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

  await setDoc(userDoc('items', item.id), item);
  return item;
}

export async function reorderListItems(listId, orderedIds) {
  const batch = writeBatch(firestore);
  const now = Date.now();

  for (let i = 0; i < orderedIds.length; i++) {
    batch.update(userDoc('items', orderedIds[i]), { order: i, updatedAt: now });
  }

  await batch.commit();
}

// ─── Move between contexts ───

export async function moveItemToList(itemId, listId) {
  const ref = userDoc('items', itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  await updateDoc(ref, { deleted: true, updatedAt: Date.now() });
  return addItemToList(listId, snap.data().text);
}

export async function moveItemFromListToDay(itemId, dayDate) {
  const ref = userDoc('items', itemId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  await updateDoc(ref, { deleted: true, updatedAt: Date.now() });
  return addItem(dayDate, snap.data().text);
}

// ─── Upsert (for local→cloud sync) ───

export async function upsertItem(data) {
  await setDoc(userDoc('items', data.id), data, { merge: true });
}

export async function upsertProject(data) {
  await setDoc(userDoc('projects', data.id), data, { merge: true });
}

export async function upsertList(data) {
  await setDoc(userDoc('lists', data.id), data, { merge: true });
}

// ─── Sharing ───

export async function shareList(listId, projectId, projectName, listName) {
  const shareCode = generateId().replace(/-/g, '').slice(0, 8);
  const shareDoc = doc(firestore, 'shares', shareCode);
  await setDoc(shareDoc, {
    ownerUid: getUid(),
    listId,
    projectId,
    projectName,
    listName,
    createdAt: Date.now()
  });
  return shareCode;
}

export async function getSharedList(shareCode) {
  const shareDoc = doc(firestore, 'shares', shareCode);
  const snap = await getDoc(shareDoc);
  if (!snap.exists()) return null;
  return snap.data();
}

export async function getSharedListItems(ownerUid, listId) {
  const itemsCol = collection(firestore, 'users', ownerUid, 'items');
  const q = query(itemsCol, where('listId', '==', listId), where('deleted', '==', false), orderBy('order'));
  const snap = await getDocs(q);
  return snap.docs.map(d => normalize(d.data())).sort((a, b) => a.order - b.order);
}

// ─── Real-time listeners ───

export function listenToDay(dayDate, callback) {
  const q = query(userCol('items'), where('dayDate', '==', dayDate), where('deleted', '==', false));
  return onSnapshot(q, (snapshot) => {
    const remoteChanges = snapshot.docChanges().filter(c => !c.doc.metadata.hasPendingWrites);
    if (remoteChanges.length === 0) return;

    const upserted = [];
    const removedIds = [];
    for (const change of remoteChanges) {
      if (change.type === 'added' || change.type === 'modified') {
        upserted.push(normalize(change.doc.data()));
      } else if (change.type === 'removed') {
        removedIds.push(change.doc.data().id);
      }
    }
    callback({ upserted, removedIds });
  });
}

export function listenToList(listId, callback) {
  const q = query(userCol('items'), where('listId', '==', listId), where('deleted', '==', false));
  return onSnapshot(q, (snapshot) => {
    const remoteChanges = snapshot.docChanges().filter(c => !c.doc.metadata.hasPendingWrites);
    if (remoteChanges.length === 0) return;

    const upserted = [];
    const removedIds = [];
    for (const change of remoteChanges) {
      if (change.type === 'added' || change.type === 'modified') {
        upserted.push(normalize(change.doc.data()));
      } else if (change.type === 'removed') {
        removedIds.push(change.doc.data().id);
      }
    }
    callback({ upserted, removedIds });
  });
}

export function listenToProjects(callback) {
  const q = query(userCol('projects'), where('deleted', '==', false));
  return onSnapshot(q, (snapshot) => {
    const remoteChanges = snapshot.docChanges().filter(c => !c.doc.metadata.hasPendingWrites);
    if (remoteChanges.length === 0) return;
    callback();
  });
}

// ─── Export ───

export async function exportAll() {
  const [itemsSnap, projectsSnap, listsSnap] = await Promise.all([
    getDocs(query(userCol('items'), where('deleted', '==', false))),
    getDocs(query(userCol('projects'), where('deleted', '==', false))),
    getDocs(query(userCol('lists'), where('deleted', '==', false)))
  ]);

  return {
    items: itemsSnap.docs.map(d => d.data()),
    projects: projectsSnap.docs.map(d => d.data()),
    lists: listsSnap.docs.map(d => d.data())
  };
}
