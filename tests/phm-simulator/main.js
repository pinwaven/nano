const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

function createWindow() {
  const win = new BrowserWindow({
    width: 375,
    height: 812,
    titleBarStyle: 'hiddenInset',
    resizable: true, // Keep resizable for testing but start at mobile size
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const devUrl = 'http://localhost:5175';

  win.loadFile(path.join(__dirname, 'index.html'));

  const pollServer = () => {
    http.get(devUrl, (res) => {
      console.log('PHM Dev server ready, loading URL...');
      win.loadURL(devUrl);
    }).on('error', (e) => {
      console.log('PHM: Waiting for dev server...');
      setTimeout(pollServer, 1000);
    });
  };

  pollServer();

  // Open DevTools for debugging
  win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
