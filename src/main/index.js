const { app, BrowserWindow, ipcMain, Menu, clipboard } = require('electron');
const path = require('path');
const { version } = require('../../package.json');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 900,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, '..', '..', 'icons', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '..', '..', 'dist', 'preload.js')
    }
  });

  // Hide the menu bar
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAutoHideMenuBar(true);

  mainWindow.setTitle(`stupidlist v${version}`);
  mainWindow.loadFile('index.html');

  // Block popups — Google Auth is handled via IPC instead
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // Ctrl+mouse wheel zoom
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1);
  });

  // Disable native context menu — handled entirely in the renderer
  mainWindow.webContents.on('context-menu', (e) => {
    // Do nothing — let the renderer's contextmenu event handle it
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Google OAuth via BrowserWindow
ipcMain.handle('google-sign-in', async () => {
  const authWindow = new BrowserWindow({
    width: 500,
    height: 700,
    parent: mainWindow,
    modal: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const clientId = '734939820769-c5sbso4le8e5ok5ilq1q99tngku97uus.apps.googleusercontent.com';
  const redirectUri = 'https://stupidlist-app.firebaseapp.com/__/auth/handler';
  const scope = 'openid email profile';

  // Build Google OAuth URL
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token id_token` +
    `&scope=${encodeURIComponent(scope)}` +
    `&nonce=${Date.now()}`;

  authWindow.loadURL(authUrl);

  return new Promise((resolve) => {
    // Watch for redirects to capture the token
    authWindow.webContents.on('will-redirect', (event, url) => {
      handleAuthRedirect(url, authWindow, resolve);
    });

    authWindow.webContents.on('will-navigate', (event, url) => {
      handleAuthRedirect(url, authWindow, resolve);
    });

    authWindow.on('closed', () => {
      resolve(null);
    });
  });
});

function handleAuthRedirect(url, authWindow, resolve) {
  if (url.includes('id_token=') || url.includes('#')) {
    const hash = url.split('#')[1];
    if (hash) {
      const params = new URLSearchParams(hash);
      const idToken = params.get('id_token');
      if (idToken) {
        authWindow.close();
        resolve({ idToken });
        return;
      }
    }
  }
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('before-quit', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('flush-saves');
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

ipcMain.handle('get-data-path', () => {
  return app.getPath('userData');
});
