// Co-GM dashboard client. Vanilla ES module — no build step.
// Connects to the server's SSE stream and renders three live panes plus the
// "ask the co-GM" control. All mutations go through the server's REST endpoints.

const $ = id => document.getElementById(id);

const els = {
  worldSubtitle: $('world-subtitle'),
  statusBridge: $('status-bridge'),
  statusFoundry: $('status-foundry'),
  statusAi: $('status-ai'),
  btnPause: $('btn-pause'),
  btnDiag: $('btn-diag'),
  selectTone: $('select-tone'),
  selectModel: $('select-model'),
  combatMeta: $('combat-meta'),
  combatBody: $('combat-body'),
  feedMeta: $('feed-meta'),
  feedBody: $('feed-body'),
  aiMeta: $('ai-meta'),
  aiBody: $('ai-body'),
  diagMeta: $('diag-meta'),
  diagBody: $('diag-body'),
  askForm: $('ask-form'),
  askInput: $('ask-input'),
  // GM Actions
  btnGm: $('btn-gm'),
  btnTools: $('btn-tools'),
  combatActions: $('combat-actions'),
  drawer: $('tools-drawer'),
  drawerBackdrop: $('drawer-backdrop'),
  drawerClose: $('drawer-close'),
  gmGate: $('gm-gate'),
  gmGateEnable: $('gm-gate-enable'),
  toolSearch: $('tool-search'),
  toolList: $('tool-list'),
  toolBrowser: $('tool-browser'),
  toolDetail: $('tool-detail'),
  toolBack: $('tool-back'),
  toolDetailName: $('tool-detail-name'),
  toolDetailKind: $('tool-detail-kind'),
  toolDetailDesc: $('tool-detail-desc'),
  toolForm: $('tool-form'),
  toolResult: $('tool-result'),
  modalBackdrop: $('modal-backdrop'),
  modalTitle: $('modal-title'),
  modalBody: $('modal-body'),
  modalDestructive: $('modal-destructive'),
  modalDestructiveCheck: $('modal-destructive-check'),
  modalCancel: $('modal-cancel'),
  modalConfirm: $('modal-confirm'),
  toastStack: $('toast-stack'),
};

const seenEventIds = new Set();
let eventCount = 0;
const seenErrorIds = new Set();
const errorCounts = { error: 0, warn: 0 };
const comments = new Map(); // genId -> { card, body, doneText }
let settings = {
  paused: false,
  tone: 'tactical',
  model: 'claude-opus-4-8',
  aiEnabled: false,
  commentOnErrors: true,
  gmActionsEnabled: false,
};

// GM Actions state
let lastCombat = null;
const selectedCombatants = new Set();
let toolCatalog = [];
let toolsLoaded = false;
let confirmResolver = null;

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------
async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : Promise.reject(new Error(`${path} -> ${res.status}`));
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function setDot(pill, cls, label) {
  pill.innerHTML = `<span class="dot ${cls}"></span> ${label}`;
}

function renderStatus(status) {
  if (status.controlChannel === 'connected') {
    setDot(els.statusBridge, 'dot-green', 'Bridge: connected');
  } else {
    setDot(els.statusBridge, 'dot-red', 'Bridge: disconnected');
  }

  if (status.foundry === 'reachable') {
    setDot(els.statusFoundry, 'dot-green', 'Foundry: live');
  } else if (status.foundry === 'unreachable') {
    setDot(els.statusFoundry, 'dot-amber', 'Foundry: unreachable');
  } else {
    setDot(els.statusFoundry, 'dot-grey', 'Foundry: unknown');
  }
}

function renderSettings(next) {
  settings = { ...settings, ...next };
  els.btnPause.textContent = settings.paused ? '▶ Resume' : '⏸ Pause';
  els.btnPause.classList.toggle('paused', settings.paused);
  els.selectTone.value = settings.tone;
  if (settings.model) els.selectModel.value = settings.model;
  els.btnDiag.textContent = settings.commentOnErrors ? '🩺 Diag AI: on' : '🩺 Diag AI: off';
  els.btnDiag.classList.toggle('toggle-off', !settings.commentOnErrors);
  if (settings.aiEnabled) {
    setDot(els.statusAi, 'dot-green', `AI: ${settings.paused ? 'paused' : 'on'}`);
    els.btnPause.disabled = false;
    els.btnDiag.disabled = false;
  } else {
    setDot(els.statusAi, 'dot-red', 'AI: disabled');
    els.btnPause.disabled = true;
    els.btnDiag.disabled = true;
    els.askInput.placeholder = 'Set ANTHROPIC_API_KEY to enable the co-GM';
  }

  // GM Actions master switch
  els.btnGm.textContent = settings.gmActionsEnabled ? '⚔ GM Actions: on' : '⚔ GM Actions: off';
  els.btnGm.classList.toggle('on', !!settings.gmActionsEnabled);
  if (!settings.gmActionsEnabled) selectedCombatants.clear();
  updateGate();
  renderCombat(lastCombat);
}

function renderWorld(world) {
  if (!world) return;
  els.worldSubtitle.textContent = `${world.title} · ${world.systemId} ${world.systemVersion} · Foundry ${world.foundryVersion}`;
}

// ---------------------------------------------------------------------------
// Combat tracker
// ---------------------------------------------------------------------------
function sideTag(c) {
  if (c.isPC) return '<span class="side side-pc">PC</span>';
  if (c.category === 'enemy') return '<span class="side side-enemy">Enemy</span>';
  return '<span class="side side-npc">NPC</span>';
}

function hpClass(ratio) {
  if (ratio <= 0.33) return 'low';
  if (ratio <= 0.66) return 'mid';
  return '';
}

function combatantClasses(c) {
  const cls = ['combatant'];
  if (c.isCurrentTurn) cls.push('current');
  if (c.defeated) cls.push('defeated');
  if (settings.gmActionsEnabled) cls.push('selectable');
  if (selectedCombatants.has(c.id)) cls.push('selected');
  return cls.join(' ');
}

function renderCombat(combat) {
  lastCombat = combat;
  if (!combat || !combat.active) {
    selectedCombatants.clear();
    els.combatMeta.textContent = '—';
    els.combatBody.innerHTML = '<p class="empty">No active combat.</p>';
    renderCombatActions();
    return;
  }

  // Drop selections for combatants that have left the encounter.
  const ids = new Set(combat.combatants.map(c => c.id));
  for (const id of [...selectedCombatants]) if (!ids.has(id)) selectedCombatants.delete(id);

  els.combatMeta.textContent = `Round ${combat.round} · ${combat.combatants.length} combatants`;

  const rows = combat.combatants
    .map(c => {
      const ratio = c.hp.max > 0 ? c.hp.value / c.hp.max : 0;
      const conditions = (c.conditions || [])
        .map(cond => `<span class="condition-chip">${escapeHtml(cond)}</span>`)
        .join('');
      const deathSaves =
        c.deathSaves && c.hp.value <= 0
          ? `<div class="death-saves">Death saves ✓${c.deathSaves.successes} ✗${c.deathSaves.failures}</div>`
          : '';
      const init = c.initiative === null || c.initiative === undefined ? '—' : c.initiative;
      return `
        <div class="${combatantClasses(c)}" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">
          <div class="init-badge">${init}</div>
          <div class="combatant-main">
            <div class="combatant-name">${escapeHtml(c.name)} ${sideTag(c)}</div>
            ${conditions ? `<div class="conditions">${conditions}</div>` : ''}
            ${deathSaves}
          </div>
          <div class="hp">
            <div class="hp-text">${c.hp.value}/${c.hp.max}${c.hp.temp ? ` +${c.hp.temp}` : ''}</div>
            <div class="hp-bar"><div class="hp-fill ${hpClass(ratio)}" style="width:${Math.max(0, Math.min(100, ratio * 100))}%"></div></div>
          </div>
        </div>`;
    })
    .join('');
  els.combatBody.innerHTML = rows;
  renderCombatActions();
}

function selectedNames() {
  if (!lastCombat || !lastCombat.combatants) return [];
  return lastCombat.combatants.filter(c => selectedCombatants.has(c.id)).map(c => c.name);
}

function renderCombatActions() {
  const active = !!(lastCombat && lastCombat.active);
  if (!active || !settings.gmActionsEnabled) {
    els.combatActions.hidden = true;
    els.combatActions.innerHTML = '';
    return;
  }
  els.combatActions.hidden = false;
  const n = selectedCombatants.size;
  els.combatActions.innerHTML = `
    <div class="ca-row">
      <div class="ca-seg" role="group" aria-label="Roll initiative">
        <span class="ca-seg-label">Init</span>
        <button type="button" class="ca-btn" data-init="npcs">NPCs</button>
        <button type="button" class="ca-btn" data-init="all">All</button>
        <button type="button" class="ca-btn" data-init="missing">Missing</button>
      </div>
      <button type="button" class="ca-btn" data-advance>⏭ Advance turn</button>
    </div>${
      n > 0
        ? `
    <div class="ca-row ca-selection">
      <span class="ca-count"><strong>${n}</strong> selected</span>
      <button type="button" class="ca-btn" data-sel="damage">Damage / Heal</button>
      <button type="button" class="ca-btn" data-sel="save">Roll save</button>
      <button type="button" class="ca-btn ghost" data-sel="clear">Clear</button>
    </div>`
        : ''
    }`;
}

// ---------------------------------------------------------------------------
// Event feed (newest on top)
// ---------------------------------------------------------------------------
function addEvents(events) {
  if (!events || events.length === 0) return;
  if (els.feedBody.querySelector('.empty')) els.feedBody.innerHTML = '';

  // events arrive oldest-first; prepend each so newest ends up on top.
  for (const ev of events) {
    if (seenEventIds.has(ev.id)) continue;
    seenEventIds.add(ev.id);
    eventCount += 1;

    const time = new Date(ev.timestampMs).toLocaleTimeString();
    const node = document.createElement('div');
    node.className = `event sev-${ev.eventType}`;
    node.innerHTML = `
      <div class="event-desc">${escapeHtml(ev.description)}</div>
      <div class="event-meta">
        <span class="event-type">${escapeHtml(ev.eventType)}</span>
        <span>${time}</span>
      </div>`;
    els.feedBody.insertBefore(node, els.feedBody.firstChild);
  }

  // Cap DOM size.
  while (els.feedBody.children.length > 120) {
    els.feedBody.removeChild(els.feedBody.lastChild);
  }
  els.feedMeta.textContent = `${eventCount} events`;
}

// ---------------------------------------------------------------------------
// Module diagnostics (newest on top)
// ---------------------------------------------------------------------------
function addErrors(errors) {
  if (!errors || errors.length === 0) return;
  if (els.diagBody.querySelector('.empty')) els.diagBody.innerHTML = '';

  for (const er of errors) {
    if (seenErrorIds.has(er.id)) continue;
    seenErrorIds.add(er.id);
    if (er.level === 'warn') errorCounts.warn += 1;
    else errorCounts.error += 1;

    const time = new Date(er.timestampMs).toLocaleTimeString();
    const mod = (er.module || '').replace(/^(module|system|world):/, '') || 'unknown';
    const node = document.createElement('div');
    node.className = `diag-entry lvl-${er.level === 'warn' ? 'warn' : 'error'}`;
    node.title = er.message + (er.stack ? `\n\n${er.stack}` : '');
    node.innerHTML = `
      <span class="diag-level">${er.level === 'warn' ? 'warn' : 'error'}</span>
      <span class="diag-module">${escapeHtml(mod)}</span>
      <span class="diag-msg">${escapeHtml(er.message)}</span>
      <span class="diag-time">${time}</span>`;
    els.diagBody.insertBefore(node, els.diagBody.firstChild);
  }

  while (els.diagBody.children.length > 150) {
    els.diagBody.removeChild(els.diagBody.lastChild);
  }
  els.diagMeta.textContent = `${errorCounts.error} errors · ${errorCounts.warn} warns`;
}

// ---------------------------------------------------------------------------
// AI commentary
// ---------------------------------------------------------------------------
function commentStart(d) {
  if (els.aiBody.querySelector('.empty')) els.aiBody.innerHTML = '';
  const kindLabel = d.kind === 'ask' ? 'Ask' : d.kind === 'diagnostic' ? 'Diag' : 'Auto';
  const badgeClass = d.kind === 'ask' ? 'ask' : d.kind === 'diagnostic' ? 'diagnostic' : '';
  const card = document.createElement('div');
  card.className = `comment kind-${d.kind}`;
  card.innerHTML = `
    <div class="comment-head">
      <span class="comment-badge ${badgeClass}">${kindLabel} · ${escapeHtml(d.tone || '')}</span>
      <span class="comment-trigger">${escapeHtml(d.trigger || '')}</span>
    </div>
    <div class="comment-body"><span class="cursor">&nbsp;</span></div>
    <div class="comment-foot"></div>`;
  els.aiBody.insertBefore(card, els.aiBody.firstChild);
  comments.set(d.id, { card, body: card.querySelector('.comment-body'), text: '' });
}

function commentDelta(d) {
  const c = comments.get(d.id);
  if (!c) return;
  c.text += d.text;
  c.body.innerHTML = `${escapeHtml(c.text)}<span class="cursor">&nbsp;</span>`;
}

function commentDone(d) {
  const c = comments.get(d.id);
  if (!c) return;
  c.text = d.text || c.text;
  c.body.textContent = c.text;

  const foot = c.card.querySelector('.comment-foot');
  const u = d.usage || {};
  const cache = u.cacheHit
    ? `<span class="hit">cache ✓</span> ${u.cacheReadTokens} read`
    : 'cache miss';
  foot.innerHTML = `<span class="usage-chip">${cache} · ${u.outputTokens || 0} out</span>`;

  const postBtn = document.createElement('button');
  postBtn.className = 'btn btn-post';
  postBtn.textContent = '→ Post to chat';
  postBtn.addEventListener('click', () => {
    postBtn.disabled = true;
    postBtn.textContent = 'Posting…';
    postJson('/api/post-chat', { text: c.text })
      .then(() => {
        postBtn.textContent = '✓ Whispered to GM';
      })
      .catch(() => {
        postBtn.disabled = false;
        postBtn.textContent = '⚠ Retry post';
      });
  });
  foot.appendChild(postBtn);
}

function commentError(d) {
  const c = comments.get(d.id);
  if (!c) return;
  c.card.classList.add('errored');
  c.body.textContent = `⚠ ${d.message || 'generation failed'}`;
}

function commentAborted(d) {
  const c = comments.get(d.id);
  if (!c) return;
  // Superseded by a newer generation; drop the cursor, leave any partial text.
  const cursor = c.body.querySelector('.cursor');
  if (cursor) cursor.remove();
  if (!c.text) c.card.remove();
}

// ---------------------------------------------------------------------------
// SSE wiring
// ---------------------------------------------------------------------------
function connect() {
  const es = new EventSource('/api/stream');
  const on = (type, fn) => es.addEventListener(type, e => fn(JSON.parse(e.data)));

  on('status', renderStatus);
  on('settings', renderSettings);
  on('world', renderWorld);
  on('combat', d => renderCombat(d.combat));
  on('events', d => addEvents(d.events));
  on('errors', d => addErrors(d.errors));
  on('comment.start', commentStart);
  on('comment.delta', commentDelta);
  on('comment.done', commentDone);
  on('comment.error', commentError);
  on('comment.aborted', commentAborted);

  es.onerror = () => {
    setDot(els.statusBridge, 'dot-red', 'Bridge: reconnecting…');
  };
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
els.btnPause.addEventListener('click', () => {
  postJson('/api/control', { action: 'toggle-pause' }).catch(() => {});
});
els.btnDiag.addEventListener('click', () => {
  postJson('/api/control', { action: 'toggle-diag' }).catch(() => {});
});
els.selectTone.addEventListener('change', () => {
  postJson('/api/control', { action: 'set-tone', value: els.selectTone.value }).catch(() => {});
});
els.selectModel.addEventListener('change', () => {
  postJson('/api/control', { action: 'set-model', value: els.selectModel.value }).catch(() => {});
});
els.askForm.addEventListener('submit', e => {
  e.preventDefault();
  const question = els.askInput.value.trim();
  if (!question) return;
  els.askInput.value = '';
  postJson('/api/ask', { question }).catch(err => {
    commentStart({ id: 'err', kind: 'ask', tone: settings.tone, trigger: question });
    commentError({ id: 'err', message: String(err.message || err) });
  });
});

// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// GM Actions — tool runner drawer, confirm modal, toasts
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  [/(initiative|combat|turn)/, 'Combat'],
  [/(damage|heal|saving|ability|attack|roll|check|rest|activity|condition|effect)/, 'Resolution'],
  [/(token|move|template|vision|light|map-note)/, 'Tokens & Scene'],
  [/(scene|map|mood)/, 'Scenes & Maps'],
  [/(actor|npc|character|feature|archetype|ownership)/, 'Actors'],
  [/(item|loot|resource)/, 'Items & Loot'],
  [/(quest|journal|campaign)/, 'Journals & Quests'],
  [/(compendium|creature)/, 'Compendium'],
];
function categoryOf(name) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat;
  return 'World & Info';
}
function findTool(name) {
  return toolCatalog.find(t => t.name === name);
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  els.toastStack.appendChild(el);
  setTimeout(
    () => {
      el.style.transition = 'opacity .3s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    },
    kind === 'err' ? 6000 : 3500
  );
}

// --- Confirm modal (promise-based) ---
function confirmAction({ title, name, args, destructive }) {
  els.modalTitle.textContent = title;
  const argText =
    args && Object.keys(args).length ? JSON.stringify(args, null, 2) : '(no arguments)';
  els.modalBody.innerHTML = `Run <code>${escapeHtml(name)}</code> against the live game?<pre>${escapeHtml(argText)}</pre>`;
  els.modalDestructive.hidden = !destructive;
  els.modalDestructiveCheck.checked = false;
  els.modalConfirm.textContent = destructive ? 'Run destructive action' : 'Confirm';
  els.modalConfirm.disabled = !!destructive;
  els.modalBackdrop.hidden = false;
  return new Promise(resolve => {
    confirmResolver = resolve;
  });
}
function closeModal(result) {
  els.modalBackdrop.hidden = true;
  const r = confirmResolver;
  confirmResolver = null;
  if (r) r(result);
}

// --- Drawer ---
function updateGate() {
  if (els.gmGate) els.gmGate.hidden = !!settings.gmActionsEnabled;
}
function openDrawer() {
  els.drawerBackdrop.hidden = false;
  els.drawer.hidden = false;
  updateGate();
  if (!toolsLoaded) void loadTools();
}
function closeDrawer() {
  els.drawer.hidden = true;
  els.drawerBackdrop.hidden = true;
}
function showBrowser() {
  els.toolDetail.hidden = true;
  els.toolBrowser.hidden = false;
}

// --- Tool catalog + list ---
async function loadTools(force) {
  try {
    const res = await fetch('/api/tools' + (force ? '?refresh=1' : ''));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toolCatalog = Array.isArray(data.tools) ? data.tools : [];
    toolsLoaded = true;
    renderToolList(els.toolSearch.value);
  } catch (err) {
    els.toolList.innerHTML = `<p class="empty">Couldn't load tools: ${escapeHtml(String(err.message || err))}</p>`;
  }
}
function renderToolList(filter) {
  const q = (filter || '').trim().toLowerCase();
  const matched = toolCatalog.filter(
    t => !q || t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)
  );
  if (matched.length === 0) {
    els.toolList.innerHTML = `<p class="empty">No tools match that search.</p>`;
    return;
  }
  const groups = new Map();
  for (const t of matched) {
    const cat = categoryOf(t.name);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(t);
  }
  let html = '';
  for (const [cat, tools] of groups) {
    html += `<div class="tool-cat">${escapeHtml(cat)}</div>`;
    for (const t of tools) {
      html += `
        <button type="button" class="tool-item" data-tool="${escapeHtml(t.name)}">
          <span class="tool-item-main">
            <span class="tool-item-name">${escapeHtml(t.name)}</span>
            <span class="tool-item-desc">${escapeHtml(t.description || '')}</span>
          </span>
          <span class="tool-kind ${escapeHtml(t.mutates)}">${escapeHtml(t.mutates)}</span>
        </button>`;
    }
  }
  els.toolList.innerHTML = html;
}

// --- Tool detail / form ---
async function openTool(name, prefill) {
  openDrawer();
  if (!toolsLoaded) await loadTools();
  const tool = findTool(name);
  if (!tool) {
    toast(`Tool "${name}" isn't in the catalog.`, 'warn');
    return;
  }
  els.toolBrowser.hidden = true;
  els.toolDetail.hidden = false;
  els.toolResult.hidden = true;
  els.toolResult.innerHTML = '';
  els.toolDetailName.textContent = tool.name;
  els.toolDetailKind.textContent = tool.mutates;
  els.toolDetailKind.className = `tool-kind ${tool.mutates}`;
  els.toolDetailDesc.textContent = tool.description || '';
  buildForm(tool, prefill || {});
}
function buildControl(def, prefillVal) {
  if (Array.isArray(def.enum)) {
    const sel = document.createElement('select');
    sel.className = 'field-control';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— choose —';
    sel.appendChild(blank);
    for (const v of def.enum) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = String(v);
      sel.appendChild(opt);
    }
    if (prefillVal !== undefined) sel.value = String(prefillVal);
    else if (def.default !== undefined) sel.value = String(def.default);
    return sel;
  }
  if (def.type === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    if (prefillVal === true || (prefillVal === undefined && def.default === true))
      cb.checked = true;
    return cb;
  }
  if (def.type === 'array') {
    const ta = document.createElement('textarea');
    ta.className = 'field-control';
    ta.placeholder = 'One value per line';
    if (Array.isArray(prefillVal)) ta.value = prefillVal.join('\n');
    return ta;
  }
  if (def.type === 'object') {
    const ta = document.createElement('textarea');
    ta.className = 'field-control';
    ta.placeholder = '{ } JSON';
    if (prefillVal && typeof prefillVal === 'object')
      ta.value = JSON.stringify(prefillVal, null, 2);
    return ta;
  }
  const input = document.createElement('input');
  input.className = 'field-control';
  input.type = def.type === 'number' || def.type === 'integer' ? 'number' : 'text';
  if (def.type === 'integer') input.step = '1';
  if (prefillVal !== undefined) input.value = String(prefillVal);
  else if (def.default !== undefined) input.value = String(def.default);
  return input;
}
function buildForm(tool, prefill) {
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const form = els.toolForm;
  form.innerHTML = '';
  const keys = Object.keys(props);
  for (const key of keys) {
    const def = props[key] || {};
    const field = document.createElement('div');
    field.className = 'field';
    field.dataset.key = key;
    field.dataset.type = def.type || 'string';
    const control = buildControl(def, prefill[key]);
    const label = document.createElement('label');
    label.innerHTML = `${escapeHtml(key)}${required.includes(key) ? '<span class="field-req">*</span>' : ''}`;
    if (def.type === 'boolean') {
      field.classList.add('field-check');
      field.appendChild(control);
      field.appendChild(label);
    } else {
      field.appendChild(label);
      field.appendChild(control);
    }
    if (def.description) {
      const hint = document.createElement('div');
      hint.className = 'field-hint';
      hint.textContent = def.description;
      field.appendChild(hint);
    }
    form.appendChild(field);
  }
  if (keys.length === 0) {
    const p = document.createElement('p');
    p.className = 'field-hint';
    p.textContent = 'This tool takes no parameters.';
    form.appendChild(p);
  }
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const run = document.createElement('button');
  run.type = 'submit';
  run.className = 'btn btn-primary';
  run.textContent = tool.mutates === 'read' ? 'Run' : 'Run…';
  const err = document.createElement('span');
  err.className = 'form-error';
  actions.appendChild(run);
  actions.appendChild(err);
  form.appendChild(actions);
  form.onsubmit = e => {
    e.preventDefault();
    void submitToolForm(tool);
  };
}
function coerceScalar(raw, def) {
  if (def.type === 'number') return Number(raw);
  if (def.type === 'integer') return parseInt(raw, 10);
  return raw;
}
function collectArgs(tool, form) {
  const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {};
  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const args = {};
  const missing = [];
  for (const field of form.querySelectorAll('.field')) {
    const key = field.dataset.key;
    if (!key) continue;
    const def = props[key] || {};
    const control = field.querySelector('.field-control, input[type=checkbox]');
    if (!control) continue;
    if (def.type === 'boolean') {
      if (!control.checked && !required.includes(key)) continue;
      args[key] = control.checked;
      continue;
    }
    if (def.type === 'array') {
      const items = control.value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      if (items.length === 0) {
        if (required.includes(key)) missing.push(key);
        continue;
      }
      const it = def.items && def.items.type;
      args[key] = items.map(s => (it === 'number' || it === 'integer' ? Number(s) : s));
      continue;
    }
    const raw = (control.value || '').trim();
    if (!raw) {
      if (required.includes(key)) missing.push(key);
      continue;
    }
    if (def.type === 'object') {
      try {
        args[key] = JSON.parse(raw);
      } catch {
        throw new Error(`"${key}" must be valid JSON.`);
      }
    } else {
      args[key] = coerceScalar(raw, def);
    }
  }
  if (missing.length) throw new Error(`Required: ${missing.join(', ')}`);
  return args;
}
async function submitToolForm(tool) {
  const errEl = els.toolForm.querySelector('.form-error');
  if (errEl) errEl.textContent = '';
  let args;
  try {
    args = collectArgs(tool, els.toolForm);
  } catch (e) {
    if (errEl) errEl.textContent = String(e.message || e);
    return;
  }
  await runTool(tool.name, args, tool.mutates, { showResultInDrawer: true });
}
function showToolResult(ok, payload) {
  els.toolResult.hidden = false;
  els.toolResult.className = `tool-result ${ok ? 'ok' : 'err'}`;
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  els.toolResult.innerHTML = `<strong>${ok ? 'Result' : 'Error'}</strong><pre>${escapeHtml(text)}</pre>`;
}

// --- Run a tool (confirm-gated for writes) ---
async function runTool(name, args, mutates, opts = {}) {
  const found = findTool(name);
  const kind = mutates || (found && found.mutates) || 'write';
  let confirmFlags = {};
  if (kind !== 'read') {
    if (!settings.gmActionsEnabled) {
      toast('GM Actions are off — enable them to run this.', 'warn');
      openDrawer();
      return;
    }
    const ok = await confirmAction({
      title: kind === 'destructive' ? 'Destructive action' : 'Confirm action',
      name,
      args,
      destructive: kind === 'destructive',
    });
    if (!ok) return;
    confirmFlags =
      kind === 'destructive' ? { confirm: true, confirmDestructive: true } : { confirm: true };
  }
  try {
    const res = await fetch('/api/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, args: args || {}, ...confirmFlags }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      toast(`✓ ${name}`, 'ok');
      if (opts.showResultInDrawer) showToolResult(true, data.result);
      return data;
    }
    const msg = data.error || `HTTP ${res.status}`;
    if (res.status === 403) {
      toast('GM Actions are off — enable them first.', 'warn');
      openDrawer();
    } else {
      toast(`✗ ${name}: ${msg}`, 'err');
    }
    if (opts.showResultInDrawer) showToolResult(false, msg);
  } catch (err) {
    const msg = String(err.message || err);
    toast(`✗ ${name}: ${msg}`, 'err');
    if (opts.showResultInDrawer) showToolResult(false, msg);
  }
}

// --- Wiring ---
els.btnGm.addEventListener('click', () => {
  postJson('/api/control', { action: 'toggle-gm-actions' }).catch(() => {});
});
els.btnTools.addEventListener('click', () => {
  openDrawer();
  showBrowser();
});
els.drawerClose.addEventListener('click', closeDrawer);
els.drawerBackdrop.addEventListener('click', closeDrawer);
els.gmGateEnable.addEventListener('click', () => {
  postJson('/api/control', { action: 'set-gm-actions', value: true }).catch(() => {});
});
els.toolSearch.addEventListener('input', () => renderToolList(els.toolSearch.value));
els.toolBack.addEventListener('click', showBrowser);
els.toolList.addEventListener('click', e => {
  const b = e.target.closest('[data-tool]');
  if (b) void openTool(b.dataset.tool);
});
els.combatBody.addEventListener('click', e => {
  if (!settings.gmActionsEnabled) return;
  const row = e.target.closest('.combatant');
  if (!row || !row.dataset.id) return;
  const id = row.dataset.id;
  if (selectedCombatants.has(id)) selectedCombatants.delete(id);
  else selectedCombatants.add(id);
  row.classList.toggle('selected');
  renderCombatActions();
});
els.combatActions.addEventListener('click', e => {
  const initBtn = e.target.closest('[data-init]');
  if (initBtn) {
    void runTool('roll-initiative-for-npcs', { scope: initBtn.dataset.init }, 'write');
    return;
  }
  if (e.target.closest('[data-advance]')) {
    void runTool('advance-combat-turn', {}, 'write');
    return;
  }
  const selBtn = e.target.closest('[data-sel]');
  if (!selBtn) return;
  const action = selBtn.dataset.sel;
  if (action === 'clear') {
    selectedCombatants.clear();
    renderCombat(lastCombat);
    return;
  }
  const names = selectedNames();
  if (names.length === 0) return;
  if (action === 'damage') void openTool('apply-damage-and-healing', { targets: names });
  if (action === 'save') void openTool('roll-saving-throws', { targets: names });
});
els.modalCancel.addEventListener('click', () => closeModal(false));
els.modalConfirm.addEventListener('click', () => closeModal(true));
els.modalBackdrop.addEventListener('click', e => {
  if (e.target === els.modalBackdrop) closeModal(false);
});
els.modalDestructiveCheck.addEventListener('change', () => {
  els.modalConfirm.disabled = !els.modalDestructiveCheck.checked;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!els.modalBackdrop.hidden) closeModal(false);
  else if (!els.drawer.hidden) closeDrawer();
});

connect();
