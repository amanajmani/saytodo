const { app, BrowserWindow, Tray, Menu, ipcMain, systemPreferences, screen, nativeImage, globalShortcut, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Store = require('electron-store');

// Load .env file — try multiple paths for dev vs packaged
function loadEnv() {
  const candidates = [
    path.join(__dirname, '.env'),
    app.isPackaged ? path.join(process.resourcesPath, '.env') : null,
    app.isPackaged ? path.join(process.resourcesPath, '..', '.env') : null,
  ].filter(Boolean);
  for (const envPath of candidates) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      for (const line of envContent.split('\n')) {
        const match = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
      }
      return; // Found and loaded
    } catch {}
  }
}
loadEnv();

const logFile = '/tmp/saytodo-debug.log';
function log(...args) {
  const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  try { fs.appendFileSync(logFile, msg); } catch {}
  console.log(...args);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

const store = new Store({ name: 'saytodo-tasks' });

let tray = null;
let mainWindow = null;
let overlayWindow = null;
let isListening = false;
let speechProcess = null;
let lastTranscript = '';
let uIOhook = null;
let ttsProcess = null;

function getAssetPath(filename) {
  if (app.isPackaged) return path.join(process.resourcesPath, 'assets', filename);
  return path.join(__dirname, 'assets', filename);
}

function createTrayIcon() {
  try {
    const icon = nativeImage.createFromPath(getAssetPath('icon.png')).resize({ width: 18, height: 18 });
    icon.setTemplateImage(true);
    return icon;
  } catch { return nativeImage.createEmpty(); }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 460, height: 680, minWidth: 380, minHeight: 400,
    show: false, frame: false, titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    vibrancy: 'under-window', visualEffectState: 'active',
    backgroundColor: '#1a1a2e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('blur', () => {
    if (!isListening) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused() && !isListening) mainWindow.hide();
      }, 200);
    }
  });
}

function createOverlayWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  overlayWindow = new BrowserWindow({
    width: 280, height: 52, x: Math.round((width - 280) / 2), y: 8,
    show: false, frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, movable: false, focusable: false, hasShadow: true,
    webPreferences: { contextIsolation: true },
  });
  try { overlayWindow.setIgnoresMouseEvents(true); } catch {}
  try { overlayWindow.setVisibleOnAllWorkspaces(true); } catch {}
  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:transparent;display:flex;justify-content:center;align-items:center;height:100vh}
    .pill{background:rgba(20,20,40,0.92);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(139,92,246,0.4);border-radius:26px;padding:10px 22px;display:flex;align-items:center;gap:10px;font-size:14px;color:#e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.4)}
    .dot{width:10px;height:10px;background:#ef4444;border-radius:50%;animation:pulse 1s ease-in-out infinite}.dot.processing{background:#f59e0b;animation:spin .8s linear infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    </style></head><body><div class="pill"><div class="dot" id="dot"></div><span id="text">Listening...</span></div>
    <script>window.updateOverlay=(msg,p)=>{document.getElementById('text').textContent=msg;document.getElementById('dot').className=p?'dot processing':'dot'}</script></body></html>`)}`);
}

function showOverlay(text, processing = false) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.executeJavaScript(`window.updateOverlay(${JSON.stringify(text)},${processing})`).catch(() => {});
  overlayWindow.showInactive();
}
function hideOverlay() { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide(); }

function toggleMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) { mainWindow.hide(); return; }
  const tb = tray.getBounds(), wb = mainWindow.getBounds();
  mainWindow.setPosition(Math.round(tb.x + tb.width / 2 - wb.width / 2), tb.y + tb.height + 4);
  mainWindow.show(); mainWindow.focus();
}

// --- Text-to-Speech using macOS `say` ---
function speak(text) {
  if (ttsProcess) { try { ttsProcess.kill(); } catch {} ttsProcess = null; }
  if (!text) return;
  ttsProcess = spawn('say', ['-r', '180', text]);
  ttsProcess.on('close', () => { ttsProcess = null; });
  ttsProcess.on('error', () => { ttsProcess = null; });
}
function stopSpeaking() {
  if (ttsProcess) { try { ttsProcess.kill(); } catch {} ttsProcess = null; }
}

// --- Speech Recognition ---
function startSpeechRecognition() {
  if (speechProcess) return;
  lastTranscript = '';
  speechProcess = spawn(getAssetPath('speech-helper'), [], { stdio: ['pipe', 'pipe', 'pipe'] });
  speechProcess.stdout.on('data', (data) => {
    for (const line of data.toString().trim().split('\n')) {
      try { const r = JSON.parse(line); lastTranscript = r.text; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('speech-result', r); } catch {}
    }
  });
  speechProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim(); log('[speech-helper]', msg);
    if (msg.startsWith('ERROR:') && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('speech-error', msg);
  });
  speechProcess.on('close', () => { speechProcess = null; });
  speechProcess.on('error', (err) => { log('[speech-helper] spawn error:', err.message); speechProcess = null; });
}
function stopSpeechRecognition() {
  if (speechProcess) { speechProcess.kill('SIGTERM'); speechProcess = null; }
  const t = lastTranscript; lastTranscript = ''; return t;
}

function startListeningMode() {
  if (isListening) return; isListening = true;
  stopSpeaking(); // Stop any TTS if user starts talking
  showOverlay('Listening...'); startSpeechRecognition();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('listening-state', 'start');
}
function stopListeningMode() {
  if (!isListening) return; isListening = false;
  showOverlay('Processing...', true);
  // Wait 800ms for the speech recognizer to flush its final audio buffer
  setTimeout(() => {
    const transcript = stopSpeechRecognition();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('listening-state', 'stop');
      if (transcript) mainWindow.webContents.send('final-transcript', transcript);
    }
    setTimeout(() => hideOverlay(), 1200);
  }, 800);
}

function setupGlobalKeyListener() {
  try {
    const { uIOhook: hook, UiohookKey } = require('uiohook-napi');
    uIOhook = hook;
    const SHIFT_KEYS = [UiohookKey.Shift, UiohookKey.ShiftRight];
    uIOhook.on('keydown', (e) => { if (SHIFT_KEYS.includes(e.keycode)) startListeningMode(); });
    uIOhook.on('keyup', (e) => { if (SHIFT_KEYS.includes(e.keycode)) stopListeningMode(); });
    uIOhook.start();
    log('[main] uiohook started');
    setTimeout(() => setupFallbackShortcut(), 500);
  } catch (err) {
    log('[main] uiohook failed:', err.message);
    setupFallbackShortcut();
  }
}
function setupFallbackShortcut() {
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!isListening) startListeningMode(); else stopListeningMode();
  });
}

// ============================================================
// MENUBAR QUICK GLANCE — dynamic tray menu with top tasks
// ============================================================

function updateTrayMenu() {
  if (!tray) return;
  const tasks = store.get('tasks', []);
  const todayStr = new Date().toISOString().split('T')[0];

  // Get today's tasks first, then overdue, then upcoming — max 5
  const pending = tasks.filter(t => !t.done);
  const todayTasks = pending.filter(t => t.dueDate === todayStr);
  const overdue = pending.filter(t => t.dueDate && t.dueDate < todayStr);
  const upcoming = pending.filter(t => !t.dueDate || t.dueDate > todayStr);
  const glanceTasks = [...overdue, ...todayTasks, ...upcoming].slice(0, 5);

  const priorityDots = { high: '🔴', med: '🟡', low: '🟢' };
  const taskItems = glanceTasks.map(t => {
    const dot = priorityDots[t.priority] || '🟢';
    const dueLabel = t.dueDate === todayStr ? ' (today)' : t.dueDate && t.dueDate < todayStr ? ' (overdue!)' : '';
    return {
      label: `${dot} ${t.text}${dueLabel}`,
      enabled: true,
      click: () => {
        // Toggle done
        t.done = !t.done;
        store.set('tasks', tasks);
        updateTrayMenu();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('tasks-updated');
        }
      }
    };
  });

  const menuTemplate = [];

  if (taskItems.length > 0) {
    menuTemplate.push({ label: 'Today\'s Tasks', enabled: false });
    menuTemplate.push(...taskItems);
    menuTemplate.push({ type: 'separator' });
  }

  const pendingCount = pending.length;
  if (pendingCount > 0) {
    menuTemplate.push({ label: `${pendingCount} task${pendingCount === 1 ? '' : 's'} pending`, enabled: false });
  }

  menuTemplate.push({ label: 'Show SayTodo', click: () => toggleMainWindow() });
  menuTemplate.push({ type: 'separator' });
  menuTemplate.push({ label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } });

  const menu = Menu.buildFromTemplate(menuTemplate);
  tray.on('right-click', () => tray.popUpContextMenu(menu));
  // Update tooltip with count
  tray.setToolTip(pendingCount > 0 ? `SayTodo — ${pendingCount} pending` : 'SayTodo');
}

// ============================================================
// RECURRING TASKS — spawn due instances on app boot
// ============================================================

const WEEKDAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function spawnRecurringTasks() {
  const tasks = store.get('tasks', []);
  const todayStr = new Date().toISOString().split('T')[0];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayDay = today.getDay();
  let changed = false;

  // Track which recurring parents already have a pending instance for today
  const recurringParents = tasks.filter(t => t.recurrence);

  for (const parent of recurringParents) {
    const rec = parent.recurrence; // e.g. { type: 'weekly', days: [1, 3, 5] } or { type: 'daily' }

    let shouldSpawnToday = false;
    if (rec.type === 'daily') {
      shouldSpawnToday = true;
    } else if (rec.type === 'weekly' && Array.isArray(rec.days)) {
      shouldSpawnToday = rec.days.includes(todayDay);
    } else if (rec.type === 'monthly' && rec.dayOfMonth) {
      shouldSpawnToday = today.getDate() === rec.dayOfMonth;
    }

    if (!shouldSpawnToday) continue;

    // Check if we already spawned one for today
    const alreadySpawned = tasks.some(t =>
      t.recurringParentId === parent.id && t.dueDate === todayStr
    );
    if (alreadySpawned) continue;

    // Spawn a new instance
    tasks.unshift({
      text: parent.text,
      priority: parent.priority,
      dueDate: todayStr,
      category: parent.category || 'other',
      createdAt: new Date().toISOString(),
      done: false,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      recurringParentId: parent.id,
    });
    changed = true;
  }

  if (changed) {
    store.set('tasks', tasks);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tasks-updated');
    }
  }
}

// ============================================================
// GROQ AI ENGINE — one call does everything
// ============================================================

const GROQ_KEY = process.env.GROQ_API_KEY || '';
log('[main] Groq key loaded:', GROQ_KEY ? 'yes (' + GROQ_KEY.slice(0, 8) + '...)' : 'NO — AI features disabled');

function groqRequest(messages, maxTokens = 300) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    });
    const request = net.request({ method: 'POST', url: 'https://api.groq.com/openai/v1/chat/completions' });
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('Authorization', `Bearer ${GROQ_KEY}`);
    let data = '';
    request.on('response', (res) => {
      res.on('data', (c) => { data += c.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) { reject(new Error(json.error.message)); return; }
          const content = json.choices?.[0]?.message?.content?.trim();
          if (!content) { reject(new Error('Empty response')); return; }
          const cleaned = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
          resolve(JSON.parse(cleaned));
        } catch (err) { reject(err); }
      });
    });
    request.on('error', reject);
    const timer = setTimeout(() => { request.abort(); reject(new Error('timeout')); }, 8000);
    request.on('response', () => clearTimeout(timer));
    request.write(body);
    request.end();
  });
}

// --- Smart Parse: new task, voice command, recurring, notes, briefing — all in one call ---
ipcMain.handle('ai-parse', async (_e, rawText, existingTasks) => {
  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Build a slim task summary for command context (max 20 tasks to save tokens)
  const taskSummary = (existingTasks || []).slice(0, 20).map(t => {
    let s = `[${t.id}] "${t.text}" priority:${t.priority} done:${t.done}`;
    if (t.dueDate) s += ` due:${t.dueDate}`;
    if (t.category) s += ` cat:${t.category}`;
    if (t.notes && t.notes.length) s += ` notes:${t.notes.length}`;
    if (t.recurrence) s += ` recurring:${t.recurrence.type}`;
    return s;
  }).join('\n');

  try {
    const result = await groqRequest([
      {
        role: 'system',
        content: `You are SayTodo's AI brain. Today is ${todayStr}.

You receive raw voice/text input. The user may speak in English, Hindi, or Hinglish (mix of Hindi+English).
ALWAYS output the task text in clean English regardless of input language.
Examples:
- "mujhe khaana banake rakhna hai" → "Cook and store food"
- "kal grocery leni hai" → "Buy groceries"
- "dentist ka appointment book karna hai next week" → "Book dentist appointment"
- "umm i think i need to like buy some diet coke tomorrow" → "Buy diet coke"

Determine which type the input is and return ONLY valid JSON.

== TYPE 1: NEW TASK ==
{"type":"task","text":"Clean task description in English","priority":"high|med|low","dueDate":"YYYY-MM-DD or null","category":"work|personal|health|errands|finance|learning|social|other","recurrence":null}

Rules:
- "text": Clean, concise English description. Translate Hindi/Hinglish to English. Remove ALL filler words (um, uh, like, you know, basically, actually, I think, I need to, I don't know, I guess, maybe). Extract only the core action. Capitalize first letter.
- "priority": "high" only if user says high/urgent. "med" if medium/med. Otherwise "low".
- "dueDate": Resolve relative dates to YYYY-MM-DD. null if none.
- "category": Best-fit from list. Infer from context.
- "recurrence": null unless user says "every day/daily", "every monday", "every week", "every month", etc.
  - Daily: {"type":"daily"}
  - Weekly with days: {"type":"weekly","days":[1,3,5]} (0=Sun,1=Mon...6=Sat)
  - Monthly: {"type":"monthly","dayOfMonth":15}
  Examples: "gym every monday wednesday friday" → recurrence:{"type":"weekly","days":[1,3,5]}, dueDate=next occurrence
  "take vitamins every day" → recurrence:{"type":"daily"}, dueDate=today

== TYPE 2: COMMAND (action on existing tasks) ==
{"type":"command","action":"complete|delete|priority|reschedule|add-note|filter|briefing","taskId":"id or null","value":"depends on action","message":"Confirmation to show user"}

Commands:
- "mark X done"/"complete X" → action:"complete"
- "delete X"/"remove X" → action:"delete"
- "change X to high priority" → action:"priority", value:"high|med|low"
- "move X to friday" → action:"reschedule", value:"YYYY-MM-DD"
- "add note to X — bring insurance card" → action:"add-note", value:"the note text"
- "show high priority"/"what's due today" → action:"filter", value:"high|med|low|today|overdue|pending|done|all"
- "what's my day look like"/"briefing"/"daily summary"/"read my tasks" → action:"briefing" (user wants to hear their tasks read aloud)

Match commands to existing tasks by fuzzy-matching the task text. Use the task ID from the list.

== EXISTING TASKS ==
${taskSummary || '(none)'}

IMPORTANT: Return ONLY the JSON object, nothing else.`
      },
      { role: 'user', content: rawText }
    ]);

    log('[groq] Result:', JSON.stringify(result));

    if (result.type === 'task') {
      return {
        ok: true,
        type: 'task',
        task: {
          text: result.text || rawText.trim(),
          priority: ['high', 'med', 'low'].includes(result.priority) ? result.priority : 'low',
          dueDate: result.dueDate || null,
          category: result.category || 'other',
          recurrence: result.recurrence || null,
          notes: [],
          createdAt: new Date().toISOString(),
          done: false,
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        }
      };
    }

    if (result.type === 'command') {
      return { ok: true, type: 'command', command: result };
    }

    return { ok: false, error: 'Unknown response type' };
  } catch (err) {
    log('[groq] Failed:', err.message);
    return { ok: false, error: err.message };
  }
});

// --- Daily Briefing: one call per day, cached ---
ipcMain.handle('ai-briefing', async (_e, taskList) => {
  const todayKey = new Date().toISOString().split('T')[0];
  const cached = store.get('briefingCache', {});
  if (cached.date === todayKey && cached.text) return { ok: true, text: cached.text };

  const pending = (taskList || []).filter(t => !t.done);
  if (pending.length === 0) return { ok: true, text: "No pending tasks. Enjoy your free time!" };

  const summary = pending.slice(0, 25).map(t => {
    let s = `- "${t.text}" [${t.priority}]`;
    if (t.dueDate) s += ` due ${t.dueDate}`;
    if (t.category) s += ` (${t.category})`;
    return s;
  }).join('\n');

  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  try {
    const result = await groqRequest([
      {
        role: 'system',
        content: `You are a friendly productivity assistant. Today is ${todayStr}. Generate a brief, motivating daily briefing (2-3 short sentences max). Mention what's overdue or due today first, then a quick summary. Be warm but concise. No bullet points, no markdown. Plain text only. Return JSON: {"briefing":"your text here"}`
      },
      { role: 'user', content: `My tasks:\n${summary}` }
    ], 120);

    const text = result.briefing || result.text || '';
    if (text) store.set('briefingCache', { date: todayKey, text });
    return { ok: true, text };
  } catch (err) {
    log('[groq] Briefing failed:', err.message);
    const overdue = pending.filter(t => t.dueDate && t.dueDate < todayKey).length;
    const dueToday = pending.filter(t => t.dueDate === todayKey).length;
    let text = `You have ${pending.length} pending task${pending.length === 1 ? '' : 's'}.`;
    if (overdue > 0) text += ` ${overdue} overdue!`;
    if (dueToday > 0) text += ` ${dueToday} due today.`;
    return { ok: true, text };
  }
});

// --- TTS IPC ---
ipcMain.handle('speak', (_e, text) => { speak(text); return true; });
ipcMain.handle('stop-speaking', () => { stopSpeaking(); return true; });

// --- Standard IPC ---
ipcMain.handle('get-tasks', () => store.get('tasks', []));
ipcMain.handle('save-tasks', (_e, tasks) => {
  store.set('tasks', tasks);
  updateTrayMenu();
  return true;
});
ipcMain.handle('get-mic-permission', async () => {
  const s = systemPreferences.getMediaAccessStatus('microphone');
  if (s === 'not-determined') { const g = await systemPreferences.askForMediaAccess('microphone'); return g ? 'granted' : 'denied'; }
  return s;
});
ipcMain.handle('get-onboarding-done', () => store.get('onboardingDone', false));
ipcMain.handle('set-onboarding-done', () => { store.set('onboardingDone', true); return true; });
ipcMain.handle('open-system-prefs', async (_e, pane) => {
  const { shell } = require('electron');
  const panes = {
    microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    speechRecognition: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
    dictation: 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension',
  };
  if (panes[pane]) shell.openExternal(panes[pane]);
});
ipcMain.on('show-overlay', (_e, text) => showOverlay(text));
ipcMain.on('hide-overlay', () => hideOverlay());
ipcMain.on('toggle-window', () => toggleMainWindow());

// --- App Lifecycle ---
app.on('ready', () => {
  log('[main] App ready');
  try {
    tray = new Tray(createTrayIcon());
    tray.setToolTip('SayTodo');
    tray.on('click', () => toggleMainWindow());

    createMainWindow(); createOverlayWindow(); setupGlobalKeyListener();
    updateTrayMenu();

    // Spawn recurring tasks on boot
    spawnRecurringTasks();

    setTimeout(() => toggleMainWindow(), 500);
  } catch (err) { log('[main] FATAL:', err.message, err.stack); }
});
app.on('window-all-closed', (e) => { e?.preventDefault?.(); });
app.on('before-quit', () => {
  app.isQuitting = true; stopSpeechRecognition(); stopSpeaking();
  if (uIOhook) { try { uIOhook.stop(); } catch {} }
  globalShortcut.unregisterAll();
});
app.on('activate', () => { if (mainWindow && !mainWindow.isVisible()) toggleMainWindow(); });
app.dock?.hide();
