const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 720,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const devUrl = 'http://localhost:5174';

  win.loadFile(path.join(__dirname, 'index.html'));

  const pollServer = () => {
    http.get(devUrl, (res) => {
      console.log('Kino Dev server ready, loading URL...');
      win.loadURL(devUrl);
    }).on('error', (e) => {
      console.log('Kino: Waiting for dev server...');
      setTimeout(pollServer, 1000);
    });
  };

  pollServer();

  // Open DevTools for debugging blank screens
  win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
