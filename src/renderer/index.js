import '../shared/firebase-config.js';
import './style.css';
import { isCapacitor } from '../shared/platform.js';
import { init } from './app.js';

async function initCapacitorPlugins() {
  if (!isCapacitor) return;

  const { StatusBar, Style } = await import('@capacitor/status-bar');
  StatusBar.setStyle({ style: Style.Light });

  const { Keyboard } = await import('@capacitor/keyboard');
  Keyboard.setAccessoryBarVisible({ isVisible: true });

  const carryOver = document.getElementById('carry-over');
  Keyboard.addListener('keyboardWillShow', () => {
    if (carryOver) carryOver.style.display = 'none';
  });
  Keyboard.addListener('keyboardWillHide', () => {
    if (carryOver) carryOver.style.display = '';
  });

  const { SplashScreen } = await import('@capacitor/splash-screen');
  SplashScreen.hide();
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  initCapacitorPlugins();
});
