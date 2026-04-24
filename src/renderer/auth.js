import { auth } from '../shared/firebase-config.js';
import { GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, signInAnonymously as firebaseSignInAnon, onAuthStateChanged } from 'firebase/auth';
import { isElectron, isCapacitor } from '../shared/platform.js';

// Native token persistence for iOS (WKWebView can lose IndexedDB/localStorage)
let Preferences = null;
if (isCapacitor) {
  import('@capacitor/preferences').then(m => { Preferences = m.Preferences; }).catch(() => {});
}

async function saveGoogleRefreshToken(googleRefreshToken) {
  if (!Preferences || !googleRefreshToken) return;
  try {
    await Preferences.set({ key: 'google_refresh_token', value: googleRefreshToken });
  } catch {}
}

async function saveProviderInfo(providerId) {
  if (!Preferences) return;
  try {
    await Preferences.set({ key: 'auth_provider', value: providerId });
  } catch {}
}

async function clearNativeAuth() {
  if (!Preferences) return;
  try {
    await Preferences.remove({ key: 'google_refresh_token' });
    await Preferences.remove({ key: 'auth_provider' });
  } catch {}
}

async function restoreSession() {
  if (!Preferences) return false;
  try {
    const { value: googleRefreshToken } = await Preferences.get({ key: 'google_refresh_token' });
    if (!googleRefreshToken) return false;

    // Exchange Google refresh token for fresh Google tokens
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: IOS_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: googleRefreshToken
      })
    });
    const tokens = await response.json();
    if (!tokens.id_token) {
      await clearNativeAuth();
      return false;
    }

    const credential = GoogleAuthProvider.credential(tokens.id_token, tokens.access_token);
    await signInWithCredential(auth, credential);
    return true;
  } catch (err) {
    console.warn('Session restore failed:', err.message);
    await clearNativeAuth();
    return false;
  }
}

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
    access_type: 'offline',
    state: state,
    nonce: nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent'
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
          // Store Google refresh token in native storage for session persistence
          if (tokens.refresh_token) {
            await saveGoogleRefreshToken(tokens.refresh_token);
            await saveProviderInfo('google.com');
          }
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

export async function signIn(method = 'google') {
  if (method === 'apple') {
    return signInWithApple();
  }

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

async function signInWithApple() {
  if (isCapacitor) {
    try {
      const { Capacitor } = await import('@capacitor/core');
      const AppleSignIn = Capacitor.Plugins.AppleSignIn;
      if (!AppleSignIn) {
        throw new Error('Apple Sign In plugin not available');
      }
      const result = await AppleSignIn.authorize();
      const provider = new OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken: result.identityToken,
        rawNonce: result.nonce
      });
      await signInWithCredential(auth, credential);
      await saveProviderInfo('apple.com');
    } catch (err) {
      if (String(err).includes('canceled') || String(err).includes('ERR_CANCELED')) {
        return;
      }
      console.error('Apple sign-in error:', err);
      throw err;
    }
  } else {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        return;
      }
      if (err.code === 'auth/popup-blocked') {
        await signInWithRedirect(auth, provider);
        return;
      }
      console.error('Apple sign-in error:', err);
      throw err;
    }
  }
}

export async function signOut() {
  await clearNativeAuth();
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

// Handle redirect result from Apple Sign-In (or any OAuth redirect)
getRedirectResult(auth).catch(err => {
  if (err.code !== 'auth/popup-closed-by-user') {
    console.error('Redirect sign-in error:', err);
  }
});

// Listen for auth state changes (also fires on page load with persisted session)
let sessionRestoreAttempted = false;
onAuthStateChanged(auth, async (user) => {
  if (user) {
    sessionRestoreAttempted = false;
  } else if (isCapacitor && !sessionRestoreAttempted) {
    // No user on Capacitor — WKWebView may have lost session data.
    // Try restoring from native storage (Google refresh token in UserDefaults).
    sessionRestoreAttempted = true;
    const restored = await restoreSession();
    if (restored) return; // onAuthStateChanged will fire again with the user
  }

  authState.isLoggedIn = !!user;
  authState.user = user;
  authState.uid = user ? user.uid : null;
  listeners.forEach((cb) => cb(user));
});
