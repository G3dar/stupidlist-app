import { initializeApp } from 'firebase/app';
import { getAuth, indexedDBLocalPersistence, browserLocalPersistence, initializeAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: 'AIzaSyDpVS-Irl4nMGIZ9NM_CuiiAxUtPc51K7Q',
  authDomain: 'stupidlist-app.firebaseapp.com',
  projectId: 'stupidlist-app',
  storageBucket: 'stupidlist-app.firebasestorage.app',
  messagingSenderId: '734939820769',
  appId: '1:734939820769:web:21aeff67b041a10103fda0'
};

export let app, auth, firestore;
try {
  app = initializeApp(firebaseConfig);
  // In Capacitor, use explicit indexedDB persistence for auth
  // (getAuth uses indexedDB by default but can conflict with WKWebView internals)
  if (Capacitor.isNativePlatform()) {
    auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence]
    });
  } else {
    auth = getAuth(app);
  }
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn('Firebase init with persistence failed, retrying without:', e);
  if (!app) app = initializeApp(firebaseConfig);
  if (!auth) auth = getAuth(app);
  if (!firestore) firestore = getFirestore(app);
}
