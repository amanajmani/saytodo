/**
 * Rule-based NLP parser for voice-to-task conversion.
 * No AI, no API — pure JavaScript.
 */

const FILLER_WORDS = [
  'um', 'uh', 'like', 'you know', 'basically', 'actually',
  'so', 'well', 'right', 'kind of', 'sort of', 'i mean', 'you see'
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Priority patterns — ordered longest match first to avoid partial hits.
// Each pattern is a regex that must match as a whole phrase.
const PRIORITY_PATTERNS = [
  // "high priority", "priority high", standalone "high"
  { level: 'high', regex: /\b(?:high\s+priority|priority\s+high|high)\b/ },
  // "medium priority", "priority medium", "medium", "med priority", "med"
  { level: 'med',  regex: /\b(?:medium\s+priority|priority\s+medium|med\s+priority|priority\s+med|medium|med)\b/ },
  // "low priority", "priority low", standalone "low"
  { level: 'low',  regex: /\b(?:low\s+priority|priority\s+low|low)\b/ },
];

function parseTask(rawText) {
  if (!rawText || !rawText.trim()) return null;

  let text = rawText.toLowerCase().trim();
  let priority = 'low';
  let dueDate = null;

  // 1. Detect priority — try longest phrases first
  let matchedPriorityPhrase = null;
  for (const rule of PRIORITY_PATTERNS) {
    const m = text.match(rule.regex);
    if (m) {
      // Make sure "med" isn't part of a longer word like "medicine" or "media"
      // The \b in the regex already handles this, but double-check:
      priority = rule.level;
      matchedPriorityPhrase = m[0];
      break;
    }
  }

  // 2. Detect due date
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let matchedDatePhrase = null;

  const datePatterns = [
    // "january 15", "feb 3", "march 22nd", etc.
    {
      regex: new RegExp(`\\b(${MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`),
      resolve: (m) => {
        const monthStr = m[1];
        let monthIdx = MONTHS.findIndex(mo => mo.startsWith(monthStr.slice(0, 3)));
        if (monthIdx === -1) return null;
        const day = parseInt(m[2]);
        const d = new Date(today.getFullYear(), monthIdx, day);
        // If the date is in the past, assume next year
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        return d;
      },
    },
    // "15th of january", "3rd of feb"
    {
      regex: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\b`),
      resolve: (m) => {
        const day = parseInt(m[1]);
        const monthStr = m[2];
        let monthIdx = MONTHS.findIndex(mo => mo.startsWith(monthStr.slice(0, 3)));
        if (monthIdx === -1) return null;
        const d = new Date(today.getFullYear(), monthIdx, day);
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        return d;
      },
    },
    { regex: /\bday after tomorrow\b/,    resolve: () => addDays(today, 2) },
    { regex: /\btomorrow\b/,              resolve: () => addDays(today, 1) },
    { regex: /\btoday\b/,                 resolve: () => new Date(today) },
    { regex: /\btonight\b/,               resolve: () => new Date(today) },
    { regex: /\bnext week\b/,             resolve: () => addDays(today, 7) },
    { regex: /\bnext month\b/,            resolve: () => { const d = new Date(today); d.setMonth(d.getMonth() + 1); return d; } },
    { regex: /\bin (\d+) weeks?\b/,       resolve: (m) => addDays(today, parseInt(m[1]) * 7) },
    { regex: /\bin (\d+) days?\b/,        resolve: (m) => addDays(today, parseInt(m[1])) },
    { regex: /\bin (\d+) months?\b/,      resolve: (m) => { const d = new Date(today); d.setMonth(d.getMonth() + parseInt(m[1])); return d; } },
    // "next monday", "next tuesday", etc.
    {
      regex: new RegExp(`\\bnext (${WEEKDAYS.join('|')})\\b`),
      resolve: (m) => {
        const targetDay = WEEKDAYS.indexOf(m[1]);
        const d = new Date(today);
        let diff = targetDay - d.getDay();
        if (diff <= 0) diff += 7;
        diff += 7;
        d.setDate(d.getDate() + diff);
        return d;
      },
    },
    // "this monday", "this friday"
    {
      regex: new RegExp(`\\bthis (${WEEKDAYS.join('|')})\\b`),
      resolve: (m) => {
        const targetDay = WEEKDAYS.indexOf(m[1]);
        const d = new Date(today);
        let diff = targetDay - d.getDay();
        if (diff <= 0) diff += 7;
        d.setDate(d.getDate() + diff);
        return d;
      },
    },
    // bare weekday: "monday", "friday", etc.
    {
      regex: new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`),
      resolve: (m) => {
        const targetDay = WEEKDAYS.indexOf(m[1]);
        const d = new Date(today);
        let diff = targetDay - d.getDay();
        if (diff <= 0) diff += 7;
        d.setDate(d.getDate() + diff);
        return d;
      },
    },
    // "end of week"
    {
      regex: /\bend of (?:the )?week\b/,
      resolve: () => {
        const d = new Date(today);
        const diff = 5 - d.getDay(); // Friday
        d.setDate(d.getDate() + (diff <= 0 ? diff + 7 : diff));
        return d;
      },
    },
    // "end of month"
    {
      regex: /\bend of (?:the )?month\b/,
      resolve: () => new Date(today.getFullYear(), today.getMonth() + 1, 0),
    },
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const resolved = pattern.resolve(match);
      if (resolved) {
        dueDate = resolved;
        matchedDatePhrase = match[0];
        break;
      }
    }
  }

  // 3. Remove matched phrases from text
  if (matchedPriorityPhrase) {
    text = text.replace(matchedPriorityPhrase, '');
  }
  if (matchedDatePhrase) {
    text = text.replace(matchedDatePhrase, '');
  }

  // 4. Remove filler words (longer phrases first)
  const sortedFillers = [...FILLER_WORDS].sort((a, b) => b.length - a.length);
  for (const filler of sortedFillers) {
    text = text.replace(new RegExp(`\\b${escapeRegex(filler)}\\b`, 'gi'), '');
  }

  // 5. Clean up
  text = text.replace(/\s+/g, ' ').trim();
  // Remove leading/trailing punctuation and connectors
  text = text.replace(/^[\s,.\-:;]+|[\s,.\-:;]+$/g, '').trim();
  if (!text) return null;
  text = text.charAt(0).toUpperCase() + text.slice(1);

  return {
    text,
    priority,
    dueDate: dueDate ? dueDate.toISOString().split('T')[0] : null,
    category: 'other',
    createdAt: new Date().toISOString(),
    done: false,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  };
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format due date for display — like Todoist / TickTick style labels.
 * Returns an object: { label, color }
 *   color: 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'
 */
function formatDueDate(dueDateStr) {
  if (!dueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr + 'T00:00:00');
  const diffMs = due - today;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return { label: abs === 1 ? 'Yesterday' : `${abs}d overdue`, color: 'overdue' };
  }
  if (diffDays === 0) return { label: 'Today', color: 'today' };
  if (diffDays === 1) return { label: 'Tomorrow', color: 'tomorrow' };
  if (diffDays <= 7) {
    // Show weekday name: "Wednesday"
    const dayName = due.toLocaleDateString('en-US', { weekday: 'long' });
    return { label: dayName, color: 'week' };
  }
  // Show "Mar 15" style
  const formatted = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label: formatted, color: 'later' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTask, formatDueDate };
}
