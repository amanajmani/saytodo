/* global saytodo, parseTask, formatDueDate */

let tasks = [];
let currentFilter = 'all';

// DOM
const onboarding = document.getElementById('onboarding');
const mainContent = document.getElementById('main-content');
const permissionScreen = document.getElementById('permission-screen');
const taskList = document.getElementById('task-list');
const emptyState = document.getElementById('empty-state');
const filterBar = document.getElementById('filter-bar');
const pendingCount = document.getElementById('pending-count');
const doneCount = document.getElementById('done-count');
const liveTranscript = document.getElementById('live-transcript');
const enableMicBtn = document.getElementById('enable-mic-btn');
const briefingBanner = document.getElementById('briefing-banner');
const briefingText = document.getElementById('briefing-text');
const aiFeedback = document.getElementById('ai-feedback');

// ===== ONBOARDING =====

let currentSlide = 0;
const totalSlides = 4;
const slideLabels = ['Get Started', 'Continue', 'Continue', 'Start Using SayTodo'];

async function initOnboarding() {
  const done = await saytodo.getOnboardingDone();
  if (done) {
    showMainApp();
    return;
  }
  showOnboarding();
}

function showOnboarding() {
  onboarding.classList.add('visible');
  mainContent.classList.remove('visible');
  permissionScreen.style.display = 'none';
  updateSlide(0);
  setupOnboardingListeners();
}

function showMainApp() {
  onboarding.classList.remove('visible');
  permissionScreen.style.display = 'none';
  mainContent.classList.add('visible');
  initApp();
}

function updateSlide(index) {
  const slides = document.querySelectorAll('.ob-slide');
  const dots = document.querySelectorAll('.ob-dot');
  const btn = document.getElementById('ob-next-btn');
  const skipBtn = document.getElementById('ob-skip-btn');

  slides.forEach((s, i) => {
    s.classList.remove('active', 'exit-left');
    if (i < index) s.classList.add('exit-left');
  });

  slides[index].classList.add('active');

  dots.forEach((d, i) => {
    d.classList.toggle('active', i === index);
  });

  btn.textContent = slideLabels[index];
  skipBtn.style.display = index === totalSlides - 1 ? 'none' : 'block';
  currentSlide = index;
}

function setupOnboardingListeners() {
  const nextBtn = document.getElementById('ob-next-btn');
  const skipBtn = document.getElementById('ob-skip-btn');

  nextBtn.addEventListener('click', async () => {
    if (currentSlide === 1) {
      await saytodo.getMicPermission();
    }
    if (currentSlide < totalSlides - 1) {
      updateSlide(currentSlide + 1);
    } else {
      await saytodo.setOnboardingDone();
      showMainApp();
    }
  });

  skipBtn.addEventListener('click', async () => {
    await saytodo.setOnboardingDone();
    showMainApp();
  });

  document.querySelectorAll('.ob-perm-item').forEach(item => {
    item.addEventListener('click', async () => {
      const perm = item.dataset.perm;
      if (perm === 'microphone') {
        await saytodo.getMicPermission();
      }
      await saytodo.openSystemPrefs(perm);
    });
  });
}

// ===== MAIN APP =====

async function initApp() {
  tasks = await saytodo.getTasks();
  renderTasks();
  setupListeners();
  fetchBriefing();
}

// --- AI-powered input processing ---
async function processInput(rawText) {
  if (!rawText || !rawText.trim()) return;

  // Try AI first
  try {
    const result = await saytodo.aiParse(rawText, tasks);
    if (result.ok) {
      if (result.type === 'task') {
        tasks.unshift(result.task);
        saveTasks();
        renderTasks();
        const recLabel = result.task.recurrence ? ' (recurring)' : '';
        showFeedback(`Added: "${result.task.text}"${recLabel}`, 'success');
        return;
      }
      if (result.type === 'command') {
        handleCommand(result.command);
        return;
      }
    }
  } catch (err) {
    console.warn('AI parse failed, using fallback:', err);
  }

  // Fallback to rule-based parser
  const task = parseTask(rawText);
  if (task) {
    tasks.unshift(task);
    saveTasks();
    renderTasks();
  }
}

function handleCommand(cmd) {
  const { action, taskId, value, message } = cmd;

  if (action === 'complete' && taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      task.done = true;
      saveTasks();
      renderTasks();
    }
  } else if (action === 'delete' && taskId) {
    tasks = tasks.filter(t => t.id !== taskId);
    saveTasks();
    renderTasks();
  } else if (action === 'priority' && taskId && value) {
    const task = tasks.find(t => t.id === taskId);
    if (task && ['high', 'med', 'low'].includes(value)) {
      task.priority = value;
      saveTasks();
      renderTasks();
    }
  } else if (action === 'reschedule' && taskId && value) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      task.dueDate = value;
      saveTasks();
      renderTasks();
    }
  } else if (action === 'add-note' && taskId && value) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      if (!task.notes) task.notes = [];
      task.notes.push({
        text: value,
        createdAt: new Date().toISOString(),
      });
      saveTasks();
      renderTasks();
    }
  } else if (action === 'filter' && value) {
    const filterMap = {
      'all': 'all', 'pending': 'pending', 'done': 'done',
      'high': 'high', 'med': 'med', 'medium': 'med', 'low': 'low',
      'today': 'today', 'overdue': 'overdue',
      'work': 'work', 'personal': 'personal', 'health': 'health',
      'errands': 'errands', 'finance': 'finance', 'learning': 'learning',
      'social': 'social',
    };
    const mapped = filterMap[value.toLowerCase()] || 'all';
    currentFilter = mapped;
    filterBar.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === mapped);
    });
    renderTasks();
  } else if (action === 'briefing') {
    // Read the daily briefing out loud
    speakBriefing();
  }

  if (message) showFeedback(message, 'success');
}

async function speakBriefing() {
  showFeedback('Reading your briefing...', 'success');
  try {
    const result = await saytodo.aiBriefing(tasks);
    if (result.ok && result.text) {
      // Also build a spoken task list
      const todayStr = new Date().toISOString().split('T')[0];
      const pending = tasks.filter(t => !t.done);
      const todayTasks = pending.filter(t => t.dueDate === todayStr);
      const overdue = pending.filter(t => t.dueDate && t.dueDate < todayStr);

      let speech = result.text;
      if (todayTasks.length > 0) {
        speech += '. Today you have: ' + todayTasks.map(t => t.text).join(', ') + '.';
      }
      if (overdue.length > 0) {
        speech += ' Overdue: ' + overdue.map(t => t.text).join(', ') + '.';
      }

      await saytodo.speak(speech);
      if (briefingBanner && briefingText) {
        briefingText.textContent = result.text;
        briefingBanner.style.display = 'block';
      }
    }
  } catch (err) {
    console.warn('Voice briefing failed:', err);
  }
}

function showFeedback(msg, type) {
  if (!aiFeedback) return;
  aiFeedback.textContent = msg;
  aiFeedback.className = 'ai-feedback visible ' + (type || '');
  setTimeout(() => { aiFeedback.className = 'ai-feedback'; }, 3000);
}

async function fetchBriefing() {
  if (!briefingBanner || !briefingText) return;
  try {
    const result = await saytodo.aiBriefing(tasks);
    if (result.ok && result.text) {
      briefingText.textContent = result.text;
      briefingBanner.style.display = 'block';
    }
  } catch (err) {
    console.warn('Briefing fetch failed:', err);
  }
}

function setupListeners() {
  // Listening state
  saytodo.onListeningState((state) => {
    if (state === 'start') {
      liveTranscript.textContent = 'Listening...';
      liveTranscript.style.display = 'block';
    }
  });

  // Live speech results
  saytodo.onSpeechResult((result) => {
    liveTranscript.style.display = 'block';
    liveTranscript.textContent = result.text || 'Listening...';
  });

  // Final transcript — use AI
  saytodo.onFinalTranscript((text) => {
    if (text && text.trim()) {
      processInput(text);
    }
    setTimeout(() => {
      liveTranscript.textContent = '';
      liveTranscript.style.display = 'none';
    }, 600);
  });

  // Tasks updated from main process (recurring tasks spawned, tray toggle)
  saytodo.onTasksUpdated(async () => {
    tasks = await saytodo.getTasks();
    renderTasks();
  });

  // Speech errors
  saytodo.onSpeechError((err) => {
    console.warn('Speech error:', err);
    const title = document.getElementById('permission-title');
    const msg = document.getElementById('permission-message');
    if (err.includes('speech_denied') || err.includes('speech_restricted')) {
      if (title) title.textContent = 'Speech Recognition Permission Needed';
      permissionScreen.style.display = 'flex';
      mainContent.classList.remove('visible');
    } else if (err.includes('recognizer_unavailable') || err.includes('Dictation')) {
      if (title) title.textContent = 'Enable Dictation';
      if (msg) msg.innerHTML = 'SayTodo needs macOS Dictation enabled.<br><br>Go to <strong>System Settings &gt; Keyboard &gt; Dictation</strong> and turn it ON, then restart SayTodo.';
      permissionScreen.style.display = 'flex';
      mainContent.classList.remove('visible');
    }
  });

  // Filter bar
  filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    filterBar.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderTasks();
  });

  // Manual input — use AI
  const taskInput = document.getElementById('task-input');
  const addTaskBtn = document.getElementById('add-task-btn');

  function addManualTask() {
    const text = taskInput.value.trim();
    if (!text) return;
    taskInput.value = '';
    processInput(text);
  }

  addTaskBtn?.addEventListener('click', addManualTask);
  taskInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addManualTask();
  });

  // Permission retry
  enableMicBtn?.addEventListener('click', async () => {
    const status = await saytodo.getMicPermission();
    if (status === 'granted') {
      permissionScreen.style.display = 'none';
      mainContent.classList.add('visible');
      tasks = await saytodo.getTasks();
      renderTasks();
    }
  });

  // Dismiss briefing
  const dismissBriefing = document.getElementById('dismiss-briefing');
  dismissBriefing?.addEventListener('click', () => {
    if (briefingBanner) briefingBanner.style.display = 'none';
  });

  // Listen briefing button
  const listenBriefingBtn = document.getElementById('listen-briefing');
  listenBriefingBtn?.addEventListener('click', () => {
    speakBriefing();
  });
}

function filterTasks(list) {
  const todayStr = new Date().toISOString().split('T')[0];
  switch (currentFilter) {
    case 'pending': return list.filter(t => !t.done);
    case 'done': return list.filter(t => t.done);
    case 'high': return list.filter(t => t.priority === 'high');
    case 'med': return list.filter(t => t.priority === 'med');
    case 'low': return list.filter(t => t.priority === 'low');
    case 'today': return list.filter(t => t.dueDate === todayStr);
    case 'overdue': return list.filter(t => t.dueDate && t.dueDate < todayStr && !t.done);
    case 'work': case 'personal': case 'health': case 'errands':
    case 'finance': case 'learning': case 'social':
      return list.filter(t => t.category === currentFilter);
    default: return list;
  }
}

const CATEGORY_ICONS = {
  work: '💼', personal: '🏠', health: '💊', errands: '🛒',
  finance: '💰', learning: '📚', social: '👥', other: '📌',
};

function renderTasks() {
  // Don't show recurring parent tasks (they're templates)
  const visible = tasks.filter(t => !t.recurrence || t.recurringParentId);
  const filtered = filterTasks(visible);
  const pending = visible.filter(t => !t.done).length;
  const done = visible.filter(t => t.done).length;
  pendingCount.textContent = `${pending} pending`;
  doneCount.textContent = `${done} done`;

  if (filtered.length === 0) {
    taskList.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  taskList.innerHTML = filtered.map(task => {
    const priorityColors = { high: '#ef4444', med: '#f59e0b', low: '#22c55e' };
    const priorityLabels = { high: 'HIGH', med: 'MED', low: 'LOW' };
    const borderColor = priorityColors[task.priority] || priorityColors.low;
    const due = formatDueDate(task.dueDate);
    const catIcon = CATEGORY_ICONS[task.category] || CATEGORY_ICONS.other;
    const isRecurring = task.recurringParentId;
    const hasNotes = task.notes && task.notes.length > 0;

    const dateIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.7;margin-right:3px;vertical-align:-1px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

    const repeatIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.7;margin-right:2px;vertical-align:-1px"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

    const noteIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="opacity:0.7;margin-right:2px;vertical-align:-1px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

    // Build notes HTML
    let notesHtml = '';
    if (hasNotes) {
      notesHtml = `<div class="task-notes">
        ${task.notes.map(n => `<div class="task-note">${noteIcon} ${escapeHtml(n.text)}</div>`).join('')}
      </div>`;
    }

    return `
      <div class="task-card ${task.done ? 'done' : ''}" data-id="${task.id}">
        <div class="task-border" style="background: ${borderColor}"></div>
        <div class="task-body">
          <div class="task-row">
            <button class="check-btn ${task.done ? 'checked' : ''}" data-action="toggle" data-id="${task.id}">
              ${task.done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            </button>
            <span class="task-text">${escapeHtml(task.text)}</span>
            <button class="delete-btn" data-action="delete" data-id="${task.id}">&times;</button>
          </div>
          <div class="task-meta">
            <span class="badge priority-${task.priority}">${priorityLabels[task.priority]}</span>
            ${task.category && task.category !== 'other' ? `<span class="badge category-badge">${catIcon} ${task.category}</span>` : ''}
            ${due ? `<span class="badge date-badge date-${due.color}">${dateIcon}${due.label}</span>` : ''}
            ${isRecurring ? `<span class="badge recurring-badge">${repeatIcon}Recurring</span>` : ''}
            ${hasNotes ? `<span class="badge notes-badge" data-action="toggle-notes" data-id="${task.id}">${noteIcon}${task.notes.length} note${task.notes.length > 1 ? 's' : ''}</span>` : ''}
          </div>
          ${notesHtml}
        </div>
      </div>
    `;
  }).join('');

  taskList.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'toggle') {
      const task = tasks.find(t => t.id === id);
      if (task) { task.done = !task.done; saveTasks(); renderTasks(); }
    } else if (action === 'delete') {
      // Also delete recurring parent if this is a recurring instance
      const task = tasks.find(t => t.id === id);
      tasks = tasks.filter(t => t.id !== id);
      saveTasks();
      renderTasks();
    } else if (action === 'toggle-notes') {
      const card = btn.closest('.task-card');
      const notes = card?.querySelector('.task-notes');
      if (notes) notes.classList.toggle('expanded');
    }
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function saveTasks() {
  await saytodo.saveTasks(tasks);
}

// Boot
initOnboarding();
