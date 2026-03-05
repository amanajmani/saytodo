const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saytodo', {
  // Task persistence
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  saveTasks: (tasks) => ipcRenderer.invoke('save-tasks', tasks),

  // Onboarding
  getOnboardingDone: () => ipcRenderer.invoke('get-onboarding-done'),
  setOnboardingDone: () => ipcRenderer.invoke('set-onboarding-done'),

  // Listening state from main process
  onListeningState: (callback) => ipcRenderer.on('listening-state', (_e, state) => callback(state)),

  // Speech results from native helper (via main process)
  onSpeechResult: (callback) => ipcRenderer.on('speech-result', (_e, result) => callback(result)),
  onFinalTranscript: (callback) => ipcRenderer.on('final-transcript', (_e, text) => callback(text)),
  onSpeechError: (callback) => ipcRenderer.on('speech-error', (_e, err) => callback(err)),
  onShortcutMode: (callback) => ipcRenderer.on('shortcut-mode', (_e, mode) => callback(mode)),

  // Tasks updated from main process (recurring spawn, tray toggle)
  onTasksUpdated: (callback) => ipcRenderer.on('tasks-updated', () => callback()),

  // Overlay control
  showOverlay: (text) => ipcRenderer.send('show-overlay', text),
  hideOverlay: () => ipcRenderer.send('hide-overlay'),

  // Window controls
  toggleWindow: () => ipcRenderer.send('toggle-window'),

  // Permission status
  getMicPermission: () => ipcRenderer.invoke('get-mic-permission'),
  openSystemPrefs: (pane) => ipcRenderer.invoke('open-system-prefs', pane),

  // AI features
  aiParse: (text, tasks) => ipcRenderer.invoke('ai-parse', text, tasks),
  aiBriefing: (tasks) => ipcRenderer.invoke('ai-briefing', tasks),

  // Text-to-Speech
  speak: (text) => ipcRenderer.invoke('speak', text),
  stopSpeaking: () => ipcRenderer.invoke('stop-speaking'),
});
