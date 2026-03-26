let visible = false;
let backdrop = null;

const tips = [
  // Item row tips - anchored to first item's sub-elements
  { target: '.item:first-child .item-number', text: 'drag to reorder', pos: 'left' },
  { target: '.item:first-child .item-text', key: 'Tab', text: 'indent as sub-item', pos: 'bottom' },
  { target: '.item:first-child .item-status', lines: [
    { key: 'click', text: 'cycle status' },
    { key: 'right-click', text: 'configure' },
    { key: 'wheel click', text: 'remove status' },
  ], pos: 'bottom' },
  { target: '.item:first-child .item-done', key: 'wheel click', text: 'delete item', pos: 'bottom' },

  // Header tips
  { target: '#btn-prev', key: 'Ctrl+← →', text: 'navigate days', pos: 'bottom' },
  { target: null, key: 'Ctrl+Z', text: 'undo delete', pos: 'floating' },
  { target: '.btn-download', text: 'download desktop app', pos: 'bottom' },
  { target: '.auth-btn,.auth-user', text: 'sign in to sync across devices', pos: 'bottom' },
];

export function init() {
  const btn = document.createElement('button');
  btn.className = 'btn-help';
  btn.title = 'Help';
  btn.textContent = '?';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });

  const download = document.getElementById('download-btn');
  const settings = document.getElementById('btn-settings');
  if (download) {
    download.parentNode.insertBefore(btn, download.nextSibling);
  } else if (settings) {
    settings.parentNode.insertBefore(btn, settings.nextSibling);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && visible) hide();
  });
}

function toggle() {
  if (visible) hide(); else show();
}

function show() {
  if (visible) return;
  visible = true;

  backdrop = document.createElement('div');
  backdrop.className = 'help-backdrop';
  backdrop.addEventListener('click', hide);
  document.body.appendChild(backdrop);

  for (const tip of tips) {
    createBubble(tip);
  }
}

function hide() {
  if (!visible) return;
  visible = false;
  if (backdrop) {
    backdrop.remove();
    backdrop = null;
  }
}

function createBubble(tip) {
  if (tip.pos === 'floating') {
    const bubble = makeBubbleEl(tip);
    bubble.classList.add('help-bubble--floating');
    backdrop.appendChild(bubble);
    return;
  }

  const el = document.querySelector(tip.target);
  if (!el || el.offsetParent === null) return;

  const rect = el.getBoundingClientRect();
  const bubble = tip.lines ? makeMultiBubbleEl(tip) : makeBubbleEl(tip);
  bubble.classList.add(`help-bubble--${tip.pos}`);
  backdrop.appendChild(bubble);

  const bRect = bubble.getBoundingClientRect();
  const gap = 10;

  let top, left;
  switch (tip.pos) {
    case 'top':
      top = rect.top - bRect.height - gap;
      left = rect.left + rect.width / 2 - bRect.width / 2;
      break;
    case 'bottom':
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2 - bRect.width / 2;
      break;
    case 'left':
      top = rect.top + rect.height / 2 - bRect.height / 2;
      left = rect.left - bRect.width - gap;
      break;
    case 'right':
      top = rect.top + rect.height / 2 - bRect.height / 2;
      left = rect.right + gap;
      break;
  }

  // Clamp to viewport
  left = Math.max(8, Math.min(left, window.innerWidth - bRect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - bRect.height - 8));

  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}

function makeBubbleEl(tip) {
  const bubble = document.createElement('div');
  bubble.className = 'help-bubble';
  let html = '';
  if (tip.key) html += `<span class="help-key">${tip.key}</span> `;
  html += tip.text;
  bubble.innerHTML = html;
  return bubble;
}

function makeMultiBubbleEl(tip) {
  const bubble = document.createElement('div');
  bubble.className = 'help-bubble';
  bubble.innerHTML = tip.lines.map(line =>
    `<div class="help-line"><span class="help-key">${line.key}</span> ${line.text}</div>`
  ).join('');
  return bubble;
}
