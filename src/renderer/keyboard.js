import { isCapacitor } from '../shared/platform.js';

const root = document.documentElement;

function setKbHeight(px) {
  root.style.setProperty('--kb-h', px + 'px');
  const carryOver = document.getElementById('carry-over');
  if (carryOver) carryOver.style.display = px > 0 ? 'none' : '';
}

export function initKeyboardHandling({ Keyboard } = {}) {
  if (isCapacitor && Keyboard) {
    Keyboard.addListener('keyboardWillShow', (info) => setKbHeight(info.keyboardHeight));
    Keyboard.addListener('keyboardWillHide', () => setKbHeight(0));
  } else if (window.visualViewport) {
    const vv = window.visualViewport;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbHeight(kb);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('.item-text');
    if (!el) return;
    setTimeout(() => {
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (_) {
        el.scrollIntoView();
      }
    }, 250);
  });
}
