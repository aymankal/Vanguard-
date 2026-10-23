const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

// Scout Desk for desktop: the live desk full screen in its own window, with sign-in kept between
// launches. Because it loads the live site, every Scout Desk update shows up on the next open.
// Pages on the desk and Supabase stay in the app; any other link opens in the normal browser.
const DESK_URL = 'https://aymankal.github.io/Vanguard-/scout-desk/';
const DESK_ORIGIN = 'https://aymankal.github.io';
const DESK_PATH = '/Vanguard-/scout-desk';
const SUPABASE_ORIGIN = 'https://awmeixsvltzdspwnamyf.supabase.co';
const OFFLINE_PAGE = path.join(__dirname, 'offline.html');

let win;

function isInApp(url) {
  try {
    const u = new URL(url);
    if (u.origin === SUPABASE_ORIGIN) return true;
    return u.origin === DESK_ORIGIN && (u.pathname === DESK_PATH || u.pathname.startsWith(`${DESK_PATH}/`));
  } catch {
    return false;
  }
}

function openOutside(url) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: 'Scout Desk',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0B1220',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  // Lets the page know it runs inside the app (it hides its own Install buttons).
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} ScoutDeskDesktop/${app.getVersion()}`);
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInApp(url)) win.loadURL(url);
    else openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isInApp(url) || url.startsWith('file://')) return;
    e.preventDefault();
    openOutside(url);
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    // -3 is a navigation the app itself aborted, not a network failure.
    if (isMainFrame && code !== -3 && isInApp(url)) win.loadFile(OFFLINE_PAGE);
  });

  win.loadURL(DESK_URL);
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => win?.loadURL(DESK_URL) },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Open Scout Desk in the browser', click: () => shell.openExternal(DESK_URL) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  // The desk needs no camera, microphone, location or notifications: refuse every permission
  // except copying to the clipboard.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write'));
  buildMenu();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());

module.exports = { isInApp };
