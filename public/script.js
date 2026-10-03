const $ = (id) => document.getElementById(id);

const prefsEl = $('prefs');
const notesInput = $('notes');
const chipInputs = [...prefsEl.querySelectorAll('input[type="checkbox"]')];
const otherChip = chipInputs.find((input) => input.value === 'other');
const analyzeBtn = $('analyzeBtn');
const statusEl = $('status');
const resultCard = $('resultCard');
const resultTitle = $('resultTitle');
const resultBody = $('resultBody');
const copyBtn = $('copyBtn');
const newBtn = $('newBtn');

const MAX_SIDE = 1600;
const PREFS_KEY = 'productPrefs';
const LEGACY_PROFILE_KEY = 'productProfile';

const TEXT = {
  analyze: 'Analyze product',
  analyzing: 'Analyzing…',
  busy: 'Reading the label and searching for information… this can take a minute.',
  errorAnalyze: 'Something went wrong during the analysis. Please try again.',
  errorImage: "Couldn't read this image. Try another one.",
  resultTitle: 'Result',
  noticeTitle: 'Notice',
  copy: '📋 Copy result',
  copied: '✓ Copied',
  copyFailed: "Couldn't copy",
};

// Markers the server asks the model to write; the visible words are in the user's language.
const SECTION_RE =
  /^\[\[(product|summary|details|stats|allergy|health|sources|note)\]\]\s*([^:]*?)\s*:\s*(.*)$/;
const FOOTER_PREFIX = '[[footer]]';
const BADGE_RE = /\[(confirmed|inferred|unknown)\|([^\]]+)\]/g;
const NONE_TAG_RE = /\s*\[none\]\s*/g;
const URL_RE = /(https?:\/\/[^\s)]+)/g;
const SECTION_CLASSES = { stats: 'stats', note: 'warn' };
const BADGE_CLASSES = {
  confirmed: 'badge-sure',
  inferred: 'badge-guess',
  unknown: 'badge-unknown',
};

const state = {
  phase: 'editing', // editing | analyzing | done
  images: { ingredients: null, product: null },
  resultText: '',
};

function updateNotesVisibility() {
  notesInput.hidden = !otherChip.checked;
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        keys: chipInputs.filter((input) => input.checked).map((input) => input.value),
        notes: notesInput.value,
      }),
    );
  } catch {}
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (saved) {
      chipInputs.forEach((input) => {
        input.checked = saved.keys?.includes(input.value) ?? false;
      });
      notesInput.value = saved.notes ?? '';
    } else {
      // Carry over the free-text profile saved by the previous version of the page.
      const legacy = localStorage.getItem(LEGACY_PROFILE_KEY);
      if (legacy) {
        otherChip.checked = true;
        notesInput.value = legacy;
      }
    }
  } catch {}
  updateNotesVisibility();
}

function selectedPreferences() {
  return chipInputs
    .filter((input) => input.checked && input !== otherChip)
    .map((input) => input.value);
}

function notesText() {
  return otherChip.checked ? notesInput.value.trim() : '';
}

function setPrefsDisabled(disabled) {
  chipInputs.forEach((input) => {
    input.disabled = disabled;
  });
  notesInput.disabled = disabled;
}

chipInputs.forEach((input) => {
  input.addEventListener('change', () => {
    updateNotesVisibility();
    if (input === otherChip && otherChip.checked) notesInput.focus();
    savePrefs();
  });
});
notesInput.addEventListener('input', savePrefs);
loadPrefs();

async function toResizedJpegBase64(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

function setStatus(text, busy = false) {
  statusEl.replaceChildren();
  if (busy) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    statusEl.appendChild(spinner);
  }
  statusEl.appendChild(document.createTextNode(text));
}

// Changing or deleting a photo makes the previous result stale.
function invalidateResult() {
  if (state.phase === 'done') {
    state.phase = 'editing';
    state.resultText = '';
  }
}

const slots = {};

document.querySelectorAll('.slot').forEach((root) => {
  const name = root.dataset.slot;
  const slot = {
    empty: root.querySelector('.slot-empty'),
    filled: root.querySelector('.slot-filled'),
    img: root.querySelector('.slot-img'),
    input: root.querySelector('input[type="file"]'),
    pick: root.querySelector('[data-action="pick"]'),
    replace: root.querySelector('[data-action="replace"]'),
    remove: root.querySelector('[data-action="remove"]'),
  };
  slots[name] = slot;

  slot.pick.addEventListener('click', () => slot.input.click());
  slot.replace.addEventListener('click', () => slot.input.click());

  slot.remove.addEventListener('click', () => {
    state.images[name] = null;
    invalidateResult();
    render();
  });

  slot.input.addEventListener('change', async () => {
    const file = slot.input.files[0];
    slot.input.value = '';
    if (!file) return;

    try {
      state.images[name] = await toResizedJpegBase64(file);
      invalidateResult();
      setStatus('');
    } catch {
      setStatus(TEXT.errorImage);
    }
    render();
  });
});

function render() {
  const analyzing = state.phase === 'analyzing';
  const done = state.phase === 'done';

  for (const [name, slot] of Object.entries(slots)) {
    const image = state.images[name];
    slot.empty.hidden = Boolean(image);
    slot.filled.hidden = !image;
    if (image) slot.img.src = `data:image/jpeg;base64,${image}`;

    slot.pick.disabled = analyzing || done;
    slot.replace.disabled = analyzing;
    slot.remove.disabled = analyzing;
  }

  setPrefsDisabled(analyzing);
  analyzeBtn.hidden = done;
  analyzeBtn.disabled = !state.images.ingredients || analyzing;
  analyzeBtn.textContent = analyzing ? TEXT.analyzing : TEXT.analyze;
  resultCard.hidden = !done;
}

function cleanReport(text) {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*-{3,}\s*$/gm, '')
    .trim();
}

// Removes the markers so the copied text reads naturally.
function toPlainText(report) {
  return report
    .replace(/^\[\[(footer|\w+)\]\]\s*/gm, '')
    .replace(BADGE_RE, '$2')
    .replace(NONE_TAG_RE, ' ')
    .trim();
}

function appendBadges(parent, text) {
  let last = 0;
  for (const match of text.matchAll(BADGE_RE)) {
    parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const badge = document.createElement('span');
    badge.className = `badge ${BADGE_CLASSES[match[1]]}`;
    badge.textContent = match[2];
    parent.appendChild(badge);
    last = match.index + match[0].length;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
}

// Builds DOM nodes instead of using innerHTML, so model or web text can never inject HTML.
function appendRich(parent, text) {
  text
    .replace(NONE_TAG_RE, ' ')
    .split(URL_RE)
    .forEach((part) => {
      if (/^https?:\/\//.test(part)) {
        const link = document.createElement('a');
        link.href = part;
        link.textContent = part;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        // Keep URLs left-to-right so the trailing slash doesn't jump to the front inside RTL text.
        link.dir = 'ltr';
        parent.appendChild(link);
      } else {
        appendBadges(parent, part);
      }
    });
}

// dir="auto" lets each block follow its own language, so Arabic reports render right-to-left.
function createSection(className) {
  const section = document.createElement('section');
  section.className = `rsec ${className}`.trim();
  section.dir = 'auto';
  return section;
}

function renderReport(container, text) {
  container.replaceChildren();
  let section = null;

  const addParagraph = (line, className = '') => {
    if (!section) {
      section = createSection('');
      container.appendChild(section);
    }
    const p = document.createElement('p');
    if (className) p.className = className;
    appendRich(p, line);
    section.appendChild(p);
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(SECTION_RE);
    if (heading) {
      section = createSection(SECTION_CLASSES[heading[1]] ?? '');
      const h3 = document.createElement('h3');
      h3.textContent = heading[2];
      section.appendChild(h3);
      container.appendChild(section);
      if (heading[3]) addParagraph(heading[3]);
    } else if (line.startsWith(FOOTER_PREFIX)) {
      addParagraph(line.slice(FOOTER_PREFIX.length).trim(), 'footnote');
    } else {
      addParagraph(line);
    }
  }
}

function showNotice(message) {
  state.phase = 'done';
  state.resultText = '';
  resultTitle.textContent = TEXT.noticeTitle;
  resultBody.replaceChildren();
  const p = document.createElement('p');
  p.className = 'notice-text';
  p.dir = 'auto';
  p.textContent = message;
  resultBody.appendChild(p);
  copyBtn.hidden = true;
}

function showReport(text) {
  state.phase = 'done';
  state.resultText = toPlainText(text);
  resultTitle.textContent = TEXT.resultTitle;
  renderReport(resultBody, text);
  copyBtn.hidden = false;
}

analyzeBtn.addEventListener('click', async () => {
  if (!state.images.ingredients || state.phase !== 'editing') return;

  state.phase = 'analyzing';
  render();
  setStatus(TEXT.busy, true);

  try {
    const res = await fetch('/product/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: state.images.ingredients,
        productImage: state.images.product,
        mediaType: 'image/jpeg',
        preferences: selectedPreferences(),
        notes: notesText(),
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === 'not_a_label') {
      showNotice(data.message);
    } else {
      showReport(cleanReport(data.report));
    }
    setStatus('');
    render();
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    state.phase = 'editing';
    setStatus(TEXT.errorAnalyze);
    render();
  }
});

// navigator.clipboard needs a secure context, so plain http (e.g. a phone on the LAN) uses the textarea fallback.
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  area.remove();
  return ok;
}

let copyTimer;

copyBtn.addEventListener('click', async () => {
  const ok = await copyText(state.resultText);
  copyBtn.textContent = ok ? TEXT.copied : TEXT.copyFailed;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyBtn.textContent = TEXT.copy;
  }, 2000);
});

newBtn.addEventListener('click', () => {
  state.phase = 'editing';
  state.images.ingredients = null;
  state.images.product = null;
  state.resultText = '';
  resultBody.replaceChildren();
  setStatus('');
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

render();
