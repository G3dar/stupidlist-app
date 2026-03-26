import * as storage from './storage.js';
import { formatDateLabel } from '../shared/constants.js';

let expanded = false;

export async function check(targetDate, onRefresh) {
  const container = document.getElementById('carry-over');
  container.innerHTML = '';

  const incomplete = await storage.getIncompleteItems(targetDate);

  if (incomplete.length === 0) return;

  // Button
  const btn = document.createElement('button');
  btn.className = 'carry-over-btn' + (expanded ? ' expanded' : '');
  btn.innerHTML = `
    <span>Bring <strong>${incomplete.length}</strong> unfinished item${incomplete.length === 1 ? '' : 's'}</span>
    <span class="expand-icon">${expanded ? '▾' : '▸'}</span>
  `;
  btn.addEventListener('click', () => {
    expanded = !expanded;
    check(targetDate, onRefresh);
  });
  container.appendChild(btn);

  if (!expanded) return;

  // Group by day
  const groups = {};
  for (const item of incomplete) {
    if (!groups[item.dayDate]) groups[item.dayDate] = [];
    groups[item.dayDate].push(item);
  }

  // Overlay with grouped items
  const overlay = document.createElement('div');
  overlay.className = 'carry-over-overlay';

  const sortedDays = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  for (const day of sortedDays) {
    const group = document.createElement('div');
    group.className = 'carry-over-group';

    const dateHeader = document.createElement('div');
    dateHeader.className = 'carry-over-date';
    dateHeader.textContent = formatDateLabel(day);
    group.appendChild(dateHeader);

    for (const item of groups[day]) {
      const row = document.createElement('div');
      row.className = 'carry-over-item';

      const text = document.createElement('span');
      text.className = 'item-text';
      text.textContent = item.text || '(empty)';

      const badge = document.createElement('span');
      const status = item.status || 'not_started';
      badge.className = `state-badge ${status}`;
      badge.textContent = status === 'not_started' ? '' : status.replace('_', ' ');

      const hint = document.createElement('span');
      hint.className = 'bring-hint';
      hint.textContent = '←';

      row.appendChild(text);
      if (status !== 'not_started') row.appendChild(badge);
      row.appendChild(hint);

      // Middle-click: delete the carry-over item
      row.addEventListener('mousedown', async (e) => {
        if (e.button === 1) {
          e.preventDefault();
          row.classList.add('moving');
          await storage.deleteItem(item.id);
          await check(targetDate, onRefresh);
        }
      });

      row.addEventListener('click', async () => {
        row.classList.add('moving');
        // Add as new item to target day, then mark original as done
        await storage.addItem(targetDate, item.text);
        await storage.updateItem(item.id, { done: true });
        await check(targetDate, onRefresh);
        onRefresh();
      });

      group.appendChild(row);
    }

    overlay.appendChild(group);
  }

  container.appendChild(overlay);
}

export function reset() {
  expanded = false;
}
