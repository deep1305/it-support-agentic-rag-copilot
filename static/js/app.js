// ============================================================
// Service Desk Copilot: front-end
// Talks to: GET /api/health, POST /api/chat, POST /api/ingest
// ============================================================

const $ = (id) => document.getElementById(id);
const chat = $('chat');
const form = $('chatForm');
const question = $('question');
const sendBtn = $('sendBtn');
const counter = $('counter');
const trace = $('trace');
const sourceUsed = $('sourceUsed');
const stepCount = $('stepCount');
const elapsed = $('elapsed');

let busy = false;

// ---------- Helpers ----------
const escapeHtml = (s = '') =>
  String(s).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

const SOURCES = {
  private_kb: { label: 'Knowledge base', cls: 'tag-kb' },
  web_search: { label: 'Web search', cls: 'tag-web' },
  web: { label: 'Web search', cls: 'tag-web' },
  direct: { label: 'Direct reply', cls: 'tag-direct' },
  insufficient_evidence: { label: 'No reliable source', cls: 'tag-none' },
};
const sourceInfo = (s) => SOURCES[s] || { label: s || 'Unknown', cls: 'tag-direct' };

const ICONS = {
  route: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M6 3v12a3 3 0 003 3h9M15 15l3 3-3 3M6 3l-3 3M6 3l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  kb: '<svg viewBox="0 0 24 24" width="15" height="15"><ellipse cx="12" cy="5" rx="8" ry="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  grade: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M9 11l3 3 8-8M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  web: '<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  rewrite: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  answer: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8l8 8" stroke="currentColor" stroke-width="2"/></svg>',
  spin: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 3a9 9 0 109 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  dot: '<svg viewBox="0 0 24 24" width="15" height="15"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
};

// Very small, safe markdown renderer: input is escaped first, then a few patterns are formatted.
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

function renderMarkdown(text = '') {
  const lines = escapeHtml(text.trim()).split(/\r?\n/);
  let html = '', list = null, para = [];
  const flushPara = () => { if (para.length) { html += `<p>${para.map(inlineMd).join('<br>')}</p>`; para = []; } };
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };

  for (const raw of lines) {
    const line = raw.trim();
    let m;
    if (!line) { flushPara(); closeList(); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)$/))) { flushPara(); closeList(); html += `<h4>${inlineMd(m[1])}</h4>`; continue; }
    if ((m = line.match(/^[-*•]\s+(.*)$/))) {
      flushPara(); if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inlineMd(m[1])}</li>`; continue;
    }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flushPara(); if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inlineMd(m[1])}</li>`; continue;
    }
    closeList(); para.push(line);
  }
  flushPara(); closeList();
  return html;
}

const scrollToBottom = () => { chat.scrollTop = chat.scrollHeight; };

// ---------- Messages ----------
function hideWelcome() { const w = $('welcome'); if (w) w.remove(); }

function addUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  chat.appendChild(el);
  scrollToBottom();
}

function addThinking() {
  const el = document.createElement('div');
  el.className = 'msg assistant';
  el.innerHTML = `<div class="card"><div class="card-body"><span class="thinking"><span class="dots"><i></i><i></i><i></i></span>Checking the knowledge base…</span></div></div>`;
  chat.appendChild(el);
  scrollToBottom();
  return el;
}

function fillAnswer(el, data, seconds) {
  const src = sourceInfo(data.source_used);
  const cites = (data.citations || []).map((c) => {
    const title = escapeHtml(c.title || c.url || 'Source');
    return c.url
      ? `<a class="cite" href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(c.url)}">${title}</a>`
      : `<span class="cite" title="${title}">${title}</span>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <span class="source-chip ${src.cls}">${escapeHtml(src.label)}</span>
        <span class="card-meta">${seconds.toFixed(1)}s</span>
      </div>
      <div class="card-body">${renderMarkdown(data.answer || '')}</div>
      <div class="card-foot">
        ${cites ? `<span class="cite-label">Sources</span>${cites}` : ''}
        <button class="copy-btn" type="button">Copy</button>
      </div>
    </div>`;

  el.querySelector('.copy-btn').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(data.answer || ''); e.target.textContent = 'Copied'; }
    catch { e.target.textContent = 'Copy failed'; }
    setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
  });
  scrollToBottom();
}

function fillError(el, message) {
  el.classList.add('error');
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><span class="source-chip tag-none">Request failed</span></div>
      <div class="card-body"><p>${escapeHtml(message)}</p><p class="muted small">Check that the server is running and the API keys in <code>.env</code> are valid, then try again.</p></div>
    </div>`;
  scrollToBottom();
}

// ---------- Inspector / trace ----------
function parseStep(item) {
  const [label, ...rest] = String(item).split('→');
  const key = label.trim().toLowerCase();
  const detail = rest.join('→').trim();
  const verdict = /^(good|weak)$/i.test(detail) ? detail.toLowerCase() : null;

  if (key.startsWith('router')) return { kind: 'route', icon: 'route', title: 'Route question', detail: detail === 'KB' ? 'IT question: use knowledge base' : 'Casual chat: reply directly' };
  if (key.startsWith('private kb')) return { kind: 'kb', icon: 'kb', title: 'Search knowledge base', detail };
  if (key.startsWith('kb evidence')) return { kind: 'kb', icon: 'grade', title: 'Grade internal evidence', verdict };
  if (key.startsWith('web fallback')) return { kind: 'web', icon: 'web', title: 'Search the web', detail };
  if (key.startsWith('web evidence')) return { kind: 'web', icon: 'grade', title: 'Grade web evidence', verdict };
  if (key.startsWith('query rewrite')) return { kind: 'rewrite', icon: 'rewrite', title: 'Rewrite query', detail };
  if (key.startsWith('answer generation')) return { kind: 'answer', icon: 'answer', title: 'Write grounded answer', detail: detail.toLowerCase().includes('web') ? 'From web search' : 'From knowledge base' };
  if (key.startsWith('direct response')) return { kind: 'answer', icon: 'answer', title: 'Reply directly', detail: 'No retrieval needed' };
  if (key.startsWith('stopped')) return { kind: 'stop', icon: 'stop', title: 'Stopped', detail };
  return { kind: 'other', icon: 'dot', title: label.trim(), detail };
}

function renderTrace(items) {
  trace.innerHTML = items.map((item, i) => {
    const s = parseStep(item);
    const badge = s.verdict ? `<span class="badge ${s.verdict}">${s.verdict.toUpperCase()}</span>` : '';
    return `<li class="step kind-${s.kind}" style="animation-delay:${i * 60}ms">
      <span class="step-icon">${ICONS[s.icon]}</span>
      <div class="step-body"><div class="step-title">${escapeHtml(s.title)}${badge}</div>${s.detail ? `<div class="step-detail">${escapeHtml(s.detail)}</div>` : ''}</div>
    </li>`;
  }).join('');
}

function setInspectorRunning() {
  sourceUsed.textContent = '…'; stepCount.textContent = '…'; elapsed.textContent = '…';
  trace.innerHTML = `<li class="step running"><span class="step-icon">${ICONS.spin}</span>
    <div class="step-body"><div class="step-title">Agent is working</div><div class="step-detail">Steps appear when the run finishes</div></div></li>`;
}

function setInspectorResult(data, seconds) {
  const items = data.trace || [];
  sourceUsed.textContent = sourceInfo(data.source_used).label;
  stepCount.textContent = items.length;
  elapsed.textContent = `${seconds.toFixed(1)}s`;
  renderTrace(items);
}

// ---------- Ask ----------
async function askAgent(q) {
  if (busy || !q) return;
  busy = true; sendBtn.disabled = true;
  hideWelcome();
  addUserMessage(q);
  question.value = ''; autosize(); updateCounter();
  const pending = addThinking();
  setInspectorRunning();
  const t0 = performance.now();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join('; ') : data.detail;
      throw new Error(detail || `Server returned ${res.status}`);
    }
    const seconds = (performance.now() - t0) / 1000;
    fillAnswer(pending, data, seconds);
    setInspectorResult(data, seconds);
  } catch (err) {
    fillError(pending, err.message || 'Something went wrong.');
    sourceUsed.textContent = 'Error'; stepCount.textContent = '—'; elapsed.textContent = '—';
    trace.innerHTML = `<li class="step kind-stop"><span class="step-icon">${ICONS.stop}</span><div class="step-body"><div class="step-title">Request failed</div></div></li>`;
  } finally {
    busy = false; sendBtn.disabled = false; question.focus();
  }
}

// ---------- Composer ----------
function autosize() {
  question.style.height = 'auto';
  question.style.height = `${Math.min(question.scrollHeight, 200)}px`;
  question.style.overflowY = question.scrollHeight > 200 ? 'auto' : 'hidden';
}
function updateCounter() { counter.textContent = `${question.value.length} / 3000`; }

question.addEventListener('input', () => { autosize(); updateCounter(); });
question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});
form.addEventListener('submit', (e) => { e.preventDefault(); askAgent(question.value.trim()); });
document.querySelectorAll('.suggestion').forEach((b) => b.addEventListener('click', () => askAgent(b.dataset.q)));
autosize();

// ---------- Health ----------
(async () => {
  const status = $('status'), text = $('statusText');
  try {
    const r = await fetch('/api/health');
    if (!r.ok) throw new Error();
    status.classList.add('ok'); text.textContent = 'Online';
  } catch { status.classList.add('down'); text.textContent = 'Offline'; }
})();

// ---------- Theme ----------
$('themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) {}
});

// ---------- Mobile inspector ----------
const inspector = $('inspector');
const toggleInspector = (open) => {
  inspector.classList.toggle('open', open);
  $('inspectorToggle').setAttribute('aria-expanded', String(open));
};
$('inspectorToggle').addEventListener('click', () => toggleInspector(!inspector.classList.contains('open')));
$('inspectorClose').addEventListener('click', () => toggleInspector(false));

// ---------- Upload dialog ----------
const modal = $('uploadModal');
const fileInput = $('fileInput');
const dropzone = $('dropzone');
const dropText = $('dropText');
const uploadStatus = $('uploadStatus');
const setUploadStatus = (msg, cls = '') => { uploadStatus.textContent = msg; uploadStatus.className = `upload-status ${cls}`; };

$('openUpload').addEventListener('click', () => { setUploadStatus(''); modal.showModal(); });
$('closeUpload').addEventListener('click', () => modal.close());
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

function showChosenFile() {
  const f = fileInput.files[0];
  dropzone.classList.toggle('has-file', !!f);
  dropText.innerHTML = f ? `<b>${escapeHtml(f.name)}</b> · ${(f.size / 1024).toFixed(1)} KB` : '<b>Choose a file</b> or drag it here';
}
fileInput.addEventListener('change', showChosenFile);
['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; showChosenFile(); }
});

$('uploadBtn').addEventListener('click', async () => {
  const file = fileInput.files[0];
  const key = $('adminKey').value;
  if (!file) return setUploadStatus('Choose a file first.', 'err');
  if (!key) return setUploadStatus('Enter the admin API key.', 'err');

  const btn = $('uploadBtn');
  btn.disabled = true; setUploadStatus('Indexing document…');
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/ingest', { method: 'POST', headers: { 'X-Admin-Key': key }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || `Upload failed (${r.status})`);
    setUploadStatus(`Indexed ${d.file}: ${d.chunks} chunks added to the knowledge base.`, 'ok');
    fileInput.value = ''; showChosenFile();
  } catch (err) {
    setUploadStatus(`Error: ${err.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
});
