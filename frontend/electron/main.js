const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell } = require('electron');
const path = require('path');

const PROD_URL = 'https://www.dine-verse.com/.owner/login';
const DEV_URL  = 'http://localhost:5173/owner/login';
const IS_DEV   = !app.isPackaged;
const APP_URL  = IS_DEV ? DEV_URL : PROD_URL;

let mainWindow = null;
let tray       = null;

// ── Window ────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:          1280,
    height:         820,
    minWidth:       900,
    minHeight:      600,
    title:          'DineVerse — Owner Dashboard',
    icon:           path.join(__dirname, 'icon.png'),
    backgroundColor: '#f9fafb',
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      webSecurity:       true,
    },
    show: false,
  });

  mainWindow.loadURL(APP_URL);

  // Show once ready so there's no white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Minimise to tray instead of close
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── System Tray ───────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);

  const menu = Menu.buildFromTemplate([
    { label: 'Open DineVerse', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Orders',       click: () => navigate('/owner/orders') },
    { label: 'Kitchen',      click: () => navigate('/owner/kitchen') },
    { label: 'Messages',     click: () => navigate('/owner/messages') },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('DineVerse');
  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function navigate(route) {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.executeJavaScript(
    `window.__electronNavigate && window.__electronNavigate(${JSON.stringify(route)})`
  );
}

// ── IPC Handlers ─────────────────────────────────────────────
ipcMain.on('new-order-notification', (_, { title, body }) => {
  // Flash taskbar / dock icon
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
    setTimeout(() => mainWindow.flashFrame(false), 3000);
  }

  // OS notification
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'icon.png') }).show();
  }
});

ipcMain.handle('get-platform', () => process.platform);

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { app.isQuitting = true; });
