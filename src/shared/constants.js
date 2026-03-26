// Status (separate from done)
export const STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  WAITING: 'waiting',
  TBD: 'tbd'
};

export const STATUS_CYCLE = ['not_started', 'in_progress', 'waiting', 'tbd'];

export const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  tbd: 'TBD'
};

export const STATUS_ICONS = {
  not_started: '○',
  in_progress: '▶',
  waiting: '⏳',
  tbd: '◇'
};

// Legacy compat: map old states to new model
export function migrateState(oldState) {
  if (oldState === 'done') return { done: true, status: 'not_started' };
  if (oldState === 'doing' || oldState === 'wip') return { done: false, status: 'in_progress' };
  if (oldState === 'later' || oldState === 'wait') return { done: false, status: 'waiting' };
  return { done: false, status: 'not_started' };
}

export const DB_NAME = 'stupidlist';
export const DB_VERSION = 3;
export const ITEMS_STORE = 'items';
export const PROJECTS_STORE = 'projects';
export const LISTS_STORE = 'lists';

export function toDateKey(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateKeyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateLabel(dateKey) {
  const date = dateKeyToDate(dateKey);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function getDayName(dateKey) {
  const date = dateKeyToDate(dateKey);
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  return days[date.getDay()];
}

export function addDays(dateKey, n) {
  const date = dateKeyToDate(dateKey);
  date.setDate(date.getDate() + n);
  return toDateKey(date);
}

export function generateId() {
  return crypto.randomUUID();
}
