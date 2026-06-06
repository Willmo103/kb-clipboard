const { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

let mainWindow;
let tray = null;

// Resolve SQLite Database path: ~/.kb/kb.db
const dbPath = path.join(os.homedir(), '.kb', 'kb.db');

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS clipboard_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          content_hash TEXT UNIQUE,
          content_type TEXT DEFAULT 'text',
          file_path TEXT,
          file_size INTEGER,
          mime_type TEXT,
          thumbnail BLOB,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          is_favorite INTEGER DEFAULT 0,
          access_count INTEGER DEFAULT 0,
          backed_up INTEGER DEFAULT 0
        )
      `, (err) => {
        if (err) console.error('Error creating clipboard_history table:', err);
      });

      db.run("CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_history(timestamp DESC)");
      db.run("CREATE INDEX IF NOT EXISTS idx_hash ON clipboard_history(content_hash)");
      db.run("CREATE INDEX IF NOT EXISTS idx_favorite ON clipboard_history(is_favorite)");
      db.run("CREATE INDEX IF NOT EXISTS idx_type ON clipboard_history(content_type)");
      db.run("CREATE INDEX IF NOT EXISTS idx_backed_up ON clipboard_history(backed_up)");
    });
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    // Earth-toned initial background (cream/warm paper)
    backgroundColor: '#F4EFEA',
    title: 'kb-clipboard',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false // Start hidden, display on tray activation or ready
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist-frontend', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // Intercept minimize event to collapse to system tray (hide instead of standard minimize)
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  // Auto-hide when losing focus, matching the PyQt eventFilter Deactivate behavior
  mainWindow.on('blur', () => {
    if (!isDev && mainWindow.isVisible()) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function setupTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const trayIcon = fs.existsSync(iconPath) ? iconPath : path.join(__dirname, 'package.json');
  
  try {
    tray = new Tray(trayIcon);
    tray.setToolTip('kb-clipboard');
    
    tray.on('click', () => {
      toggleWindow();
    });
    
    updateTrayMenu();
    setInterval(updateTrayMenu, 3000); // Keep tray menu synchronized with DB changes
  } catch (e) {
    console.error('Failed to create tray icon:', e);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  
  db.all("SELECT id, content, content_type, file_path FROM clipboard_history ORDER BY timestamp DESC LIMIT 5", [], (err, rows) => {
    if (err) {
      console.error('Error fetching recent items for tray:', err);
      return;
    }
    
    const template = [
      { label: 'Show Clipboard History', click: showWindow },
      { type: 'separator' }
    ];
    
    if (rows && rows.length > 0) {
      rows.forEach((row) => {
        let label = '';
        if (row.content_type === 'file') {
          label = `📁 ${path.basename(row.file_path || 'File')}`;
        } else if (row.content_type === 'image') {
          label = '🖼️ Image';
        } else {
          label = row.content.substring(0, 40).replace(/\r?\n/g, ' ');
          if (row.content.length > 40) label += '...';
        }
        
        template.push({
          label: label,
          click: () => {
            // Copy item back to OS clipboard, bypassing daemon capture via clip_skip.txt
            const contentHash = crypto.createHash('sha256').update(row.content).digest('hex');
            const skipFilePath = path.join(os.homedir(), '.kb', 'clip_skip.txt');
            try {
              fs.writeFileSync(skipFilePath, contentHash, 'utf8');
            } catch (err) {
              console.error('Error writing clip_skip.txt:', err);
            }
            
            if (row.content_type === 'text') {
              clipboard.writeText(row.content);
            } else if (row.content_type === 'file' && row.file_path) {
              if (fs.existsSync(row.file_path)) {
                clipboard.write({ text: row.file_path, filenames: [row.file_path] });
              } else {
                clipboard.writeText(row.content);
              }
            } else if (row.content_type === 'image') {
              const imgBuffer = Buffer.from(row.content, 'base64');
              const img = nativeImage.createFromBuffer(imgBuffer);
              clipboard.writeImage(img);
            }
          }
        });
      });
    } else {
      template.push({ label: 'No clipboard history', enabled: false });
    }
    
    template.push({ type: 'separator' });
    template.push({ label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } });
    
    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
  });
}

// IPC Handlers
ipcMain.handle('get-clipboard-history', async (event, args) => {
  const { limit = 50, offset = 0, search = '', favoritesOnly = false, type = 'all' } = args || {};
  
  // Verify if clipboard_history table exists first
  const tables = await new Promise((resolve) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='clipboard_history'", (err, rows) => {
      if (err || !rows) resolve(false);
      else resolve(rows.length > 0);
    });
  });

  if (!tables) return [];

  let sql = "SELECT * FROM clipboard_history WHERE 1=1";
  const params = [];
  
  if (search) {
    sql += " AND (content LIKE ? OR file_path LIKE ?)";
    params.push(`%${search}%`, `%${search}%`);
  }
  if (favoritesOnly) {
    sql += " AND is_favorite = 1";
  }
  if (type !== 'all') {
    sql += " AND content_type = ?";
    params.push(type);
  }
  
  sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else {
        // Map rows and convert BLOB thumbnail to base64 if it exists
        const mapped = rows.map(row => {
          if (row.thumbnail) {
            row.thumbnail = row.thumbnail.toString('base64');
          }
          return row;
        });
        resolve(mapped);
      }
    });
  });
});

ipcMain.handle('toggle-favorite', async (event, id) => {
  return new Promise((resolve, reject) => {
    db.run("UPDATE clipboard_history SET is_favorite = CASE WHEN is_favorite = 0 THEN 1 ELSE 0 END WHERE id = ?", [id], function (err) {
      if (err) reject(err);
      else resolve({ status: 'success' });
    });
  });
});

ipcMain.handle('delete-item', async (event, id) => {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM clipboard_history WHERE id = ?", [id], function (err) {
      if (err) reject(err);
      else resolve({ status: 'success' });
    });
  });
});

ipcMain.handle('clear-history', async (event, keepFavorites) => {
  const sql = keepFavorites ? "DELETE FROM clipboard_history WHERE is_favorite = 0" : "DELETE FROM clipboard_history";
  return new Promise((resolve, reject) => {
    db.run(sql, [], function (err) {
      if (err) reject(err);
      else resolve({ status: 'success' });
    });
  });
});

ipcMain.handle('copy-to-clipboard', async (event, { content, type, filePath }) => {
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const skipFilePath = path.join(os.homedir(), '.kb', 'clip_skip.txt');
  
  try {
    fs.writeFileSync(skipFilePath, contentHash, 'utf8');
  } catch (err) {
    console.error('Error writing clip_skip.txt:', err);
  }

  if (type === 'text') {
    clipboard.writeText(content);
  } else if (type === 'file' && filePath) {
    if (fs.existsSync(filePath)) {
      clipboard.write({ text: filePath, filenames: [filePath] });
    } else {
      clipboard.writeText(content);
    }
  } else if (type === 'image') {
    const nativeImage = require('electron').nativeImage;
    const imgBuffer = Buffer.from(content, 'base64');
    const img = nativeImage.createFromBuffer(imgBuffer);
    clipboard.writeImage(img);
  }

  return { status: 'success' };
});

ipcMain.handle('open-item', async (event, { content, type, filePath }) => {
  if (type === 'file' && filePath) {
    if (fs.existsSync(filePath)) {
      shell.openPath(filePath);
    } else {
      throw new Error('File not found on disk.');
    }
  } else if (type === 'text' && (content.startsWith('http://') || content.startsWith('https://'))) {
    shell.openExternal(content);
  } else if (type === 'image') {
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `temp_${Date.now()}.png`);
    const imgBuffer = Buffer.from(content, 'base64');
    fs.writeFileSync(tempFilePath, imgBuffer);
    shell.openPath(tempFilePath);
  } else {
    throw new Error('This content type cannot be opened natively.');
  }
  return { status: 'success' };
});

ipcMain.handle('export-to-json', async (event, { favoritesOnly }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Clipboard History',
    defaultPath: path.join(os.homedir(), `clipboard_export_${Date.now()}.json`),
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });

  if (canceled || !filePath) {
    return { status: 'canceled' };
  }

  let sql = "SELECT * FROM clipboard_history";
  const params = [];
  if (favoritesOnly) {
    sql += " WHERE is_favorite = 1";
  }
  sql += " ORDER BY timestamp DESC";

  const items = await new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  const exportData = {
    export_info: {
      timestamp: new Date().toISOString(),
      total_items: items.length,
      favorites_only: favoritesOnly,
      version: "1.0"
    },
    items: items.map(item => ({
      id: item.id,
      content: item.content,
      content_type: item.content_type,
      file_path: item.file_path,
      file_size: item.file_size,
      mime_type: item.mime_type,
      thumbnail: item.thumbnail ? item.thumbnail.toString('base64') : null,
      timestamp: item.timestamp,
      is_favorite: Boolean(item.is_favorite),
      access_count: item.access_count
    }))
  };

  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf8');
  return { status: 'success', count: items.length, filePath };
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  setupTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db.close();
    app.quit();
  }
});
