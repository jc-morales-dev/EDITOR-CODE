import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import chokidar from 'chokidar';
import { createRequire } from 'module';
import {
  isSafeFileName,
  normalizeGitPathspecs,
  resolveExistingInsideRoot,
  resolveMutableExistingInsideRoot,
  resolveNewInsideRoot,
  resolveTerminalCwd,
} from './pathGuard.js';
import { isAllowedNavigation } from './navigationGuard.js';

// CommonJS modules (electron, node-pty, simple-git)
const require = createRequire(import.meta.url);
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const pty = require('node-pty');
const simpleGit = require('simple-git');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

let mainWindow;
let watcher = null; // Variable para el vigilante de archivos
let terminalProcess = null; // Variable para el proceso de terminal

// Raíz del proyecto abierto. La fija el usuario al elegir carpeta en el diálogo
// nativo, y todas las operaciones de fichero se confinan dentro (pathGuard.js).
// Sin carpeta abierta no se toca el disco.
let projectRoot = null;

function resolveRequestedProjectPath(requestedPath) {
  const safeProject = resolveExistingInsideRoot(projectRoot, requestedPath || projectRoot);
  if (!fs.statSync(safeProject).isDirectory()) {
    throw new Error('La ruta del proyecto no es una carpeta.');
  }
  return safeProject;
}

// RUTA DE SETTINGS (lazy loading porque app.getPath no está disponible antes de app.ready)
let SETTINGS_PATH = null;
const getSettingsPath = () => {
  if (!SETTINGS_PATH) {
    SETTINGS_PATH = path.join(app.getPath('userData'), 'zenith-settings.json');
  }
  return SETTINGS_PATH;
};

function getSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Error settings:", e);
  }
  return { apiKey: "" };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: 30 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  const startUrl = process.env.ELECTRON_START_URL || pathToFileURL(path.join(__dirname, '../dist/index.html')).href;

  const blockUntrustedNavigation = (event, targetUrl) => {
    if (!isAllowedNavigation(startUrl, targetUrl)) {
      event.preventDefault();
      console.warn(`[navigation] Bloqueada navegación fuera de la aplicación: ${targetUrl}`);
    }
  };

  mainWindow.webContents.on('will-navigate', blockUntrustedNavigation);
  mainWindow.webContents.on('will-redirect', blockUntrustedNavigation);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadURL(startUrl);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

//
function startWatching(dirPath) {
  if (watcher) {
    watcher.close(); // Cerramos el anterior si existía
  }

  // Ignorar carpetas pesadas
  watcher = chokidar.watch(dirPath, {
    ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/dist/**', '**/.git/**'],
    ignoreInitial: true,
    persistent: true
  });

  // Cuando algo cambie, avisamos a la ventana (Frontend)
  watcher.on('all', (event, filePath) => {
    // Enviamos el evento 'file:changed' al frontend
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file:changed', { event, path: filePath });
    }
  });
}

//
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.DS_Store'];
const MAX_DEPTH = 10; // Profundidad máxima de carpetas
const MAX_FILES = 2000; // Límite de archivos a cargar

let fileCount = 0; // Contador global de archivos

async function readDirRecursive(dirPath, currentDepth = 0) {
  try {
    // Si alcanzamos la profundidad máxima, no seguimos
    if (currentDepth >= MAX_DEPTH) {
      console.warn(` Max depth reached at: ${dirPath}`);
      return [];
    }

    // Si alcanzamos el límite de archivos, detenemos
    if (fileCount >= MAX_FILES) {
      console.warn(` Max file count (${MAX_FILES}) reached. Stopping traversal.`);
      return [];
    }

    let results = [];
    const list = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const dirent of list) {
      const fullPath = path.join(dirPath, dirent.name);
      if (IGNORED_DIRS.includes(dirent.name)) continue;

      if (dirent.isDirectory()) {
        const children = await readDirRecursive(fullPath, currentDepth + 1);
        results.push({
          name: dirent.name,
          path: fullPath,
          type: 'folder',
          children: children
        });
      } else {
        // Incrementar contador de archivos
        fileCount++;

        results.push({
          name: dirent.name,
          path: fullPath,
          type: 'file',
          language: getLanguage(dirent.name)
        });

        // Si alcanzamos el límite, cortamos
        if (fileCount >= MAX_FILES) break;
      }
    }
    return results.sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1));
  } catch (e) {
    return [];
  }
}

//

ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    const safePath = resolveExistingInsideRoot(projectRoot, filePath);
    return await fs.promises.readFile(safePath, 'utf-8');
  } catch (e) { return ""; }
});

ipcMain.handle('dialog:openDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (canceled) return null;

  // El diálogo nativo es la única vía para fijar la raíz: la elige el usuario,
  // no el renderer.
  projectRoot = filePaths[0];

  // AL ABRIR CARPETA, INICIAMOS EL WATCHER
  startWatching(filePaths[0]);

  return filePaths[0];
});

ipcMain.handle('fs:readDir', async (event, dirPath) => {
  const startTime = Date.now();
  fileCount = 0; // Resetear contador antes de cada carga

  let safeDir;
  try {
    safeDir = resolveExistingInsideRoot(projectRoot, dirPath);
  } catch (e) {
    console.warn(`[fs:readDir] ${e.message}`);
    return [];
  }

  const result = await readDirRecursive(safeDir);

  const elapsed = Date.now() - startTime;

  if (fileCount >= MAX_FILES) {
    console.warn(` Project truncated: max ${MAX_FILES} files reached`);
  }

  return result;
});

ipcMain.handle('fs:createFile', async (event, { basePath, name, content }) => {
  try {
    // El nombre se valida aparte: sin esto, un "name" con ../ escaparía de
    // basePath aunque basePath sí estuviera dentro del proyecto.
    if (!isSafeFileName(name)) throw new Error(`Nombre de fichero no válido: ${name}`);
    const fullPath = resolveNewInsideRoot(projectRoot, basePath, name);
    await fs.promises.writeFile(fullPath, content || '', 'utf-8');
    return { success: true, file: { name, path: fullPath, type: 'file', language: getLanguage(name) } };
  } catch (e) {
    console.warn(`[fs:createFile] ${e.message}`);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:saveFile', async (event, { filePath, content }) => {
  try {
    const safePath = resolveMutableExistingInsideRoot(projectRoot, filePath);
    await fs.promises.writeFile(safePath, content, 'utf-8');
    return true;
  } catch (e) {
    console.warn(`[fs:saveFile] ${e.message}`);
    return false;
  }
});

ipcMain.handle('fs:renameFile', async (event, { oldPath, newName }) => {
  try {
    if (!isSafeFileName(newName)) throw new Error(`Nombre de fichero no válido: ${newName}`);
    const safeOld = resolveMutableExistingInsideRoot(projectRoot, oldPath);
    const newPath = resolveNewInsideRoot(projectRoot, path.dirname(safeOld), newName);
    await fs.promises.rename(safeOld, newPath);
    return { success: true, newPath };
  } catch (e) {
    console.warn(`[fs:renameFile] ${e.message}`);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:deleteFile', async (event, filePath) => {
  try {
    const safePath = resolveMutableExistingInsideRoot(projectRoot, filePath);
    // Borrar la raíz entera nunca es lo que el usuario quiso pedir desde la UI.
    if (fs.realpathSync(safePath) === fs.realpathSync(projectRoot)) {
      throw new Error('No se puede borrar la raíz del proyecto.');
    }
    const stat = await fs.promises.stat(safePath);
    if (stat.isDirectory()) await fs.promises.rm(safePath, { recursive: true, force: true });
    else await fs.promises.unlink(safePath);
    return true;
  } catch (e) {
    console.warn(`[fs:deleteFile] ${e.message}`);
    return false;
  }
});

ipcMain.handle('settings:get', async () => getSettings());
ipcMain.handle('settings:save', async (event, newSettings) => {
  const current = getSettings();
  await fs.promises.writeFile(getSettingsPath(), JSON.stringify({ ...current, ...newSettings }, null, 2), 'utf-8');
  return true;
});

//
const getShell = () => {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
};

ipcMain.handle('terminal:spawn', async (event, cwd) => {
  try {
    // Si ya hay un proceso, lo matamos primero
    if (terminalProcess) {
      terminalProcess.kill();
      terminalProcess = null;
    }

    const shell = getShell();
    const workingDir = resolveTerminalCwd(projectRoot, cwd);

    terminalProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: workingDir,
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    // Enviar datos del terminal al frontend
    terminalProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:data', data);
      }
    });

    // Manejar cierre del proceso
    terminalProcess.onExit(({ exitCode }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:exit', exitCode);
      }
      terminalProcess = null;
    });

    return { success: true, shell, cwd: workingDir };
  } catch (error) {
    console.error('Terminal spawn error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('terminal:write', async (event, data) => {
  if (terminalProcess) {
    terminalProcess.write(data);
    return true;
  }
  return false;
});

ipcMain.handle('terminal:resize', async (event, { cols, rows }) => {
  if (terminalProcess) {
    try {
      terminalProcess.resize(cols, rows);
      return true;
    } catch (e) {
      console.error('Terminal resize error:', e);
      return false;
    }
  }
  return false;
});

ipcMain.handle('terminal:kill', async () => {
  if (terminalProcess) {
    terminalProcess.kill();
    terminalProcess = null;
    return true;
  }
  return false;
});

//
const SEARCH_IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.DS_Store', '.next', '__pycache__'];
const SEARCH_MAX_RESULTS = 500;
const SEARCH_MAX_FILE_SIZE = 1024 * 1024; // 1MB max file size

async function searchInFile(filePath, query, options = {}) {
  const results = [];
  try {
    const stats = await fs.promises.stat(filePath);
    if (stats.size > SEARCH_MAX_FILE_SIZE) return results;

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const searchQuery = options.caseSensitive ? query : query.toLowerCase();
    const isRegex = options.regex;
    let pattern = null;

    if (isRegex) {
      try {
        pattern = new RegExp(query, options.caseSensitive ? 'g' : 'gi');
      } catch (e) {
        return results; // Invalid regex
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineToSearch = options.caseSensitive ? line : line.toLowerCase();

      let match = false;
      if (isRegex && pattern) {
        match = pattern.test(line);
        pattern.lastIndex = 0; // Reset regex state
      } else {
        match = lineToSearch.includes(searchQuery);
      }

      if (match) {
        results.push({
          file: filePath,
          line: i + 1,
          column: lineToSearch.indexOf(searchQuery) + 1,
          content: line.trim(),
          preview: line.substring(0, 200).trim()
        });
      }
    }
  } catch (e) {
    // Skip files that can't be read
  }
  return results;
}

async function searchRecursive(dirPath, query, options, results = []) {
  if (results.length >= SEARCH_MAX_RESULTS) return results;

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= SEARCH_MAX_RESULTS) break;
      if (SEARCH_IGNORED_DIRS.includes(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await searchRecursive(fullPath, query, options, results);
      } else if (entry.isFile()) {
        // Skip binary files by extension
        const ext = path.extname(entry.name).toLowerCase();
        const textExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.html', '.css', '.scss', '.less', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.xml', '.yaml', '.yml', '.toml', '.ini', '.env', '.sh', '.bash', '.zsh', '.fish', '.sql', '.graphql', '.vue', '.svelte'];

        if (textExtensions.includes(ext) || !ext) {
          const fileResults = await searchInFile(fullPath, query, options);
          results.push(...fileResults);
        }
      }
    }
  } catch (e) {
    // Skip directories that can't be read
  }

  return results;
}

ipcMain.handle('search:global', async (event, { query, projectPath, options = {} }) => {
  if (!query || !projectPath) {
    return { success: false, results: [], error: 'Query and projectPath required' };
  }

  try {
    const startTime = Date.now();
    const safeProjectPath = resolveRequestedProjectPath(projectPath);

    const results = await searchRecursive(safeProjectPath, query, options);

    const elapsed = Date.now() - startTime;

    return {
      success: true,
      results: results.slice(0, SEARCH_MAX_RESULTS),
      totalCount: results.length,
      truncated: results.length > SEARCH_MAX_RESULTS
    };
  } catch (error) {
    console.error('Search error:', error);
    return { success: false, results: [], error: error.message };
  }
});

//
ipcMain.handle('git:status', async (event, projectPath) => {
  try {
    const safeProjectPath = resolveRequestedProjectPath(projectPath);
    const git = simpleGit(safeProjectPath);

    // Check if this is a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { success: false, error: 'Not a git repository', isRepo: false };
    }

    const status = await git.status();
    const branch = await git.branchLocal();

    return {
      success: true,
      isRepo: true,
      branch: status.current,
      branches: branch.all,
      staged: status.staged,
      modified: status.modified,
      not_added: status.not_added,
      deleted: status.deleted,
      conflicted: status.conflicted,
      created: status.created,
      renamed: status.renamed,
      isClean: status.isClean(),
      ahead: status.ahead,
      behind: status.behind
    };
  } catch (error) {
    console.error('Git status error:', error);
    return { success: false, error: error.message, isRepo: false };
  }
});

ipcMain.handle('git:stage', async (event, { projectPath, files }) => {
  try {
    const safeProjectPath = resolveRequestedProjectPath(projectPath);
    const safeFiles = normalizeGitPathspecs(safeProjectPath, files);
    const git = simpleGit(safeProjectPath);
    await git.add(['--', ...safeFiles]);
    return { success: true };
  } catch (error) {
    console.error('Git stage error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git:unstage', async (event, { projectPath, files }) => {
  try {
    const safeProjectPath = resolveRequestedProjectPath(projectPath);
    const safeFiles = normalizeGitPathspecs(safeProjectPath, files);
    const git = simpleGit(safeProjectPath);
    await git.reset(['HEAD', '--', ...safeFiles]);
    return { success: true };
  } catch (error) {
    console.error('Git unstage error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git:commit', async (event, { projectPath, message }) => {
  try {
    const safeProjectPath = resolveRequestedProjectPath(projectPath);
    if (typeof message !== 'string' || message.trim() === '' || message.length > 5000) {
      throw new Error('Mensaje de commit no válido.');
    }
    const git = simpleGit(safeProjectPath);
    const result = await git.commit(message);
    return {
      success: true,
      commit: result.commit,
      summary: {
        changes: result.summary.changes,
        insertions: result.summary.insertions,
        deletions: result.summary.deletions
      }
    };
  } catch (error) {
    console.error('Git commit error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git:diff', async (event, { projectPath, file }) => {
  try {
    const safeProjectPath = resolveRequestedProjectPath(projectPath);
    const [safeFile] = normalizeGitPathspecs(safeProjectPath, [file]);
    const git = simpleGit(safeProjectPath);
    const diff = await git.diff(['--', safeFile]);
    return { success: true, diff };
  } catch (error) {
    console.error('Git diff error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git:log', async (event, { projectPath, maxCount = 20 }) => {
  try {
    const safeProjectPath = resolveRequestedProjectPath(projectPath);
    const safeMaxCount = Math.min(100, Math.max(1, Number.parseInt(maxCount, 10) || 20));
    const git = simpleGit(safeProjectPath);
    const log = await git.log({ maxCount: safeMaxCount });
    return {
      success: true,
      commits: log.all.map(c => ({
        hash: c.hash,
        hashShort: c.hash.substring(0, 7),
        message: c.message,
        author: c.author_name,
        date: c.date
      }))
    };
  } catch (error) {
    console.error('Git log error:', error);
    return { success: false, error: error.message };
  }
});

//
ipcMain.handle('ai:complete', async (event, { prefix, suffix, language, filepath }) => {
  try {
    const settings = getSettings();
    if (!settings.apiKey) {
      return { success: false, suggestions: [], error: 'No API key' };
    }

    const genAI = new GoogleGenerativeAI(settings.apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        maxOutputTokens: 150,
        temperature: 0.2,
        stopSequences: ['\n\n', '```']
      }
    });

    const prompt = `You are a code autocomplete engine. Complete the code naturally.
Language: ${language}
File: ${filepath}

RULES:
- Output ONLY the code completion, nothing else
- No explanations, no markdown, no backticks
- Keep it short (1-3 lines max)
- Follow the existing code style
- If nothing logical to add, output nothing

Code context (cursor at |):
${prefix}|${suffix}

Complete:`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Filter out any markdown or explanations
    if (text.startsWith('```') || text.includes('Here') || text.includes('This')) {
      return { success: true, suggestions: [] };
    }

    return {
      success: true,
      suggestions: text ? [text] : []
    };
  } catch (error) {
    console.error('AI complete error:', error);
    return { success: false, suggestions: [], error: error.message };
  }
});

//
ipcMain.handle('ai:chat', async (event, { message, codeContext, projectStructure, chatHistory }) => {
  try {
    const settings = getSettings();
    if (!settings.apiKey) return "Error: configura tu API key";

    const genAI = new GoogleGenerativeAI(settings.apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.3, // Lower for more precise, less creative but accurate code
        topP: 0.9,
        topK: 30,
        maxOutputTokens: 16384, // Larger for complete projects
      },
    });

    const structureStr = JSON.stringify(projectStructure, (k, v) => k === 'content' ? undefined : v, 2);

    let history = '';
    if (chatHistory?.length > 0) {
      chatHistory.slice(-10).forEach(m => {
        history += `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}\n`;
      });
    }

    const prompt = `Eres un programador. Responde directo.

Archivos:
${structureStr}

Codigo actual:
${codeContext || '(ninguno)'}

${history ? 'Chat previo:\n' + history : ''}

Usuario: ${message}

Para crear archivos usa JSON:
\`\`\`json
{"action":"create_file","files":[{"path":"ruta/archivo.js","content":"codigo aqui"}]}
\`\`\``;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (e) {
    return "Error: " + e.message;
  }
});


function getLanguage(name) {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
  if (name.endsWith('.js') || name.endsWith('.jsx')) return 'javascript';
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.css')) return 'css';
  return 'plaintext';
}
