const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const devUrl = 'http://localhost:5175';

  const pollServer = () => {
    http.get(devUrl, (res) => {
      win.loadURL(devUrl);
    }).on('error', (e) => {
      setTimeout(pollServer, 1000);
    });
  };

  pollServer();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
