import * as storage from './storage.js';

// ─── Undo/Redo Manager (Command Pattern) ───

const MAX_STACK = 50;
const undoStack = [];
const redoStack = [];
let currentBatch = null;

// ─── Public API ───

export function push(action) {
  if (currentBatch) {
    currentBatch.actions.push(action);
    return;
  }
  undoStack.push(action);
  if (undoStack.length > MAX_STACK) undoStack.shift();
  redoStack.length = 0; // new action clears redo
}

export async function undo() {
  if (undoStack.length === 0) return false;
  const action = undoStack.pop();
  await executeUndo(action);
  redoStack.push(action);
  return true;
}

export async function redo() {
  if (redoStack.length === 0) return false;
  const action = redoStack.pop();
  await executeRedo(action);
  undoStack.push(action);
  return true;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

export function clear() {
  undoStack.length = 0;
  redoStack.length = 0;
  currentBatch = null;
}

export function startBatch(label) {
  currentBatch = { type: 'batch', label, actions: [] };
}

export function endBatch() {
  if (!currentBatch) return;
  const batch = currentBatch;
  currentBatch = null;
  if (batch.actions.length > 0) {
    push(batch);
  }
}

// ─── Execute ───

async function executeUndo(action) {
  switch (action.type) {
    case 'update':
      await getStorageUpdate(action.entityType)(action.id, action.before);
      break;
    case 'create':
      await getStorageDelete(action.entityType)(action.id);
      break;
    case 'delete':
      await getStorageUpdate(action.entityType)(action.id, { ...action.data, deleted: false });
      break;
    case 'reorder':
      if (action.context.dayDate) {
        await storage.reorderItems(action.context.dayDate, action.beforeIds);
      } else if (action.context.listId) {
        await storage.reorderListItems(action.context.listId, action.beforeIds);
      }
      break;
    case 'batch':
      for (let i = action.actions.length - 1; i >= 0; i--) {
        await executeUndo(action.actions[i]);
      }
      break;
  }
}

async function executeRedo(action) {
  switch (action.type) {
    case 'update':
      await getStorageUpdate(action.entityType)(action.id, action.after);
      break;
    case 'create':
      await getStorageUpdate(action.entityType)(action.id, { ...action.data, deleted: false });
      break;
    case 'delete':
      await getStorageDelete(action.entityType)(action.id);
      break;
    case 'reorder':
      if (action.context.dayDate) {
        await storage.reorderItems(action.context.dayDate, action.afterIds);
      } else if (action.context.listId) {
        await storage.reorderListItems(action.context.listId, action.afterIds);
      }
      break;
    case 'batch':
      for (const sub of action.actions) {
        await executeRedo(sub);
      }
      break;
  }
}

// ─── Helpers ───

function getStorageUpdate(entityType) {
  switch (entityType) {
    case 'project': return storage.updateProject;
    case 'list': return storage.updateList;
    case 'customView': return storage.updateCustomView;
    default: return storage.updateItem;
  }
}

function getStorageDelete(entityType) {
  switch (entityType) {
    case 'project': return storage.deleteProject;
    case 'list': return storage.deleteList;
    case 'customView': return storage.deleteCustomView;
    default: return storage.deleteItem;
  }
}
