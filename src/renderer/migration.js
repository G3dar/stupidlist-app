import * as local from './storage-local.js';
import { firestore } from '../shared/firebase-config.js';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

export async function checkAndMigrate(uid) {
  // Check if local has data
  await local.open();
  const localData = await local.exportAll();

  // Ignore empty items (no text)
  const meaningfulItems = localData.items.filter(i => i.text && i.text.trim() !== '');
  const localHasData = meaningfulItems.length > 0 || localData.projects.length > 0;

  if (!localHasData) {
    return { needsMigration: false };
  }

  // Check which local items/projects/lists are actually new (not already in cloud)
  const [itemsSnap, projSnap, listsSnap] = await Promise.all([
    getDocs(collection(firestore, 'users', uid, 'items')),
    getDocs(collection(firestore, 'users', uid, 'projects')),
    getDocs(collection(firestore, 'users', uid, 'lists'))
  ]);

  const cloudItemIds = new Set(itemsSnap.docs.map(d => d.id));
  const cloudProjIds = new Set(projSnap.docs.map(d => d.id));
  const cloudListIds = new Set(listsSnap.docs.map(d => d.id));

  const newItems = meaningfulItems.filter(i => !cloudItemIds.has(i.id));
  const newProjects = localData.projects.filter(p => !cloudProjIds.has(p.id));
  const newLists = localData.lists.filter(l => !cloudListIds.has(l.id));

  const hasNewData = newItems.length > 0 || newProjects.length > 0;

  if (hasNewData) {
    // Only pass the truly new data to avoid duplicating existing items
    return {
      needsMigration: true,
      localData: { items: newItems, projects: newProjects, lists: newLists }
    };
  }
  return { needsMigration: false };
}

export async function uploadLocalData(uid, localData) {
  const BATCH_SIZE = 450;
  const ops = [];

  for (const item of localData.items) {
    ops.push({ col: 'items', data: item });
  }
  for (const project of localData.projects) {
    ops.push({ col: 'projects', data: project });
  }
  for (const list of localData.lists) {
    ops.push({ col: 'lists', data: list });
  }

  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore);
    const chunk = ops.slice(i, i + BATCH_SIZE);
    for (const op of chunk) {
      // Use set with merge to avoid overwriting existing cloud data
      batch.set(doc(firestore, 'users', uid, op.col, op.data.id), op.data, { merge: true });
    }
    await batch.commit();
  }
}
