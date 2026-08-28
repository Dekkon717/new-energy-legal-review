import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { startProdServer } from 'vinext/server/prod-server';

let desktopServer;
let mainWindow;

async function createMainWindow() {
  if (mainWindow) return;

  const outDir = path.join(app.getAppPath(), 'dist');
  const serverResult = await startProdServer({
    port: 0,
    host: '127.0.0.1',
    outDir,
    silent: true,
  });
  desktopServer = serverResult.server;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#f4f7f4',
    title: '新能源合同审查助手',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${serverResult.port}/`);
  mainWindow.show();
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createMainWindow).catch((error) => {
  console.error('桌面程序启动失败', error);
  app.quit();
});

app.on('before-quit', () => {
  desktopServer?.close();
  desktopServer = undefined;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
