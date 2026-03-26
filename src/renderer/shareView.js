import * as storage from './storage.js';

export async function load(shareCode) {
  let shareData;
  try {
    shareData = await storage.getSharedList(shareCode);
  } catch (err) {
    console.error('Share load error:', err);
    showError('Could not load share link. Please try again.');
    return;
  }
  if (!shareData) {
    showError('Share link not found or expired.');
    return;
  }

  const { ownerUid, listId, projectName, listName } = shareData;

  // Hide normal UI elements
  document.getElementById('day-nav').style.display = 'none';
  document.getElementById('list-nav').style.display = 'none';
  document.getElementById('btn-projects').style.display = 'none';
  document.getElementById('carry-over').innerHTML = '';
  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) settingsBtn.style.display = 'none';
  const authArea = document.getElementById('auth-area');
  if (authArea) authArea.style.display = 'none';

  // Update header
  const logo = document.querySelector('.logo');
  logo.textContent = projectName;

  // Show shared banner
  const banner = document.createElement('div');
  banner.className = 'share-banner';
  banner.innerHTML = `<span>📋 <strong>${listName}</strong> — Shared list (read only)</span>`;
  const container = document.getElementById('list-container');
  container.parentNode.insertBefore(banner, container);

  // Load and render items
  try {
    const items = await storage.getSharedListItems(ownerUid, listId);
    renderReadOnly(items);
  } catch (err) {
    showError('Could not load shared list. The owner may need to update sharing permissions.');
  }
}

function renderReadOnly(items) {
  const list = document.getElementById('item-list');
  list.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'This list is empty.';
    list.appendChild(empty);
    return;
  }

  // Build parent set
  const parentIds = new Set(items.filter(i => i.parentId).map(i => i.parentId));

  // Sort with hierarchy
  const topLevel = items.filter(i => !i.parentId);
  const sorted = [];
  for (const parent of topLevel) {
    const children = items.filter(i => i.parentId === parent.id).sort((a, b) => a.order - b.order);
    sorted.push(parent);
    for (const child of children) {
      sorted.push(child);
    }
  }

  let topNum = 0;
  let childNum = 0;

  sorted.forEach((itemData) => {
    const li = document.createElement('li');
    li.className = 'item item--readonly';
    if (itemData.depth > 0) li.classList.add('item--child');
    if (parentIds.has(itemData.id)) li.classList.add('item--parent');
    if (itemData.done) li.classList.add('item--done');
    if (itemData.status && itemData.status !== 'not_started') {
      li.classList.add(`item--${itemData.status}`);
    }
    if (itemData.color) li.style.color = itemData.color;
    if (itemData.bgColor) li.style.backgroundColor = itemData.bgColor;

    // Number
    const num = document.createElement('span');
    num.className = 'item-number';
    if (itemData.depth > 0) {
      childNum++;
      num.textContent = `${topNum}.${childNum}`;
    } else {
      topNum++;
      childNum = 0;
      num.textContent = `${topNum}.`;
    }

    // Text
    const text = document.createElement('span');
    text.className = 'item-text';
    if (itemData.text) {
      const hasHtml = /<[a-z][\s\S]*>/i.test(itemData.text);
      text.innerHTML = hasHtml ? itemData.text : itemData.text;
    }

    // Done indicator
    const done = document.createElement('span');
    done.className = 'item-done';
    done.textContent = itemData.done ? '☑' : '☐';

    li.appendChild(num);
    li.appendChild(text);
    li.appendChild(done);
    list.appendChild(li);
  });
}

function showError(message) {
  const list = document.getElementById('item-list');
  list.innerHTML = '';
  const err = document.createElement('li');
  err.className = 'empty-state';
  err.textContent = message;
  list.appendChild(err);
}
