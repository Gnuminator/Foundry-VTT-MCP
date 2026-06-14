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
  selectTone: $('select-tone'),
  selectModel: $('select-model'),
  combatMeta: $('combat-meta'),
  combatBody: $('combat-body'),
  feedMeta: $('feed-meta'),
  feedBody: $('feed-body'),
  aiMeta: $('ai-meta'),
  aiBody: $('ai-body'),
  askForm: $('ask-form'),
  askInput: $('ask-input'),
};

const seenEventIds = new Set();
let eventCount = 0;
const comments = new Map(); // genId -> { card, body, doneText }
let settings = { paused: false, tone: 'tactical', model: 'claude-opus-4-8', aiEnabled: false };

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
  if (settings.aiEnabled) {
    setDot(els.statusAi, 'dot-green', `AI: ${settings.paused ? 'paused' : 'on'}`);
  } else {
    setDot(els.statusAi, 'dot-red', 'AI: disabled');
    els.btnPause.disabled = true;
    els.askInput.placeholder = 'Set ANTHROPIC_API_KEY to enable the co-GM';
  }
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

function renderCombat(combat) {
  if (!combat || !combat.active) {
    els.combatMeta.textContent = '—';
    els.combatBody.innerHTML = '<p class="empty">No active combat.</p>';
    return;
  }
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
        <div class="combatant ${c.isCurrentTurn ? 'current' : ''} ${c.defeated ? 'defeated' : ''}">
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
// AI commentary
// ---------------------------------------------------------------------------
function commentStart(d) {
  if (els.aiBody.querySelector('.empty')) els.aiBody.innerHTML = '';
  const card = document.createElement('div');
  card.className = `comment kind-${d.kind}`;
  card.innerHTML = `
    <div class="comment-head">
      <span class="comment-badge ${d.kind === 'ask' ? 'ask' : ''}">${d.kind === 'ask' ? 'Ask' : 'Auto'} · ${escapeHtml(d.tone || '')}</span>
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

connect();
