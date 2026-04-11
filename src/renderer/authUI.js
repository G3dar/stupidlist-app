import { signIn, signOut, onAuthChange } from './auth.js';
import { checkAndMigrate, uploadLocalData } from './migration.js';
import { syncWithCloud, cleanupEmptyLists, recordLogin } from './storage.js';
import { clearAll } from './storage-local.js';

let authArea = null;
let onReload = null;

export function init(reloadCallback) {
  authArea = document.getElementById('auth-area');
  onReload = reloadCallback;
  if (!authArea) return;

  onAuthChange(async (user) => {
    render(user);
    if (user) {
      recordLogin(user).catch(() => {});
      // Migration dialog is user-facing — no timeout
      try {
        await handleMigration(user.uid);
      } catch (err) {
        console.warn('Migration check failed:', err.message);
      }
      // Cloud pull can timeout — it's a network operation
      try {
        await Promise.race([
          syncWithCloud(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud sync timeout')), 15000))
        ]);
      } catch (err) {
        console.warn('Cloud sync skipped:', err.message);
      }
    }
    cleanupEmptyLists().catch(() => {});
    if (onReload) onReload();
  });

  // Sync with cloud when app returns to foreground
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try {
        await syncWithCloud();
      } catch {}
      if (onReload) onReload();
    }
  });

  // Sync when network reconnects (covers mobile offline→online)
  window.addEventListener('online', async () => {
    try {
      await syncWithCloud();
    } catch {}
    if (onReload) onReload();
  });

  // Render initial state (logged out)
  render(null);
}

function render(user) {
  if (!authArea) return;

  if (!user) {
    authArea.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'auth-btn';
    btn.textContent = 'sign in';
    btn.addEventListener('click', () => showSignInOptions());
    authArea.appendChild(btn);
    return;
  }

  authArea.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'auth-user';

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'auth-avatar';
  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.referrerPolicy = 'no-referrer';
    avatar.appendChild(img);
  } else {
    avatar.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
  }

  // Dropdown toggle
  avatar.addEventListener('click', () => {
    const existing = authArea.querySelector('.auth-dropdown');
    if (existing) {
      existing.remove();
      return;
    }
    showDropdown(user);
  });

  container.appendChild(avatar);
  authArea.appendChild(container);
}

function showDropdown(user) {
  const dropdown = document.createElement('div');
  dropdown.className = 'auth-dropdown';

  const email = document.createElement('div');
  email.className = 'auth-dropdown-email';
  email.textContent = user.email;
  dropdown.appendChild(email);

  const privacyBtn = document.createElement('button');
  privacyBtn.className = 'auth-dropdown-item';
  privacyBtn.textContent = 'Privacy Policy';
  privacyBtn.addEventListener('click', () => {
    dropdown.remove();
    showPrivacyPolicy();
  });
  dropdown.appendChild(privacyBtn);

  const signOutBtn = document.createElement('button');
  signOutBtn.className = 'auth-dropdown-item';
  signOutBtn.textContent = 'Sign out';
  signOutBtn.addEventListener('click', async () => {
    dropdown.remove();
    await signOut();
  });
  dropdown.appendChild(signOutBtn);

  authArea.appendChild(dropdown);

  // Close on click outside
  const close = (e) => {
    if (!dropdown.contains(e.target) && !authArea.querySelector('.auth-avatar')?.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

async function handleMigration(uid) {
  // Don't prompt again if already handled
  const migrationKey = `migration_done_${uid}`;
  if (localStorage.getItem(migrationKey)) return;

  try {
    const result = await checkAndMigrate(uid);
    if (!result.needsMigration) {
      localStorage.setItem(migrationKey, '1');
      return;
    }

    const count = result.localData.items.length;
    const projects = result.localData.projects.length;

    return new Promise((resolve) => {
      showMigrationDialog(count, projects, async (merge) => {
        if (merge) {
          await uploadLocalData(uid, result.localData);
        }
        // Clear local IndexedDB so orphaned items don't linger.
        // syncWithCloud() will repopulate from the cloud source of truth.
        await clearAll();
        localStorage.setItem(migrationKey, '1');
        resolve();
      });
    });
  } catch (err) {
    console.error('Migration check failed:', err);
  }
}

function showMigrationDialog(itemCount, projectCount, callback) {
  const overlay = document.createElement('div');
  overlay.className = 'migration-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'migration-dialog';

  const title = document.createElement('h3');
  title.textContent = 'Merge local data?';
  dialog.appendChild(title);

  const desc = document.createElement('p');
  desc.textContent = `You have ${itemCount} items and ${projectCount} projects stored locally. Merge them into your account?`;
  dialog.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'migration-actions';

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'migration-btn migration-btn--primary';
  uploadBtn.textContent = 'Merge';
  uploadBtn.addEventListener('click', () => {
    overlay.remove();
    callback(true);
  });

  const skipBtn = document.createElement('button');
  skipBtn.className = 'migration-btn';
  skipBtn.textContent = 'Start fresh';
  skipBtn.addEventListener('click', () => {
    overlay.remove();
    callback(false);
  });

  actions.appendChild(uploadBtn);
  actions.appendChild(skipBtn);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function showPrivacyPolicy() {
  const overlay = document.createElement('div');
  overlay.className = 'privacy-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const dialog = document.createElement('div');
  dialog.className = 'privacy-dialog';

  dialog.innerHTML = `
    <h2>Privacy Policy</h2>

    <h3>Your data is yours. Period.</h3>
    <p>All your content is protected with <strong>end-to-end encryption</strong>. Your lists, your tasks, your notes — everything is encrypted before it ever leaves your device. Nobody can read your data. Not us, not anyone. We literally cannot access your content even if we wanted to.</p>

    <p>We do not sell, share, or monetize your data in any way. There is no tracking, no analytics profiling, and no third-party data sharing. Your lists are none of our business.</p>

    <h3>Free forever</h3>
    <p>stupidlist is free and will always be free. No premium tiers, no surprise paywalls, no "free trial" nonsense. This is a tool built to be useful, and that's it.</p>

    <h3>Got an idea?</h3>
    <p>If you have a great idea to make stupidlist better, or if something is broken, or if you just want to say hi — write to <a href="mailto:stupid@stupidlist.app">stupid@stupidlist.app</a>. Feedback is always welcome. Always.</p>

    <button class="privacy-close">Close</button>
  `;

  dialog.querySelector('.privacy-close').addEventListener('click', () => overlay.remove());

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function showSignInOptions() {
  const overlay = document.createElement('div');
  overlay.className = 'privacy-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const dialog = document.createElement('div');
  dialog.className = 'privacy-dialog signin-dialog';
  dialog.innerHTML = `
    <h2>Sign in</h2>
    <p>Sign in to sync your tasks across devices.</p>
    <button class="signin-option signin-google">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      Continue with Google
    </button>
    <button class="signin-option signin-apple">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C4.24 16.7 4.89 10.33 8.7 10.1c1.3.07 2.2.75 2.95.8.94-.19 1.82-.9 2.83-.81 1.2.1 2.1.58 2.7 1.49-2.48 1.49-1.88 4.77.59 5.69-.46 1.16-.66 1.67-1.72 3.01zM12.03 10.05c-.14-2.34 1.81-4.29 3.97-4.45.29 2.62-2.34 4.6-3.97 4.45z"/></svg>
      Continue with Apple
    </button>
    <button class="privacy-close">Cancel</button>
  `;

  dialog.querySelector('.signin-google').addEventListener('click', () => {
    overlay.remove();
    signIn('google');
  });
  dialog.querySelector('.signin-apple').addEventListener('click', async () => {
    const btn = dialog.querySelector('.signin-apple');
    btn.disabled = true;
    btn.innerHTML = 'Signing in...';
    try {
      await signIn('apple');
      overlay.remove();
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C4.24 16.7 4.89 10.33 8.7 10.1c1.3.07 2.2.75 2.95.8.94-.19 1.82-.9 2.83-.81 1.2.1 2.1.58 2.7 1.49-2.48 1.49-1.88 4.77.59 5.69-.46 1.16-.66 1.67-1.72 3.01zM12.03 10.05c-.14-2.34 1.81-4.29 3.97-4.45.29 2.62-2.34 4.6-3.97 4.45z"/></svg> Continue with Apple`;
      let errEl = dialog.querySelector('.signin-error');
      if (!errEl) {
        errEl = document.createElement('p');
        errEl.className = 'signin-error';
        dialog.querySelector('.privacy-close').before(errEl);
      }
      errEl.textContent = 'Sign in failed. Please try again.';
    }
  });
  dialog.querySelector('.privacy-close').addEventListener('click', () => overlay.remove());

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}
