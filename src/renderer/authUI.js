import { signIn, signOut, onAuthChange } from './auth.js';
import { checkAndMigrate, uploadLocalData } from './migration.js';

let authArea = null;
let onReload = null;

export function init(reloadCallback) {
  authArea = document.getElementById('auth-area');
  onReload = reloadCallback;
  if (!authArea) return;

  onAuthChange(async (user) => {
    render(user);
    if (user) {
      await handleMigration(user.uid);
    }
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
  // Don't prompt again if already handled this session
  const migrationKey = `migration_done_${uid}`;
  if (sessionStorage.getItem(migrationKey)) return;

  try {
    const result = await checkAndMigrate(uid);
    if (!result.needsMigration) {
      sessionStorage.setItem(migrationKey, '1');
      return;
    }

    const count = result.localData.items.length;
    const projects = result.localData.projects.length;

    return new Promise((resolve) => {
      showMigrationDialog(count, projects, async (merge) => {
        if (merge) {
          await uploadLocalData(uid, result.localData);
        }
        sessionStorage.setItem(migrationKey, '1');
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
