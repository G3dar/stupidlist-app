import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDpVS-Irl4nMGIZ9NM_CuiiAxUtPc51K7Q',
  authDomain: 'stupidlist-app.firebaseapp.com',
  projectId: 'stupidlist-app',
  storageBucket: 'stupidlist-app.firebasestorage.app',
  messagingSenderId: '734939820769',
  appId: '1:734939820769:web:21aeff67b041a10103fda0'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

// Enable offline persistence for Firestore
enableIndexedDbPersistence(firestore).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence not available in this browser');
  }
});
