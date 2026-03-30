import { signIn, signOut, onAuthChange } from './auth.js';
import { checkAndMigrate, uploadLocalData } from './migration.js';
import { pullFromCloud, recordLogin } from './storage.js';
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
          pullFromCloud(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cloud sync timeout')), 15000))
        ]);
      } catch (err) {
        console.warn('Cloud sync skipped:', err.message);
      }
    }
    if (onReload) onReload();
  });

  // Re-pull from cloud when app returns to foreground
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try {
        await pullFromCloud();
      } catch {}
      if (onReload) onReload();
    }
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
    btn.addEventListener('click', signIn);
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
        // pullFromCloud() will repopulate from the cloud source of truth.
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
