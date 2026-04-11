import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export const isElectron = !!(window.stupidlist && window.stupidlist.isElectron);
export const isCapacitor = Capacitor.isNativePlatform();
export const isWeb = !isElectron && !isCapacitor;

export function hapticFeedback() {
  if (isCapacitor) {
    Haptics.impact({ style: ImpactStyle.Light });
  } else if (navigator.vibrate) {
    navigator.vibrate(50);
  }
}
