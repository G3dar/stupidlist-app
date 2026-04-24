import '../shared/firebase-config.js';
import './style.css';
import { isCapacitor } from '../shared/platform.js';
import { init } from './app.js';
import { initKeyboardHandling } from './keyboard.js';

async function initCapacitorPlugins() {
  if (!isCapacitor) {
    initKeyboardHandling();
    return;
  }

  const { StatusBar, Style } = await import('@capacitor/status-bar');
  StatusBar.setStyle({ style: Style.Light });

  const { Keyboard } = await import('@capacitor/keyboard');
  Keyboard.setAccessoryBarVisible({ isVisible: true });
  initKeyboardHandling({ Keyboard });

  const { SplashScreen } = await import('@capacitor/splash-screen');
  SplashScreen.hide();
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  initCapacitorPlugins();
});
