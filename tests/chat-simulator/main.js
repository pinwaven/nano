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

  const devUrl = 'http://localhost:5173';

  win.loadFile(path.join(__dirname, 'index.html'));

  // Function to poll the dev server until it's ready
  const pollServer = () => {
    http.get(devUrl, (res) => {
      console.log('Dev server ready, loading URL...');
      win.loadURL(devUrl);
    }).on('error', (e) => {
      console.log('Waiting for dev server...');
      setTimeout(pollServer, 1000);
    });
  };

  pollServer();

  // Open DevTools automatically for debugging blank screens
  win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
