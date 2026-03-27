import { auth } from '../shared/firebase-config.js';
import { GoogleAuthProvider, signInWithPopup, signInWithCredential, signInAnonymously as firebaseSignInAnon, onAuthStateChanged } from 'firebase/auth';

export const authState = {
  isLoggedIn: false,
  user: null,
  uid: null
};

const listeners = [];
const isElectron = !!(window.stupidlist && window.stupidlist.isElectron);

export function onAuthChange(callback) {
  listeners.push(callback);
}

export function getUid() {
  return authState.uid;
}

export async function signIn() {
  if (isElectron) {
    // Electron: use main process BrowserWindow for OAuth
    try {
      const result = await window.stupidlist.googleSignIn();
      if (result && result.idToken) {
        const credential = GoogleAuthProvider.credential(result.idToken);
        await signInWithCredential(auth, credential);
      }
    } catch (err) {
      console.error('Sign-in error:', err);
    }
  } else {
    // Web: standard popup
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('Sign-in error:', err);
      }
    }
  }
}

export async function signOut() {
  await auth.signOut();
}

export async function signInAnonymouslyIfNeeded() {
  if (authState.isLoggedIn) return;
  await firebaseSignInAnon(auth);
}

// Listen for auth state changes (also fires on page load with persisted session)
onAuthStateChanged(auth, (user) => {
  authState.isLoggedIn = !!user;
  authState.user = user;
  authState.uid = user ? user.uid : null;
  listeners.forEach((cb) => cb(user));
});
