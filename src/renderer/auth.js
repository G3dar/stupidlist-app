import { auth } from '../shared/firebase-config.js';
import { GoogleAuthProvider, signInWithPopup, signInWithCredential, signInAnonymously as firebaseSignInAnon, onAuthStateChanged } from 'firebase/auth';
import { isElectron, isCapacitor } from '../shared/platform.js';

export const authState = {
  isLoggedIn: false,
  user: null,
  uid: null
};

const listeners = [];

// OAuth config: use the iOS client ID for the OAuth flow (allows custom URL scheme redirect)
// and pass the web client ID as audience hint so the id_token works with Firebase
const IOS_CLIENT_ID = '734939820769-ubdsl5foa5orggf0d3l2cft4ooncs69a.apps.googleusercontent.com';
const IOS_REDIRECT_SCHEME = 'com.googleusercontent.apps.734939820769-ubdsl5foa5orggf0d3l2cft4ooncs69a';

export function onAuthChange(callback) {
  listeners.push(callback);
}

export function getUid() {
  return authState.uid;
}

async function capacitorSignIn() {
  const { Browser } = await import('@capacitor/browser');
  const { App: CapApp } = await import('@capacitor/app');

  // PKCE flow: generate code_verifier and code_challenge
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: IOS_CLIENT_ID,
    redirect_uri: IOS_REDIRECT_SCHEME + ':/oauth2callback',
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    nonce: nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });

  return new Promise((resolve, reject) => {
    // Listen for the URL scheme callback when Google redirects back to the app
    const urlListener = CapApp.addListener('appUrlOpen', async (event) => {
      const url = event.url;
      if (!url || !url.startsWith(IOS_REDIRECT_SCHEME)) return;

      urlListener.then(l => l.remove());
      await Browser.close();

      try {
        const urlObj = new URL(url.replace(IOS_REDIRECT_SCHEME + ':', 'https://dummy'));
        const code = urlObj.searchParams.get('code');
        if (!code) { reject(new Error('No auth code')); return; }

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: IOS_CLIENT_ID,
            code: code,
            code_verifier: codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: IOS_REDIRECT_SCHEME + ':/oauth2callback'
          })
        });

        const tokens = await tokenResponse.json();
        if (tokens.id_token) {
          localStorage.setItem('_pendingIdToken', tokens.id_token);
          if (tokens.access_token) {
            localStorage.setItem('_pendingAccessToken', tokens.access_token);
          }
          resolve();
          window.location.reload();
        } else {
          reject(new Error('No id_token in response'));
        }
      } catch (err) {
        reject(err);
      }
    });

    // Open Google sign-in in system browser
    Browser.open({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(),
      presentationStyle: 'popover'
    });
  });
}

export async function signIn() {
  if (isCapacitor) {
    try {
      await capacitorSignIn();
    } catch (err) {
      console.error('Sign-in error:', err);
    }
  } else if (isElectron) {
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

// On reload, sign in with pending Google token from OAuth callback (Capacitor)
const pendingIdToken = localStorage.getItem('_pendingIdToken');
if (pendingIdToken) {
  const pendingAccessToken = localStorage.getItem('_pendingAccessToken');
  localStorage.removeItem('_pendingIdToken');
  localStorage.removeItem('_pendingAccessToken');
  const credential = GoogleAuthProvider.credential(pendingIdToken, pendingAccessToken);
  signInWithCredential(auth, credential).catch(err => {
    console.error('Pending sign-in error:', err);
  });
}

// Listen for auth state changes (also fires on page load with persisted session)
onAuthStateChanged(auth, (user) => {
  authState.isLoggedIn = !!user;
  authState.user = user;
  authState.uid = user ? user.uid : null;
  listeners.forEach((cb) => cb(user));
});
