import * as local from './storage-local.js';
import { firestore } from '../shared/firebase-config.js';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

export async function checkAndMigrate(uid) {
  // Check if local has data
  await local.open();
  const localData = await local.exportAll();
  const localHasData = localData.items.length > 0 || localData.projects.length > 0;

  if (!localHasData) {
    return { needsMigration: false };
  }

  // Check if these local items were already uploaded (by matching IDs)
  const snap = await getDocs(collection(firestore, 'users', uid, 'items'));
  const cloudIds = new Set(snap.docs.map(d => d.id));
  const newItems = localData.items.filter(i => !cloudIds.has(i.id));
  const newProjects = localData.projects.filter(p => !cloudIds.has(p.id));

  // Also check projects
  const projSnap = await getDocs(collection(firestore, 'users', uid, 'projects'));
  const cloudProjIds = new Set(projSnap.docs.map(d => d.id));
  const uniqueProjects = newProjects.filter(p => !cloudProjIds.has(p.id));

  const hasNewData = newItems.length > 0 || uniqueProjects.length > 0;

  if (hasNewData) {
    return { needsMigration: true, localData };
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
