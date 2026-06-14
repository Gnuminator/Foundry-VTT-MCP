/**
 * Foundry MCP Bridge — In-Game Test Bench
 * =======================================
 *
 * Runs every MCP query handler directly inside the live Foundry world (GM client)
 * and prints a PASS/FAIL table to the console plus a whispered chat summary.
 *
 * This exercises the *Foundry half* of every tool (query handler -> data-access ->
 * live game API) without needing Claude Desktop or the WebRTC transport — so it
 * isolates "does the game integration work" from "does the transport work".
 *
 * HOW TO RUN
 *   1. Log in to your world as a GM.
 *   2. Create a Script macro (or open the browser console, F12) and paste this file.
 *   3. Execute. Read the console table; a summary is whispered to you in chat.
 *
 * READ tests are always safe. WRITE tests (which post chat messages, roll dice,
 * or touch actor/combat state) only run when RUN_WRITE_TESTS = true below, and are
 * written to be as low-impact as possible (no-op resource writes, self-whispers).
 */

(async () => {
  const MODULE_ID = 'foundry-mcp-bridge';
  const RUN_WRITE_TESTS = false; // flip to true to also exercise write tools

  if (!game.user?.isGM) {
    ui.notifications?.error('MCP Test Bench must be run as a GM.');
    return;
  }

  const call = (method, data = {}) => {
    const fn = CONFIG.queries?.[`${MODULE_ID}.${method}`];
    if (typeof fn !== 'function') {
      throw new Error(`query "${method}" is not registered (is the module the v0.9.0 build?)`);
    }
    return fn(data);
  };

  // --- Pick reasonable test targets from the live world ----------------------
  const pcs = game.actors.filter(a => a.hasPlayerOwner && a.type === 'character');
  const targetActor =
    pcs[0] || game.actors.find(a => a.type === 'character') || game.actors.contents[0];
  const tokenNames = (canvas?.tokens?.placeables ?? []).map(t => t.name).filter(Boolean);
  const combat = game.combat;

  if (!targetActor) ui.notifications?.warn('No actor found — actor-scoped tests will be skipped.');

  /** @type {{name:string, kind:'read'|'write', skip?:string, run:()=>Promise<any>}[]} */
  const tests = [
    // ---- READ ----
    { name: 'ping', kind: 'read', run: () => call('ping') },
    { name: 'getWorldInfo', kind: 'read', run: () => call('getWorldInfo') },
    { name: 'getActiveScene', kind: 'read', run: () => call('getActiveScene') },
    { name: 'getAvailableConditions', kind: 'read', run: () => call('getAvailableConditions') },
    { name: 'get-chat-log', kind: 'read', run: () => call('getChatLog', { limit: 10 }) },
    { name: 'get-session-log', kind: 'read', run: () => call('getSessionLog', { limit: 10 }) },
    { name: 'get-combat-play-by-play', kind: 'read', run: () => call('getCombatPlayByPlay') },
    { name: 'get-combat-state', kind: 'read', run: () => call('getCombatState') },
    { name: 'get-token-positions', kind: 'read', run: () => call('getTokenPositions', {}) },
    {
      name: 'measure-distance',
      kind: 'read',
      skip: tokenNames.length < 2 ? 'need >=2 tokens on scene' : undefined,
      run: () =>
        call('measureDistance', { fromTokenName: tokenNames[0], toTokenName: tokenNames[1] }),
    },
    {
      name: 'get-character-resources',
      kind: 'read',
      skip: targetActor ? undefined : 'no actor',
      run: () => call('getCharacterResources', { identifier: targetActor.name }),
    },
    {
      name: 'get-active-effects',
      kind: 'read',
      skip: targetActor ? undefined : 'no actor',
      run: () => call('getActiveEffects', { identifier: targetActor.name }),
    },

    // ---- WRITE (gated by RUN_WRITE_TESTS) ----
    {
      name: 'send-chat-message',
      kind: 'write',
      run: () =>
        call('sendChatMessage', {
          message: '[MCP Test Bench] send-chat-message OK',
          messageType: 'whisper',
          whisperTargets: [game.user.name],
        }),
    },
    {
      name: 'roll-npc-check',
      kind: 'write',
      skip: targetActor ? undefined : 'no actor',
      run: () =>
        call('rollNpcCheck', {
          actorName: targetActor.name,
          rollType: 'ability',
          rollTarget: 'dex',
          isPublic: false,
        }),
    },
    {
      name: 'request-ability-check',
      kind: 'write',
      skip: targetActor ? undefined : 'no actor',
      run: () =>
        call('requestAbilityCheck', {
          targetPlayer: targetActor.name,
          ability: 'wis',
          dc: 12,
          isPublic: false,
          reason: '[MCP Test Bench] click this button to verify roll requests work',
        }),
    },
    {
      name: 'update-character-resource (no-op)',
      kind: 'write',
      skip: targetActor ? undefined : 'no actor',
      run: async () => {
        // Read a current resource and write the same value back (no state change).
        const res = await call('getCharacterResources', { identifier: targetActor.name });
        const lvl = Object.keys(res.spellSlots || {}).find(k => k.startsWith('level'));
        if (lvl) {
          const n = lvl.replace('level', '');
          return call('updateCharacterResource', {
            identifier: targetActor.name,
            resourceName: `spell${n}`,
            newValue: res.spellSlots[lvl].current,
          });
        }
        const cr = (res.classResources || [])[0];
        if (cr && cr.current != null) {
          return call('updateCharacterResource', {
            identifier: targetActor.name,
            resourceName: cr.key,
            newValue: cr.current,
          });
        }
        return { skipped: 'no spell slots or class resources to no-op write' };
      },
    },
    {
      name: 'set-initiative (no-op)',
      kind: 'write',
      skip: combat?.combatant ? undefined : 'no active combatant',
      run: () =>
        call('setInitiative', {
          combatantName: combat.combatant.name,
          initiative: combat.combatant.initiative ?? 10,
        }),
    },
    {
      name: 'clear-stale-conditions (expired only)',
      kind: 'write',
      skip: targetActor ? undefined : 'no actor',
      run: () => call('clearStaleConditions', { identifier: targetActor.name }),
    },
  ];

  // --- Run -------------------------------------------------------------------
  const rows = [];
  let pass = 0;
  let fail = 0;
  let skipped = 0;

  for (const t of tests) {
    if (t.kind === 'write' && !RUN_WRITE_TESTS) {
      rows.push({
        test: t.name,
        kind: t.kind,
        result: 'SKIP (write tests off)',
        ms: 0,
        detail: '',
      });
      skipped++;
      continue;
    }
    if (t.skip) {
      rows.push({ test: t.name, kind: t.kind, result: `SKIP (${t.skip})`, ms: 0, detail: '' });
      skipped++;
      continue;
    }
    const start = performance.now();
    try {
      const out = await t.run();
      const ms = Math.round(performance.now() - start);
      const errored = out && out.success === false;
      if (errored) {
        rows.push({
          test: t.name,
          kind: t.kind,
          result: 'FAIL',
          ms,
          detail: out.error || 'success:false',
        });
        fail++;
      } else {
        let detail = '';
        try {
          detail = JSON.stringify(out).slice(0, 140);
        } catch {
          detail = '[unserializable]';
        }
        rows.push({ test: t.name, kind: t.kind, result: 'PASS', ms, detail });
        pass++;
      }
    } catch (err) {
      const ms = Math.round(performance.now() - start);
      rows.push({
        test: t.name,
        kind: t.kind,
        result: 'FAIL',
        ms,
        detail: err?.message || String(err),
      });
      fail++;
    }
  }

  console.log(
    `%c[MCP Test Bench] ${pass} passed, ${fail} failed, ${skipped} skipped`,
    'font-weight:bold'
  );
  console.table(rows);
  console.log(
    '[MCP Test Bench] target actor:',
    targetActor?.name,
    '| tokens:',
    tokenNames.length,
    '| combat:',
    !!combat
  );

  const lines = rows
    .map(r => {
      const icon = r.result === 'PASS' ? '✅' : r.result.startsWith('SKIP') ? '⚪' : '❌';
      return `${icon} <b>${r.test}</b> — ${r.result}${r.ms ? ` (${r.ms}ms)` : ''}`;
    })
    .join('<br>');

  await ChatMessage.create({
    content: `<h3>MCP Test Bench</h3><p>${pass} passed · ${fail} failed · ${skipped} skipped${
      RUN_WRITE_TESTS ? '' : ' <i>(write tests off)</i>'
    }</p>${lines}<hr><small>Full details + JSON in the browser console (F12).</small>`,
    whisper: [game.user.id],
    speaker: { alias: 'MCP Test Bench' },
  });

  ui.notifications?.info(
    `MCP Test Bench: ${pass} passed, ${fail} failed, ${skipped} skipped (see console).`
  );
})();
