import * as storage from './storage.js';
import { formatDateLabel } from '../shared/constants.js';

let expanded = false;

export async function check(targetDate, onRefresh) {
  const container = document.getElementById('carry-over');
  container.innerHTML = '';

  const incomplete = await storage.getIncompleteItems(targetDate);

  if (incomplete.length === 0) return;

  // Button row
  const btnRow = document.createElement('div');
  btnRow.className = 'carry-over-row';

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

  const bringAllBtn = document.createElement('button');
  bringAllBtn.className = 'carry-over-bring-all';
  bringAllBtn.textContent = 'Bring all';
  bringAllBtn.addEventListener('click', async () => {
    bringAllBtn.disabled = true;
    bringAllBtn.textContent = '...';
    for (const item of incomplete) {
      await storage.addItem(targetDate, item.text);
      await storage.updateItem(item.id, { done: true });
    }
    expanded = false;
    await check(targetDate, onRefresh);
    onRefresh();
  });

  btnRow.appendChild(btn);
  btnRow.appendChild(bringAllBtn);
  container.appendChild(btnRow);

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

    const dateRow = document.createElement('div');
    dateRow.className = 'carry-over-date-row';

    const dateHeader = document.createElement('span');
    dateHeader.className = 'carry-over-date';
    dateHeader.textContent = formatDateLabel(day);

    const bringDayBtn = document.createElement('button');
    bringDayBtn.className = 'carry-over-bring-day';
    bringDayBtn.textContent = `bring ${groups[day].length}`;
    bringDayBtn.addEventListener('click', async () => {
      bringDayBtn.disabled = true;
      bringDayBtn.textContent = '...';
      for (const item of groups[day]) {
        await storage.addItem(targetDate, item.text);
        await storage.updateItem(item.id, { done: true });
      }
      await check(targetDate, onRefresh);
      onRefresh();
    });

    dateRow.appendChild(dateHeader);
    dateRow.appendChild(bringDayBtn);
    group.appendChild(dateRow);

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
