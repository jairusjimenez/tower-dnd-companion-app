(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let session = null; // { role: 'dm' | 'player', email?, username?, characterId?, name }
  let state = null;
  let sse = null;
  let invFilter = 'all';
  let playerMapTool = 'move';
  let dmMapTool = 'move';
  let dmSelectedTokenId = null;
  let activeBeatMapId = null;
  let arenaSelectedTokenId = null;
  let arenaTool = 'move';
  let arenaCellOverride = null;
  let arenaMeasureStart = null;
  let arenaMeasureEnd = null;
  const portraitImageCache = new Map();

  function getPortraitImage(url) {
    if (!url) return null;
    if (portraitImageCache.has(url)) {
      const entry = portraitImageCache.get(url);
      return entry.loaded ? entry.img : null;
    }
    const img = new Image();
    const record = { img, loaded: false };
    portraitImageCache.set(url, record);
    img.onload = () => {
      record.loaded = true;
      if (activeBeatMapId && !$('#beat-map-modal').classList.contains('hidden')) {
        renderBeatMapModal();
      }
      if (state) {
        if (session?.role === 'dm') drawTowerCanvas('dm-tower-canvas', true);
        else drawTowerCanvas('player-tower-canvas', false);
      }
    };
    img.src = url;
    return null;
  }

  function drawTokenAvatar(ctx, tok, cx, cy, r, selected) {
    const ch = tok.type === 'player' ? state?.characters?.[tok.id] : null;
    const img = ch?.portraitUrl ? getPortraitImage(ch.portraitUrl) : null;

    ctx.save();
    if (tok.hiddenFromPlayers) ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();

    if (img) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    } else {
      ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : (tok.color || '#38bdf8');
      ctx.fill();
      ctx.fillStyle = '#020617';
      ctx.font = `bold ${Math.max(9, Math.floor(r * 0.72))}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tok.label || tok.name.slice(0, 2).toUpperCase(), cx, cy + Math.floor(r * 0.25));
    }

    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? '#fbbf24' : (tok.type === 'monster' ? '#fca5a5' : '#7dd3fc');
    ctx.stroke();
    ctx.restore();
  }
  let measureStart = null;
  let measureEnd = null;
  let seenToastIds = new Set();

  function esc(str) {
    return String(str ?? '').replace(/[<>&"']/g, (c) => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Client-side lightweight formula evaluator for instant attribute preview
  function evalLocalFormula(expr, vars) {
    try {
      const safeVars = {};
      for (const [k, v] of Object.entries(vars || {})) safeVars[k.toUpperCase()] = Number(v || 0);
      let s = String(expr || '0')
        .replace(/\bfloor\b/gi, 'Math.floor')
        .replace(/\bceil\b/gi, 'Math.ceil')
        .replace(/\bround\b/gi, 'Math.round')
        .replace(/\bmin\b/gi, 'Math.min')
        .replace(/\bmax\b/gi, 'Math.max')
        .replace(/\babs\b/gi, 'Math.abs');
      s = s.replace(/\b[A-Z_][A-Z0-9_]*\b/g, (id) => (id in safeVars ? String(safeVars[id]) : id));
      if (!/^[0-9+\-*/%().,\sMathfloceilrundinaxbs]+$/.test(s)) return 0;
      const val = Function(`"use strict"; return (${s});`)();
      return Number.isFinite(val) ? Math.trunc(val) : 0;
    } catch {
      return 0;
    }
  }

  function showToast(toast) {
    if (!toast || !toast.message) return;
    if (toast.id && seenToastIds.has(toast.id)) return;
    if (toast.id) seenToastIds.add(toast.id);

    const stack = $('#toast-stack');
    const card = document.createElement('div');
    card.className = `toast-card ${toast.category || 'info'}`;
    card.innerHTML = `
      <div>
        <div class="toast-title">[${esc(toast.title || 'SYSTEM NOTICE')}]</div>
        <div class="toast-body">${esc(toast.message)}</div>
      </div>
      <button type="button" class="toast-close" aria-label="Dismiss">&times;</button>
    `;
    card.querySelector('.toast-close').addEventListener('click', () => card.remove());
    stack.prepend(card);
    setTimeout(() => card.remove(), 8000);
  }

  async function api(path, body = null) {
    const opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET' };
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  }

  async function sendAction(type, payload = {}) {
    if (!session) return;
    try {
      const res = await api('/api/action', {
        type,
        payload,
        role: session.role,
        characterId: session.characterId || null,
      });
      await refreshState();
      return res;
    } catch (err) {
      showToast({ title: 'ACTION ERROR', message: err.message, category: 'warning' });
      throw err;
    }
  }

  async function refreshState() {
    if (!session) return;
    const qs = new URLSearchParams({ role: session.role });
    if (session.characterId) qs.set('characterId', session.characterId);
    state = await api(`/api/state?${qs.toString()}`);
    renderAll();
  }

  function connectSse() {
    if (sse) {
      sse.close();
      sse = null;
    }
    if (!session) return;
    const qs = new URLSearchParams({ role: session.role });
    if (session.characterId) qs.set('characterId', session.characterId);
    sse = new EventSource(`/api/events?${qs.toString()}`);
    sse.addEventListener('state', (ev) => {
      try {
        state = JSON.parse(ev.data);
        renderAll();
      } catch {}
    });
    sse.addEventListener('toast', (ev) => {
      try {
        const toast = JSON.parse(ev.data);
        showToast(toast);
      } catch {}
    });
  }

  function enterSession(newSession) {
    session = newSession;
    localStorage.setItem('tower_vtt_session', JSON.stringify(session));
    $('#login-view').classList.remove('active');
    if (session.role === 'dm') {
      $('#player-view').classList.remove('active');
      $('#dm-view').classList.add('active');
    } else {
      $('#dm-view').classList.remove('active');
      $('#player-view').classList.add('active');
    }
    refreshState().then(connectSse);
  }

  function logout() {
    if (sse) sse.close();
    sse = null;
    session = null;
    state = null;
    localStorage.removeItem('tower_vtt_session');
    $('#player-view').classList.remove('active');
    $('#dm-view').classList.remove('active');
    $('#login-view').classList.add('active');
  }

  // -------------------------------------------------------------------------
  // Auth / Unified Login Handler (routes to DM or Player by credentials)
  // -------------------------------------------------------------------------
  $('#player-login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errBox = $('#player-login-error');
    errBox.classList.add('hidden');
    try {
      const res = await api('/api/auth/login', {
        identifier: $('#login-identifier').value.trim(),
        password: $('#login-password').value,
      });
      enterSession(res.session);
      if (res.firstTimeActivated) {
        showToast({
          title: 'ACCOUNT ACTIVATED',
          message: 'Password saved! You can update your username or password anytime under Account.',
          category: 'info',
        });
      }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  // -------------------------------------------------------------------------
  // Navigation Tabs
  // -------------------------------------------------------------------------
  $$('#player-nav .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#player-nav .nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.pTab;
      $$('[data-p-pane]').forEach((p) => p.classList.toggle('active', p.dataset.pPane === tab));
      if (tab === 'map') drawTowerCanvas('player-tower-canvas', false);
    });
  });

  $$('#dm-nav .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#dm-nav .nav-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.dmTab;
      $$('[data-dm-pane]').forEach((p) => p.classList.toggle('active', p.dataset.dmPane === tab));
      if (tab === 'map') drawTowerCanvas('dm-tower-canvas', true);
    });
  });

  $('#btn-p-logout').addEventListener('click', logout);
  $('#btn-dm-logout').addEventListener('click', logout);

  // Account Modal
  $('#btn-open-account-modal').addEventListener('click', () => {
    $('#acc-email').value = session?.email || '';
    $('#acc-new-username').value = session?.username || '';
    $('#acc-current-pw').value = '';
    $('#acc-new-pw').value = '';
    $('#acc-msg').textContent = '';
    $('#account-modal').classList.remove('hidden');
  });
  $('#btn-close-account-modal').addEventListener('click', () => $('#account-modal').classList.add('hidden'));
  $('#account-update-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const res = await api('/api/auth/update-credentials', {
        email: session.email,
        currentPassword: $('#acc-current-pw').value,
        newUsername: $('#acc-new-username').value.trim(),
        newPassword: $('#acc-new-pw').value,
      });
      session.username = res.username;
      localStorage.setItem('tower_vtt_session', JSON.stringify(session));
      $('#acc-msg').textContent = `Updated! Username is now "${res.username}".`;
      showToast({ title: 'CREDENTIALS UPDATED', message: `Username set to ${res.username}.`, category: 'info' });
    } catch (err) {
      $('#acc-msg').textContent = err.message;
    }
  });

  // -------------------------------------------------------------------------
  // Space Distance Helper
  // -------------------------------------------------------------------------
  function spaceDistanceBetween(idA, idB) {
    const a = state?.map?.tokens?.find((t) => t.id === idA);
    const b = state?.map?.tokens?.find((t) => t.id === idB);
    if (!a || !b) return null;
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  // -------------------------------------------------------------------------
  // Render Everything
  // -------------------------------------------------------------------------
  function renderAll() {
    if (!state || !session) return;
    if (session.role === 'dm') renderDm();
    else renderPlayer();
  }

  function renderPlayer() {
    const ch = state.characters?.[session.characterId];
    if (!ch) return;

    // Header
    $('#p-top-avatar').src = ch.portraitUrl || '';
    $('#p-top-name').textContent = ch.name;
    $('#p-top-rank').textContent = `${ch.rank} • Lv ${ch.level}`;
    $('#p-top-hp').textContent = `${ch.hp}/${ch.maxHp}`;
    $('#p-top-mp').textContent = `${ch.mp}/${ch.maxMp}`;
    $('#p-resource-label').textContent = (state.mechanics?.resourceName || 'MP').split(' ')[0];
    $('#p-mp-name').textContent = state.mechanics?.resourceName || 'Mana (MP)';

    const isLive = state.session?.status === 'active';
    const sessPill = $('#p-session-pill');
    sessPill.textContent = isLive ? 'SESSION LIVE' : 'SESSION PAUSED';
    sessPill.className = `status-pill ${isLive ? 'live' : 'stopped'}`;
    $('#p-session-stopped-banner').classList.toggle('hidden', isLive);
    $('#p-session-paused-msg').textContent = state.session?.pausedMessage || 'Waiting for DM...';

    const isReactive = state.mechanics?.combatMode !== 'turn_based';
    const modePill = $('#p-combat-mode-pill');
    modePill.textContent = isReactive ? 'REACTIVE COMBAT' : 'TURN-BASED';
    modePill.className = `status-pill ${isReactive ? 'reactive' : ''}`;

    // Reactive Attack Banner
    const pending = (state.pendingReactions || []).find((r) => r.targetCharacterId === ch.id);
    const reactBanner = $('#p-reaction-banner');
    reactBanner.classList.toggle('hidden', !pending);
    if (pending) {
      reactBanner.dataset.reactionId = pending.id;
      $('#p-reaction-text').textContent = `${pending.monsterName} strikes you (${pending.attackTotal} to hit, ${pending.incomingDamage} incoming dmg)! React immediately!`;
    }

    // Vitals & Stats
    $('#p-hp-readout').textContent = `${ch.hp} / ${ch.maxHp}${ch.tempHp ? ` (+${ch.tempHp} Temp)` : ''}`;
    $('#p-hp-fill').style.width = `${Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100))}%`;
    $('#p-mp-readout').textContent = `${ch.mp} / ${ch.maxMp}`;
    $('#p-mp-fill').style.width = `${ch.maxMp ? Math.max(0, Math.min(100, (ch.mp / ch.maxMp) * 100)) : 0}%`;
    const xpNext = ch.xpToNext || ch.level * 100;
    $('#p-xp-readout').textContent = `Lv ${ch.level} • ${ch.xp || 0} / ${xpNext} XP`;
    $('#p-xp-fill').style.width = `${Math.max(0, Math.min(100, ((ch.xp || 0) / xpNext) * 100))}%`;

    const unspentPts = Number(ch.unspentStatPoints || 0);
    const ptsPill = $('#p-stat-points-pill');
    ptsPill.textContent = `+${unspentPts} Pts Available`;
    ptsPill.classList.toggle('hidden', unspentPts <= 0);

    $('#p-ac-val').textContent = ch.ac;
    $('#p-dr-val').textContent = ch.dr;
    $('#p-speed-val').textContent = `${ch.speedSpaces || 6} Spaces`;
    $('#p-favor-val').textContent = ch.favor || 0;
    $('#p-formula-badge').textContent = state.mechanics?.statFormula || 'floor((SCORE-10)/2)';

    const statsGrid = $('#p-stats-grid');
    statsGrid.innerHTML = (state.mechanics?.stats || []).map((st) => {
      const score = Number(ch.stats?.[st.key] ?? st.defaultValue ?? 10);
      const mod = evalLocalFormula(state.mechanics.statFormula, { ...ch.stats, SCORE: score, LEVEL: ch.level });
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      return `
        <div class="stat-card">
          <div class="stat-key">${esc(st.key)}</div>
          <div class="stat-mod">${esc(modStr)}</div>
          <input type="number" data-stat-input="${esc(st.key)}" value="${score}" />
          <div class="btn-row mt-xs" style="justify-content:center;">
            ${unspentPts > 0 ? `<button type="button" class="btn btn-xs btn-gold" data-alloc-stat="${esc(st.key)}">+1</button>` : ''}
            <button type="button" class="btn btn-xs btn-outline" data-roll-stat="${esc(st.key)}" data-stat-mod="${mod}">d20${esc(modStr)}</button>
          </div>
        </div>
      `;
    }).join('');

    $('#p-skills-list').innerHTML = (ch.skills || []).map((sk) => {
      const baseScore = Number(ch.stats?.[sk.stat] ?? 10);
      const mod = evalLocalFormula(state.mechanics.statFormula, { ...ch.stats, SCORE: baseScore }) + Number(sk.bonus || 0);
      const sign = mod >= 0 ? `+${mod}` : `${mod}`;
      return `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(sk.name)} <span class="muted small">(${esc(sk.stat)})</span></strong>
            <button type="button" class="btn btn-xs btn-cyan" data-roll-skill="${esc(sk.name)}" data-skill-mod="${mod}">Roll ${esc(sign)}</button>
          </div>
        </div>
      `;
    }).join('');

    // Active Story Beat Banner for Players
    const activeBeat = (state.storyBeats || []).slice().reverse().find((b) => b.presented && b.status === 'active')
      || (state.storyBeats || []).slice().reverse().find((b) => b.presented);
    const storyCard = $('#p-active-story-card');
    if (activeBeat) {
      storyCard.classList.remove('hidden');
      const cols = activeBeat.arena?.cols || 20;
      const rows = activeBeat.arena?.rows || 20;
      storyCard.innerHTML = `
        <div class="panel-header">
          <h3>${esc(activeBeat.title)}</h3>
          <span class="tag tag-gold">${activeBeat.floor}F</span>
        </div>
        <div class="story-narration">${esc(activeBeat.narration)}</div>
        <div class="btn-row mt-xs">
          <button type="button" class="btn btn-xs btn-cyan" data-beat-view-map="${esc(activeBeat.id)}">View Map (${cols}×${rows})</button>
        </div>
      `;
    } else {
      storyCard.classList.add('hidden');
    }

    // Monsters & Target Selectors
    const monsters = state.monsters || [];
    const monsterOpts = monsters.length
      ? monsters.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${m.floor}F • ${m.hp !== null ? `${m.hp}/${m.maxHp} HP` : m.healthTier})</option>`).join('')
      : '<option value="">No visible monsters</option>';
    const prevTarget = $('#p-target-monster').value;
    $('#p-target-monster').innerHTML = monsterOpts;
    if (prevTarget && monsters.some((m) => m.id === prevTarget)) $('#p-target-monster').value = prevTarget;

    $('#p-dice-target-monster').innerHTML = '<option value="">Just Roll (No Damage)</option>' + monsterOpts;

    $('#p-monsters-list').innerHTML = monsters.length
      ? monsters.map((m) => {
          const dist = spaceDistanceBetween(ch.id, m.id);
          const pct = m.hp !== null && m.maxHp ? Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100)) : 50;
          const hpText = m.hp !== null ? `${m.hp} / ${m.maxHp} HP` : `${m.healthTier || 'Active'}`;
          return `
            <div class="item-card">
              <div class="item-card-top">
                <strong>${esc(m.name)} <span class="tag tag-crimson">${m.floor}F</span></strong>
                <span class="small">${dist !== null ? `${dist} Spaces away` : ''} • AC ${m.ac} • DR ${m.dr}</span>
              </div>
              <div class="bar-row"><span>Monster HP</span><strong>${esc(hpText)} ${m.hp === 0 ? '(DEFEATED)' : ''}</strong></div>
              <div class="progress"><div class="progress-fill monster" style="width:${pct}%"></div></div>
            </div>
          `;
        }).join('')
      : '<div class="muted small">No monsters revealed on your current Tower floors yet.</div>';

    // System Feed & Combat Log
    const feedItems = [
      ...(state.systemMessages || []).slice(0, 6).map((m) => ({ ts: m.timestamp, kind: 'sys', text: `[${m.title}] ${m.message}` })),
      ...(state.combatLog || []).slice(0, 8).map((c) => ({ ts: c.timestamp, kind: 'combat', text: c.summary })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 12);
    $('#p-system-feed').innerHTML = feedItems.map((f) => `<div class="feed-entry ${f.kind}">${esc(f.text)}</div>`).join('');

    // Equipment Tab
    const eq = ch.equipment || {};
    const slotDefs = [
      ['mainHand', 'Main Hand Weapon'],
      ['offHand', 'Off-Hand / Shield'],
      ['head', 'Headgear'],
      ['body', 'Body Armor'],
      ['boots', 'Boots'],
      ['relic', 'Tower Relic'],
    ];
    const mainWep = eq.mainHand;
    $('#p-equip-summary').textContent = `Weapon: ${mainWep ? `${mainWep.damageDice} (${mainWep.rangeSpaces || 1} Spaces)` : 'Unarmed'} • AC ${ch.ac} • DR ${ch.dr}`;
    $('#p-equipment-slots').innerHTML = slotDefs.map(([slotKey, label]) => {
      const item = eq[slotKey];
      if (!item) {
        return `<div class="equip-slot"><div class="equip-slot-label">${esc(label)}</div><div class="muted small">Empty Slot — equip from Inventory</div></div>`;
      }
      return `
        <div class="equip-slot">
          <div class="equip-slot-label">${esc(label)}</div>
          <strong>${esc(item.name)}</strong>
          <div class="muted small mt-xs">
            ${item.damageDice ? `Dmg: ${esc(item.damageDice)} (${esc(item.damageType)}) • Range: ${item.rangeSpaces || 1} Spaces` : ''}
            ${item.acBonus ? `AC +${item.acBonus} ` : ''}${item.drBonus ? `DR +${item.drBonus}` : ''}
          </div>
          <div class="btn-row mt-sm">
            ${slotKey === 'mainHand' ? `<button type="button" class="btn btn-xs btn-crimson" data-eq-strike>Strike Monster</button>` : ''}
            <button type="button" class="btn btn-xs btn-outline" data-unequip-slot="${esc(slotKey)}">Unequip</button>
          </div>
        </div>
      `;
    }).join('');

    // Inventory Tab
    $('#p-gold-val').textContent = ch.currency?.gold ?? 0;
    $('#p-stones-val').textContent = ch.currency?.manaStones ?? 0;
    const invItems = (ch.inventory || []).filter((i) => invFilter === 'all' || i.category === invFilter);
    $('#p-inventory-list').innerHTML = invItems.length
      ? invItems.map((it) => `
          <div class="item-card">
            <div class="item-card-top">
              <strong>${esc(it.name)} <span class="tag tag-cyan">${esc(it.category)}</span></strong>
              <span>Qty: <b>${it.qty}</b></span>
            </div>
            <div class="muted small">${esc(it.notes || '')} ${it.damageDice ? `• ${esc(it.damageDice)}` : ''} ${it.drBonus ? `• DR +${it.drBonus}` : ''}</div>
            <div class="btn-row">
              ${it.category === 'consumable' ? `<button type="button" class="btn btn-xs btn-cyan" data-inv-use="${esc(it.id)}">Use</button>` : ''}
              ${it.category !== 'consumable' ? `<button type="button" class="btn btn-xs btn-gold" data-inv-equip="${esc(it.id)}">Equip</button>` : ''}
              <button type="button" class="btn btn-xs btn-outline" data-inv-qty="${esc(it.id)}" data-delta="1">+1</button>
              <button type="button" class="btn btn-xs btn-outline" data-inv-qty="${esc(it.id)}" data-delta="-1">-1</button>
            </div>
          </div>
        `).join('')
      : '<div class="muted small">No items in this category.</div>';

    // Free-Flow Magic & Deities Tab
    $('#p-my-spells').innerHTML = (ch.spells || []).map((sp) => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${esc(sp.name)} <span class="tag tag-purple">${esc(sp.actionType || 'Action')}</span></strong>
          <span class="tag tag-cyan">${esc(sp.damageDice)} • ${sp.rangeSpaces} Sp • ${sp.mpCost} MP</span>
        </div>
        <details class="small muted">
          <summary>Details (${esc(sp.damageType)} • ${esc(sp.areaText || `${sp.rangeSpaces} Spaces`)})</summary>
          <div class="mt-xs">${esc(sp.explanation)}</div>
        </details>
        <div class="btn-row">
          <button type="button" class="btn btn-xs btn-crimson" data-cast-spell="${esc(sp.id)}">Cast</button>
          <button type="button" class="btn btn-xs btn-outline" data-forget-spell="${esc(sp.id)}">Remove</button>
        </div>
      </div>
    `).join('');

    $('#p-grimoire-list').innerHTML = (state.grimoire || []).map((sp) => {
      const known = (ch.spells || []).some((s) => s.id === sp.id);
      return `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(sp.name)} <span class="tag tag-purple">${esc(sp.element)}</span></strong>
            <span class="small">${esc(sp.damageDice)} • Range: ${sp.rangeSpaces} Spaces • ${sp.mpCost} MP</span>
          </div>
          <div class="muted small">${esc(sp.explanation)}</div>
          <div class="btn-row">
            <button type="button" class="btn btn-xs ${known ? 'btn-outline' : 'btn-cyan'}" data-learn-spell="${esc(sp.id)}" ${known ? 'disabled' : ''}>${known ? 'Known' : 'Learn Spell (Free-Flow)'}</button>
          </div>
        </div>
      `;
    }).join('');

    // Deities
    $('#p-deity-favor').textContent = ch.favor || 0;
    const patron = (state.deities || []).find((d) => d.id === ch.patronDeityId);
    $('#p-deity-active-card').innerHTML = patron
      ? `<strong>Patron: ${esc(patron.name)}</strong><br/><span class="small">${esc(patron.blessingName)} — ${esc(patron.blessingDescription)}</span>
         <div class="mt-xs"><button type="button" class="btn btn-xs btn-gold" data-invoke-deity="${esc(patron.id)}">Invoke Divine Miracle (Cost ${patron.favorCost} Favor)</button></div>`
      : 'No Patron Deity pledged yet. Choose a Deity below!';

    $('#p-deity-list').innerHTML = (state.deities || []).map((d) => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${esc(d.name)}</strong>
          <span class="tag tag-gold">${esc(d.domain)}</span>
        </div>
        <div class="small">${esc(d.blessingName)}: ${esc(d.blessingDescription)}</div>
        <div class="muted small">Tenets: ${esc(d.tenets)} • Range: ${d.miracleRangeSpaces || 6} Spaces</div>
        <div class="btn-row">
          <button type="button" class="btn btn-xs btn-outline" data-pledge-deity="${esc(d.id)}">${ch.patronDeityId === d.id ? 'Active Patron' : 'Pledge Patron'}</button>
        </div>
      </div>
    `).join('');

    // Roll Log & Art
    $('#p-roll-log').innerHTML = (state.rollLog || []).map((r) => `
      <div class="feed-entry">
        <strong>${esc(r.rollerName)}</strong> rolled <b>${esc(r.formula)}</b> (${esc(r.label)}) = <strong class="tag tag-cyan">${r.total}</strong>
        <span class="muted small">[${(r.rolls || []).join(', ')}]</span>
      </div>
    `).join('');

    if (document.activeElement?.id !== 'p-art-prompt') {
      $('#p-art-prompt').value = ch.portraitPrompt || '';
    }
    $('#p-art-style').value = ch.portraitStyle || 'Korean Manhwa Webtoon';
    $('#p-art-preview').src = ch.portraitUrl || '';
    $('#p-art-history').innerHTML = (ch.artHistory || []).map((a) => `<img class="art-thumb" src="${a.url}" title="${esc(a.prompt)}" />`).join('');

    drawTowerCanvas('player-tower-canvas', false);
    if (activeBeatMapId && !$('#beat-map-modal').classList.contains('hidden')) {
      renderBeatMapModal();
    }
  }

  function renderDm() {
    $('#dm-session-title-bar').textContent = state.session?.title || 'Tower Campaign';
    const isLive = state.session?.status === 'active';
    const pill = $('#dm-session-pill');
    pill.textContent = isLive ? 'SESSION LIVE' : 'SESSION STOPPED';
    pill.className = `status-pill ${isLive ? 'live' : 'stopped'}`;
    $('#btn-dm-toggle-session').textContent = isLive ? 'Stop Session' : 'Start Session';
    $('#dm-round-pill').textContent = `ROUND ${state.combat?.round || 1}`;

    if (document.activeElement?.id !== 'dm-sess-title') $('#dm-sess-title').value = state.session?.title || '';
    if (document.activeElement?.id !== 'dm-sess-pause-msg') $('#dm-sess-pause-msg').value = state.session?.pausedMessage || '';

    // Bestiary select
    if ($('#dm-bestiary-select').options.length === 0 && (state.bestiary || []).length) {
      $('#dm-bestiary-select').innerHTML = state.bestiary.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (HP ${b.maxHp} / AC ${b.ac} / DR ${b.dr})</option>`).join('');
      const b0 = state.bestiary[0];
      if (b0 && !$('#dm-mon-name').value) {
        $('#dm-mon-name').value = b0.name;
        $('#dm-mon-hp').value = b0.maxHp;
        $('#dm-mon-ac').value = b0.ac;
        $('#dm-mon-dr').value = b0.dr;
        $('#dm-mon-range').value = b0.rangeSpaces || 2;
        $('#dm-mon-atk').value = b0.attackFormula;
        $('#dm-mon-dmg').value = b0.damageFormula;
      }
    }

    // Monsters & Attack Selectors
    const mons = state.monsters || [];
    const chars = Object.values(state.characters || {});
    $('#dm-atk-monster').innerHTML = mons.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${m.hp}/${m.maxHp} HP)</option>`).join('');
    $('#dm-atk-player').innerHTML = chars.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (HP ${c.hp}/${c.maxHp})</option>`).join('');

    // Story Beats Orchestrator
    const lootTargetSel = $('#dm-story-loot-target');
    const prevLootTarget = lootTargetSel.value;
    lootTargetSel.innerHTML = '<option value="all">Treasure -> All Players</option>' + chars.map((c) => `<option value="${esc(c.id)}">Treasure -> ${esc(c.name)}</option>`).join('');
    if (prevLootTarget) lootTargetSel.value = prevLootTarget;

    $('#dm-story-list').innerHTML = (state.storyBeats || []).map((b) => {
      const monSummary = (b.encounters || []).map((e) => `${e.name} (${e.maxHp} HP)`).join(', ');
      const trSummary = (b.treasures || []).map((t) => `${t.name}${t.gold ? ` + ${t.gold}G` : ''}`).join(', ');
      return `
        <div class="story-beat-card ${b.status === 'active' ? 'beat-active' : ''} ${b.presented ? 'beat-presented' : ''}">
          <div class="item-card-top">
            <strong>${esc(b.title)}</strong>
            <div class="btn-row">
              <span class="tag ${b.presented ? 'tag-cyan' : 'tag-gold'}">${b.presented ? 'PRESENTED' : b.status.toUpperCase()}</span>
            </div>
          </div>
          ${b.narration ? `<div class="story-narration">${esc(b.narration)}</div>` : ''}
          ${b.dmSecret ? `<div class="story-secret"><strong>DM Secret:</strong> ${esc(b.dmSecret)}</div>` : ''}
          ${b.xpReward ? `<div class="small"><span class="tag tag-purple">XP REWARD</span> +${b.xpReward} XP</div>` : ''}
          ${monSummary ? `<div class="small"><span class="tag tag-crimson">MONSTERS</span> ${esc(monSummary)}</div>` : ''}
          ${trSummary ? `<div class="small"><span class="tag tag-gold">TREASURE</span> ${esc(trSummary)}</div>` : ''}
          <div class="btn-row mt-xs">
            <button type="button" class="btn btn-xs btn-outline" data-beat-view-map="${esc(b.id)}">View Map (${b.arena?.cols || 20}×${b.arena?.rows || 20})</button>
            <button type="button" class="btn btn-xs ${b.presented ? 'btn-outline' : 'btn-cyan'}" data-beat-present="${esc(b.id)}" data-presented="${!b.presented}">${b.presented ? 'Hide from Players' : 'Present to Players'}</button>
            ${b.xpReward ? `<button type="button" class="btn btn-xs btn-purple" data-beat-xp="${esc(b.id)}">Award XP (+${b.xpReward})</button>` : ''}
            ${(b.encounters || []).length ? `<button type="button" class="btn btn-xs btn-crimson" data-beat-spawn="${esc(b.id)}">Spawn Monsters</button>` : ''}
            ${(b.treasures || []).length ? `<button type="button" class="btn btn-xs btn-gold" data-beat-award="${esc(b.id)}">Award Treasure</button>` : ''}
            ${b.status !== 'resolved' ? `<button type="button" class="btn btn-xs btn-outline" data-beat-resolve="${esc(b.id)}">Resolve</button>` : ''}
            <button type="button" class="btn btn-xs btn-danger-outline" data-beat-del="${esc(b.id)}">Delete</button>
          </div>
        </div>
      `;
    }).join('') || '<div class="muted small">No story beats yet. Create one on the right!</div>';

    $('#dm-monsters-list').innerHTML = mons.map((m) => {
      const pct = m.maxHp ? Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100)) : 0;
      return `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(m.name)} <span class="tag tag-crimson">${m.floor}F</span> ${m.hiddenFromPlayers ? '<span class="tag tag-gold">HIDDEN</span>' : ''}</strong>
            <span>HP: <b>${m.hp}/${m.maxHp}</b> • AC ${m.ac} • DR ${m.dr}</span>
          </div>
          <div class="progress"><div class="progress-fill monster" style="width:${pct}%"></div></div>
          <div class="btn-row">
            <button type="button" class="btn btn-xs btn-outline" data-mon-hp="${esc(m.id)}" data-delta="-5">-5 HP</button>
            <button type="button" class="btn btn-xs btn-outline" data-mon-hp="${esc(m.id)}" data-delta="-1">-1</button>
            <button type="button" class="btn btn-xs btn-outline" data-mon-hp="${esc(m.id)}" data-delta="5">+5</button>
            <button type="button" class="btn btn-xs btn-cyan" data-mon-hide="${esc(m.id)}" data-hidden="${!m.hiddenFromPlayers}">${m.hiddenFromPlayers ? 'Reveal' : 'Hide'}</button>
            <button type="button" class="btn btn-xs btn-danger-outline" data-mon-del="${esc(m.id)}">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    // Initiative
    const turnIdx = state.combat?.turnIndex || 0;
    $('#dm-initiative-list').innerHTML = (state.combat?.combatants || []).map((c, idx) => `
      <div class="item-card" style="${idx === turnIdx ? 'border-color: var(--gold);' : ''}">
        <div class="item-card-top">
          <strong>${idx === turnIdx ? '▶ ' : ''}${esc(c.name)}</strong>
          <span>Init: <b>${c.initiative}</b> • HP ${c.hp}/${c.maxHp}</span>
        </div>
      </div>
    `).join('');

    $('#dm-combat-log').innerHTML = (state.combatLog || []).map((c) => `<div class="feed-entry combat">${esc(c.summary)}</div>`).join('');

    // Toast Target & Invites Dropdown
    $('#dm-toast-target').innerHTML = '<option value="all">All Connected Players</option>' + chars.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    $('#dm-invite-char').innerHTML = '<option value="__new__">Create New Character</option>' + chars.map((c) => `<option value="${esc(c.id)}">Assign: ${esc(c.name)}</option>`).join('');

    $('#dm-invites-list').innerHTML = Object.values(state.playerAccounts || {}).map((acc) => {
      const chName = state.characters?.[acc.characterId]?.name || acc.characterId;
      return `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(acc.email)}</strong>
            <span class="tag ${acc.activated ? 'tag-green' : 'tag-gold'}">${acc.activated ? `Active (@${esc(acc.username)})` : 'Pending First-Time Setup'}</span>
          </div>
          <div class="muted small">Character: ${esc(chName)}</div>
          <div class="btn-row">
            <button type="button" class="btn btn-xs btn-outline" data-reset-acc="${esc(acc.email)}">Reset Password Setup</button>
            <button type="button" class="btn btn-xs btn-danger-outline" data-remove-acc="${esc(acc.email)}">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    // Floor Fog Buttons
    $('#dm-floor-fog-buttons').innerHTML = (state.map?.floors || []).map((f) => `
      <button type="button" class="btn btn-xs btn-outline" data-floor-reveal="${f.number}">Reveal ${f.number}F</button>
      <button type="button" class="btn btn-xs btn-outline" data-floor-fog="${f.number}">Fog ${f.number}F</button>
    `).join('');

    // Mechanics Editor
    if (document.activeElement?.closest('#dm-mechanics-form') === null) {
      const mech = state.mechanics || {};
      $('#mech-name').value = mech.presetName || '';
      $('#mech-combat-mode').value = mech.combatMode || 'reactive';
      $('#mech-stat-formula').value = mech.statFormula || '';
      $('#mech-dmg-formula').value = mech.damageFormula || '';
      $('#mech-hit-formula').value = mech.hitFormula || '';
      $('#mech-crit-mult').value = mech.critMultiplier || 2;
      $('#mech-resource-name').value = mech.resourceName || 'Mana (MP)';
      $('#mech-show-hp').checked = mech.showExactMonsterHpToPlayers !== false;
      $('#mech-stats-editor').innerHTML = (mech.stats || []).map((s, idx) => `
        <div class="grid-4 mech-stat-row" data-idx="${idx}">
          <input type="text" class="mech-st-key" value="${esc(s.key)}" placeholder="KEY" />
          <input type="text" class="mech-st-name" value="${esc(s.name)}" placeholder="Full Name" />
          <input type="number" class="mech-st-def" value="${Number(s.defaultValue ?? 10)}" />
          <button type="button" class="btn btn-xs btn-danger-outline" data-del-stat="${idx}">Del</button>
        </div>
      `).join('');
    }

    // Deities list
    $('#dm-deities-list').innerHTML = (state.deities || []).map((d) => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${esc(d.name)}</strong>
          <button type="button" class="btn btn-xs btn-danger-outline" data-del-deity="${esc(d.id)}">Delete</button>
        </div>
        <div class="small">${esc(d.domain)} — ${esc(d.blessingName)} (${esc(d.boonFormula)})</div>
      </div>
    `).join('');

    // Party list
    $('#dm-party-list').innerHTML = chars.map((c) => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${esc(c.name)} (Lv ${c.level})</strong>
          <span>HP ${c.hp}/${c.maxHp} • XP ${c.xp || 0}/${c.xpToNext || c.level * 100} • Pts ${c.unspentStatPoints || 0}</span>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-xs btn-purple" data-grant-xp="${esc(c.id)}">+50 XP</button>
          <button type="button" class="btn btn-xs btn-gold" data-grant-favor="${esc(c.id)}">+1 Favor</button>
          <button type="button" class="btn btn-xs btn-cyan" data-heal-char="${esc(c.id)}">+10 HP</button>
        </div>
      </div>
    `).join('');

    if (document.activeElement?.id !== 'dm-private-notes') $('#dm-private-notes').value = state.notes?.dmPrivate || '';
    if (document.activeElement?.id !== 'dm-shared-quests') $('#dm-shared-quests').value = state.notes?.sharedQuests || '';

    $('#dm-roll-log').innerHTML = (state.rollLog || []).map((r) => `
      <div class="feed-entry ${r.isSecret ? 'secret' : ''}">
        ${r.isSecret ? '<span class="tag tag-gold">SECRET</span> ' : ''}
        <strong>${esc(r.rollerName)}</strong> rolled <b>${esc(r.formula)}</b> (${esc(r.label)}) = <b>${r.total}</b>
      </div>
    `).join('');

    drawTowerCanvas('dm-tower-canvas', true);
    if (activeBeatMapId && !$('#beat-map-modal').classList.contains('hidden')) {
      renderBeatMapModal();
    }
  }

  // -------------------------------------------------------------------------
  // Vertical Korean-Manhwa Tower Canvas Renderer (Spaces Grid + Fog of War)
  // -------------------------------------------------------------------------
  function drawTowerCanvas(canvasId, isDmView) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !state?.map) return;
    const cols = state.map.cols || 10;
    const rows = state.map.rows || 25;
    const cellSize = 48;
    const labelW = 36;
    const totalW = labelW + cols * cellSize;
    const totalH = rows * cellSize;
    if (canvas.width !== totalW || canvas.height !== totalH) {
      canvas.width = totalW;
      canvas.height = totalH;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, totalW, totalH);

    // Draw Floors from top (highest floor) to bottom (1F)
    for (const fl of state.map.floors || []) {
      const yTop = fl.rowStart * cellSize;
      const flH = (fl.rowEnd - fl.rowStart + 1) * cellSize;
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop + flH);
      if (fl.safeZone) {
        grad.addColorStop(0, '#092229');
        grad.addColorStop(1, '#06151c');
      } else if (fl.number >= 5) {
        grad.addColorStop(0, '#2a0912');
        grad.addColorStop(1, '#14060c');
      } else {
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(1, '#090f1d');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(labelW, yTop, cols * cellSize, flH);

      // Floor Left Spine Marker
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, yTop, labelW, flH);
      ctx.fillStyle = fl.safeZone ? '#34d399' : '#38bdf8';
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${fl.number}F`, labelW / 2, yTop + flH / 2 + 4);

      // Floor header banner
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(fl.title, labelW + 8, yTop + 15);

      // Warp Gate / Ascend Portal
      const px = labelW + fl.portalCol * cellSize + cellSize / 2;
      const py = fl.portalRow * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.fill();

      // Floor Divider Line
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, yTop + flH);
      ctx.lineTo(totalW, yTop + flH);
      ctx.stroke();
    }

    // Grid Spaces
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(labelW + x * cellSize, 0);
      ctx.lineTo(labelW + x * cellSize, totalH);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(labelW, y * cellSize);
      ctx.lineTo(totalW, y * cellSize);
      ctx.stroke();
    }

    // Fog of War
    const fogSet = new Set(state.map.fog || []);
    for (const key of fogSet) {
      const [fx, fy] = key.split(',').map(Number);
      const xPx = labelW + fx * cellSize;
      const yPx = fy * cellSize;
      ctx.fillStyle = isDmView ? 'rgba(15, 23, 42, 0.48)' : 'rgba(4, 7, 15, 0.96)';
      ctx.fillRect(xPx, yPx, cellSize, cellSize);
      if (isDmView) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.beginPath();
        ctx.moveTo(xPx, yPx);
        ctx.lineTo(xPx + cellSize, yPx + cellSize);
        ctx.stroke();
      }
    }

    // Tokens
    for (const tok of state.map.tokens || []) {
      const cx = labelW + tok.x * cellSize + cellSize / 2;
      const cy = tok.y * cellSize + cellSize / 2;
      drawTokenAvatar(ctx, tok, cx, cy, 17, dmSelectedTokenId === tok.id);

      // Token HP Bar
      if (tok.maxHp > 0 && tok.hp !== null) {
        const bw = 34;
        const pct = Math.max(0, Math.min(1, tok.hp / tok.maxHp));
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx - bw / 2, cy + 16, bw, 5);
        ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : '#22c55e';
        ctx.fillRect(cx - bw / 2, cy + 16, bw * pct, 5);
      }
    }

    // Active Pings
    const now = Date.now();
    for (const p of state.map.pings || []) {
      if (now - p.createdAt > 10000) continue;
      const px = labelW + p.x * cellSize + cellSize / 2;
      const py = p.y * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(px, py, 20, 0, Math.PI * 2);
      ctx.strokeStyle = p.color || '#38bdf8';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Space Measurement Line
    if (measureStart && measureEnd) {
      const sx = labelW + measureStart.x * cellSize + cellSize / 2;
      const sy = measureStart.y * cellSize + cellSize / 2;
      const ex = labelW + measureEnd.x * cellSize + cellSize / 2;
      const ey = measureEnd.y * cellSize + cellSize / 2;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      const spaces = Math.max(Math.abs(measureEnd.x - measureStart.x), Math.abs(measureEnd.y - measureStart.y));
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${spaces} Spaces`, (sx + ex) / 2, (sy + ey) / 2 - 8);
    }
  }

  function getGridCellFromClick(canvas, ev) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (ev.clientX - rect.left) * scaleX;
    const py = (ev.clientY - rect.top) * scaleY;
    const cellX = Math.floor((px - 36) / 48);
    const cellY = Math.floor(py / 48);
    if (cellX < 0 || cellX >= (state.map?.cols || 10) || cellY < 0 || cellY >= (state.map?.rows || 25)) return null;
    return { x: cellX, y: cellY };
  }

  // Player Map Interaction
  $$('[data-p-maptool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-p-maptool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      playerMapTool = btn.dataset.pMaptool;
      measureStart = null;
      measureEnd = null;
    });
  });

  $('#player-tower-canvas').addEventListener('click', async (ev) => {
    const cell = getGridCellFromClick(ev.currentTarget, ev);
    if (!cell || !session) return;
    if (playerMapTool === 'move') {
      await sendAction('move_token', { tokenId: session.characterId, x: cell.x, y: cell.y });
    } else if (playerMapTool === 'ping') {
      await sendAction('update_map', { subAction: 'ping', x: cell.x, y: cell.y });
    } else if (playerMapTool === 'measure') {
      if (!measureStart) {
        measureStart = cell;
        measureEnd = cell;
        $('#p-map-info').textContent = `Measuring from (${cell.x + 1}, ${cell.y + 1}). Tap destination space.`;
      } else {
        measureEnd = cell;
        const spaces = Math.max(Math.abs(cell.x - measureStart.x), Math.abs(cell.y - measureStart.y));
        $('#p-map-info').textContent = `Distance measured: ${spaces} Spaces.`;
        drawTowerCanvas('player-tower-canvas', false);
        measureStart = null;
      }
      drawTowerCanvas('player-tower-canvas', false);
    }
  });

  // DM Map Interaction
  $$('[data-dm-maptool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-dm-maptool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      dmMapTool = btn.dataset.dmMaptool;
      measureStart = null;
      measureEnd = null;
    });
  });

  $('#dm-tower-canvas').addEventListener('click', async (ev) => {
    const cell = getGridCellFromClick(ev.currentTarget, ev);
    if (!cell || !session) return;
    if (dmMapTool === 'move') {
      const hitTok = (state.map.tokens || []).find((t) => t.x === cell.x && t.y === cell.y);
      if (hitTok) {
        dmSelectedTokenId = hitTok.id;
        drawTowerCanvas('dm-tower-canvas', true);
      } else if (dmSelectedTokenId) {
        await sendAction('move_token', { tokenId: dmSelectedTokenId, x: cell.x, y: cell.y });
      }
    } else if (dmMapTool === 'reveal') {
      await sendAction('update_map', { subAction: 'toggle_fog_cell', x: cell.x, y: cell.y, covered: false });
    } else if (dmMapTool === 'fog') {
      await sendAction('update_map', { subAction: 'toggle_fog_cell', x: cell.x, y: cell.y, covered: true });
    } else if (dmMapTool === 'ping') {
      await sendAction('update_map', { subAction: 'ping', x: cell.x, y: cell.y });
    } else if (dmMapTool === 'measure') {
      if (!measureStart) {
        measureStart = cell;
        measureEnd = cell;
      } else {
        measureEnd = cell;
        drawTowerCanvas('dm-tower-canvas', true);
        measureStart = null;
      }
      drawTowerCanvas('dm-tower-canvas', true);
    }
  });

  // -------------------------------------------------------------------------
  // Player Event Delegation & Forms
  // -------------------------------------------------------------------------
  $('#player-panels').addEventListener('click', async (ev) => {
    const ch = state?.characters?.[session?.characterId];
    if (!ch) return;

    const hpBtn = ev.target.closest('[data-hp-delta]');
    if (hpBtn) return sendAction('update_character', { characterId: ch.id, updates: { hpDelta: Number(hpBtn.dataset.hpDelta) } });

    const mpBtn = ev.target.closest('[data-mp-delta]');
    if (mpBtn) return sendAction('update_character', { characterId: ch.id, updates: { mpDelta: Number(mpBtn.dataset.mpDelta) } });

    const allocBtn = ev.target.closest('[data-alloc-stat]');
    if (allocBtn) return sendAction('allocate_stat', { characterId: ch.id, statKey: allocBtn.dataset.allocStat, amount: 1 });

    const rollStatBtn = ev.target.closest('[data-roll-stat]');
    if (rollStatBtn) {
      const res = await sendAction('roll_dice', {
        count: 1,
        sides: 20,
        modifier: Number(rollStatBtn.dataset.statMod),
        label: `${rollStatBtn.dataset.rollStat} Check`,
        rollerName: ch.name,
      });
      return showToast({ title: `${rollStatBtn.dataset.rollStat} CHECK`, message: `Rolled ${res.roll.total} (${res.roll.formula})`, category: 'info' });
    }

    const rollSkillBtn = ev.target.closest('[data-roll-skill]');
    if (rollSkillBtn) {
      const res = await sendAction('roll_dice', {
        count: 1,
        sides: 20,
        modifier: Number(rollSkillBtn.dataset.skillMod),
        label: rollSkillBtn.dataset.rollSkill,
        rollerName: ch.name,
      });
      return showToast({ title: rollSkillBtn.dataset.rollSkill.toUpperCase(), message: `Rolled ${res.roll.total} (${res.roll.formula})`, category: 'info' });
    }

    const eqStrike = ev.target.closest('[data-eq-strike]');
    if (eqStrike) {
      const monId = $('#p-target-monster').value;
      const wep = ch.equipment?.mainHand;
      if (!monId || !wep) return showToast({ title: 'TARGET NEEDED', message: 'Summon or select an active monster first.', category: 'warning' });
      const res = await sendAction('inflict_damage', {
        monsterId: monId,
        attackerId: ch.id,
        diceFormula: wep.damageDice || '1d8',
        damageType: wep.damageType || 'Physical',
        includeStatMod: true,
      });
      return showToast({ title: 'WEAPON STRIKE!', message: `Dealt ${res.finalDamage} damage! Monster HP: ${res.monster.hp}/${res.monster.maxHp}`, category: 'combat' });
    }

    const uneq = ev.target.closest('[data-unequip-slot]');
    if (uneq) return sendAction('equipment_action', { characterId: ch.id, subAction: 'unequip', slot: uneq.dataset.unequipSlot });

    const invUse = ev.target.closest('[data-inv-use]');
    if (invUse) return sendAction('inventory_action', { characterId: ch.id, subAction: 'use_consumable', itemId: invUse.dataset.invUse });

    const invEq = ev.target.closest('[data-inv-equip]');
    if (invEq) return sendAction('inventory_action', { characterId: ch.id, subAction: 'equip', itemId: invEq.dataset.invEquip })
      .catch(() => sendAction('equipment_action', { characterId: ch.id, subAction: 'equip', itemId: invEq.dataset.invEquip }));

    const invQty = ev.target.closest('[data-inv-qty]');
    if (invQty) return sendAction('inventory_action', { characterId: ch.id, subAction: 'adjust_qty', itemId: invQty.dataset.invQty, delta: Number(invQty.dataset.delta) });

    const castSpell = ev.target.closest('[data-cast-spell]');
    if (castSpell) {
      const monId = $('#p-target-monster').value;
      const res = await sendAction('spell_action', { characterId: ch.id, subAction: 'cast', spellId: castSpell.dataset.castSpell, targetMonsterId: monId });
      if (res.monster) {
        showToast({ title: 'SPELL CAST!', message: `Inflicted ${res.finalDamage} dmg to ${res.monster.name} (HP: ${res.monster.hp}/${res.monster.maxHp})`, category: 'combat' });
      }
      return;
    }

    const forgetSpell = ev.target.closest('[data-forget-spell]');
    if (forgetSpell) return sendAction('spell_action', { characterId: ch.id, subAction: 'forget', spellId: forgetSpell.dataset.forgetSpell });

    const learnSpell = ev.target.closest('[data-learn-spell]');
    if (learnSpell) return sendAction('spell_action', { characterId: ch.id, subAction: 'learn_from_grimoire', spellId: learnSpell.dataset.learnSpell });

    const pledgeDeity = ev.target.closest('[data-pledge-deity]');
    if (pledgeDeity) return sendAction('deity_action', { characterId: ch.id, subAction: 'pledge', deityId: pledgeDeity.dataset.pledgeDeity });

    const invokeDeity = ev.target.closest('[data-invoke-deity]');
    if (invokeDeity) return sendAction('deity_action', { characterId: ch.id, subAction: 'invoke_miracle', deityId: invokeDeity.dataset.invokeDeity, targetMonsterId: $('#p-target-monster').value });
  });

  $('#player-panels').addEventListener('change', async (ev) => {
    const statInp = ev.target.closest('[data-stat-input]');
    if (statInp && session?.characterId) {
      await sendAction('update_character', {
        characterId: session.characterId,
        updates: { stats: { [statInp.dataset.statInput]: Number(statInp.value) } },
      });
    }
  });

  $('#btn-p-roll-init').addEventListener('click', () => sendAction('initiative_action', { subAction: 'player_roll_initiative', characterId: session.characterId }));

  $('#btn-p-inflict-direct').addEventListener('click', async () => {
    const monsterId = $('#p-target-monster').value;
    if (!monsterId) return showToast({ title: 'NO TARGET', message: 'No active monster selected.', category: 'warning' });
    const res = await sendAction('inflict_damage', {
      monsterId,
      attackerId: session.characterId,
      rawDamage: Number($('#p-direct-dmg').value || 1),
      damageType: $('#p-dmg-type').value,
      includeStatMod: false,
    });
    showToast({ title: 'DAMAGE DEALT', message: `${res.monster.name} HP is now ${res.monster.hp}/${res.monster.maxHp}`, category: 'combat' });
  });

  $('#btn-p-weapon-strike').addEventListener('click', async () => {
    const ch = state?.characters?.[session?.characterId];
    const monsterId = $('#p-target-monster').value;
    if (!monsterId || !ch) return showToast({ title: 'NO TARGET', message: 'Select a visible monster first.', category: 'warning' });
    const wep = ch.equipment?.mainHand;
    const res = await sendAction('inflict_damage', {
      monsterId,
      attackerId: ch.id,
      diceFormula: wep?.damageDice || '1d8+2',
      damageType: wep?.damageType || 'Slashing',
      includeStatMod: true,
    });
    showToast({ title: 'WEAPON STRIKE', message: `Inflicted ${res.finalDamage} dmg! ${res.monster.name} HP: ${res.monster.hp}/${res.monster.maxHp}`, category: 'combat' });
  });

  // Reactive Combat Response Buttons
  async function resolveActiveReaction(choice) {
    const rid = $('#p-reaction-banner').dataset.reactionId;
    if (!rid) return;
    const ch = state?.characters?.[session?.characterId];
    const reactSpell = (ch?.spells || []).find((s) => s.actionType === 'Reaction') || ch?.spells?.[0];
    const res = await sendAction('resolve_reaction', {
      reactionId: rid,
      choice,
      spellId: reactSpell?.id,
    });
    showToast({ title: 'REACTION RESOLVED', message: res.summary, category: 'combat' });
  }
  $('#btn-react-counter').addEventListener('click', () => resolveActiveReaction('counter'));
  $('#btn-react-parry').addEventListener('click', () => resolveActiveReaction('parry'));
  $('#btn-react-spell').addEventListener('click', () => resolveActiveReaction('spell'));
  $('#btn-react-accept').addEventListener('click', () => resolveActiveReaction('accept'));

  // Inventory Filters & Add Item
  $$('#inv-filter-pills .chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#inv-filter-pills .chip-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      invFilter = btn.dataset.invFilter;
      renderPlayer();
    });
  });

  $('#p-add-item-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await sendAction('inventory_action', {
      characterId: session.characterId,
      subAction: 'add',
      item: {
        name: $('#inv-new-name').value.trim(),
        category: $('#inv-new-cat').value,
        qty: Number($('#inv-new-qty').value || 1),
        damageDice: $('#inv-new-dmg').value.trim(),
        rangeSpaces: Number($('#inv-new-range').value || 2),
        healHp: Number($('#inv-new-heal-hp').value || 0),
        drBonus: Number($('#inv-new-dr').value || 0),
        notes: $('#inv-new-notes').value.trim(),
      },
    });
    ev.target.reset();
  });

  $('#p-craft-spell-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await sendAction('spell_action', {
      characterId: session.characterId,
      subAction: 'learn_custom',
      spell: {
        name: $('#sp-name').value.trim(),
        element: $('#sp-element').value.trim(),
        actionType: $('#sp-action-type').value,
        damageDice: $('#sp-dmg').value.trim(),
        rangeSpaces: Number($('#sp-range').value || 6),
        mpCost: Number($('#sp-mp').value || 0),
        explanation: $('#sp-expl').value.trim(),
      },
    });
    ev.target.reset();
  });

  // Dice Roller (d2..d100 + Custom 1..100)
  function displayLastRoll(roll) {
    const box = $('#p-last-roll-banner');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="small muted">${esc(roll.label)} (${esc(roll.formula)})</div>
      <div class="roll-total">${roll.total}</div>
      <div class="small">Dice: [${(roll.rolls || []).join(', ')}]${roll.modifier ? ` Mod: ${roll.modifier}` : ''}</div>`;
  }

  $$('#p-dice-buttons .die-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sides = Number(btn.dataset.sides);
      const ch = state?.characters?.[session?.characterId];
      const targetMon = $('#p-dice-target-monster').value || null;
      const res = await sendAction('roll_dice', {
        count: Number($('#p-dice-count').value || 1),
        sides,
        modifier: Number($('#p-dice-mod').value || 0),
        mode: $('#p-dice-mode').value,
        label: $('#p-dice-label').value.trim() || `d${sides} Roll`,
        rollerName: ch?.name || 'Player',
        targetMonsterId: targetMon,
      });
      displayLastRoll(res.roll);
    });
  });

  $('#p-custom-dice-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ch = state?.characters?.[session?.characterId];
    const sides = Math.max(1, Math.min(100, Number($('#p-dice-sides').value || 100)));
    const targetMon = $('#p-dice-target-monster').value || null;
    const res = await sendAction('roll_dice', {
      count: Number($('#p-dice-count').value || 1),
      sides,
      modifier: Number($('#p-dice-mod').value || 0),
      mode: $('#p-dice-mode').value,
      label: $('#p-dice-label').value.trim() || `Custom d${sides}`,
      rollerName: ch?.name || 'Player',
      targetMonsterId: targetMon,
    });
    displayLastRoll(res.roll);
  });

  // AI Character Art Prompt Push
  $$('[data-art-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = $('#p-art-prompt');
      inp.value = inp.value ? `${inp.value}, ${btn.dataset.artChip}` : btn.dataset.artChip;
    });
  });

  $('#p-art-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const res = await sendAction('generate_character_art', {
      characterId: session.characterId,
      prompt: $('#p-art-prompt').value.trim(),
      style: $('#p-art-style').value,
    });
    showToast({ title: 'AI CHARACTER ART READY', message: `Portrait updated via ${res.engine}!`, category: 'loot' });
  });

  // -------------------------------------------------------------------------
  // DM Event Handlers
  // -------------------------------------------------------------------------
  let stagedBeatMonsters = [];
  let stagedBeatTreasures = [];

  function renderStagedBeatAttachments() {
    const monEl = $('#beat-encounters-staged');
    const trEl = $('#beat-treasures-staged');
    if (monEl) {
      monEl.innerHTML = stagedBeatMonsters.map((m, i) => `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(m.name)}</strong>
            <span>HP ${m.maxHp} • AC ${m.ac} • DR ${m.dr} • ${esc(m.damageFormula)}</span>
            <button type="button" class="btn btn-xs btn-danger-outline" data-unstage-mon="${i}">Remove</button>
          </div>
        </div>
      `).join('');
    }
    if (trEl) {
      trEl.innerHTML = stagedBeatTreasures.map((t, i) => `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(t.name)} <span class="tag tag-cyan">${esc(t.category)}</span></strong>
            <span>${t.gold ? `${t.gold}G ` : ''}${t.manaStones ? `${t.manaStones} Stones ` : ''}${esc(t.damageDice || '')}</span>
            <button type="button" class="btn btn-xs btn-danger-outline" data-unstage-tr="${i}">Remove</button>
          </div>
        </div>
      `).join('');
    }
  }

  $('#btn-stage-beat-mon').addEventListener('click', () => {
    const name = $('#beat-mon-name').value.trim();
    if (!name) return showToast({ title: 'MONSTER NAME NEEDED', message: 'Enter a monster name before adding.', category: 'warning' });
    stagedBeatMonsters.push({
      name,
      maxHp: Number($('#beat-mon-hp').value || 35),
      ac: Number($('#beat-mon-ac').value || 14),
      dr: Number($('#beat-mon-dr').value || 1),
      damageFormula: $('#beat-mon-dmg').value.trim() || '2d6+3',
      startX: $('#beat-mon-x').value ? Number($('#beat-mon-x').value) : null,
      startY: $('#beat-mon-y').value ? Number($('#beat-mon-y').value) : null,
      hiddenFromPlayers: false,
    });
    $('#beat-mon-name').value = '';
    $('#beat-mon-x').value = '';
    $('#beat-mon-y').value = '';
    renderStagedBeatAttachments();
  });

  $('#btn-stage-beat-tr').addEventListener('click', () => {
    const name = $('#beat-tr-name').value.trim();
    const gold = Number($('#beat-tr-gold').value || 0);
    const manaStones = Number($('#beat-tr-stones').value || 0);
    if (!name && gold <= 0 && manaStones <= 0) {
      return showToast({ title: 'TREASURE NEEDED', message: 'Enter an item name, Gold, or Mana Stones.', category: 'warning' });
    }
    stagedBeatTreasures.push({
      name: name || 'Tower Gold Cache',
      category: $('#beat-tr-cat').value,
      qty: 1,
      gold,
      manaStones,
      damageDice: $('#beat-tr-dmg').value.trim(),
    });
    $('#beat-tr-name').value = '';
    $('#beat-tr-dmg').value = '';
    renderStagedBeatAttachments();
  });

  $('#dm-add-beat-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const encounters = [...stagedBeatMonsters];
    const monName = $('#beat-mon-name').value.trim();
    if (monName) {
      encounters.push({
        name: monName,
        maxHp: Number($('#beat-mon-hp').value || 35),
        ac: Number($('#beat-mon-ac').value || 14),
        dr: Number($('#beat-mon-dr').value || 1),
        damageFormula: $('#beat-mon-dmg').value.trim() || '2d6+3',
        startX: $('#beat-mon-x').value ? Number($('#beat-mon-x').value) : null,
        startY: $('#beat-mon-y').value ? Number($('#beat-mon-y').value) : null,
        hiddenFromPlayers: false,
      });
    }

    const treasures = [...stagedBeatTreasures];
    const trName = $('#beat-tr-name').value.trim();
    const trGold = Number($('#beat-tr-gold').value || 0);
    const trStones = Number($('#beat-tr-stones').value || 0);
    if (trName || (treasures.length === 0 && (trGold > 0 || trStones > 0))) {
      treasures.push({
        name: trName || 'Tower Gold Cache',
        category: $('#beat-tr-cat').value,
        qty: 1,
        gold: trGold,
        manaStones: trStones,
        damageDice: $('#beat-tr-dmg').value.trim(),
      });
    }

    await sendAction('story_action', {
      subAction: 'add_beat',
      title: $('#beat-title').value.trim(),
      floor: Number($('#beat-floor').value || 1),
      xpReward: Number($('#beat-xp').value || 0),
      gridSize: Number($('#beat-grid-size').value || 20),
      narration: $('#beat-narration').value.trim(),
      dmSecret: $('#beat-secret').value.trim(),
      presentNow: $('#beat-present-now').checked,
      encounters,
      treasures,
    });
    stagedBeatMonsters = [];
    stagedBeatTreasures = [];
    ev.target.reset();
    renderStagedBeatAttachments();
  });

  $('#dm-bestiary-select').addEventListener('change', (ev) => {
    const b = (state?.bestiary || []).find((x) => x.id === ev.target.value);
    if (!b) return;
    $('#dm-mon-name').value = b.name;
    $('#dm-mon-hp').value = b.maxHp;
    $('#dm-mon-ac').value = b.ac;
    $('#dm-mon-dr').value = b.dr;
    $('#dm-mon-range').value = b.rangeSpaces || 2;
    $('#dm-mon-atk').value = b.attackFormula;
    $('#dm-mon-dmg').value = b.damageFormula;
  });

  $('#dm-spawn-monster-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await sendAction('spawn_monster', {
      name: $('#dm-mon-name').value.trim(),
      floor: Number($('#dm-mon-floor').value || 2),
      maxHp: Number($('#dm-mon-hp').value || 30),
      ac: Number($('#dm-mon-ac').value || 14),
      dr: Number($('#dm-mon-dr').value || 0),
      rangeSpaces: Number($('#dm-mon-range').value || 2),
      attackFormula: $('#dm-mon-atk').value.trim(),
      damageFormula: $('#dm-mon-dmg').value.trim(),
      hiddenFromPlayers: $('#dm-mon-hidden').checked,
    });
  });

  $('#btn-dm-monster-attack').addEventListener('click', async () => {
    const monId = $('#dm-atk-monster').value;
    const charId = $('#dm-atk-player').value;
    const customDmg = $('#dm-atk-custom-dmg').value;
    if (!monId || !charId) return;
    await sendAction('monster_attack', { monsterId: monId, targetCharacterId: charId, customDamage: customDmg });
  });

  $('#btn-dm-prev-turn').addEventListener('click', () => sendAction('initiative_action', { subAction: 'prev_turn' }));
  $('#btn-dm-next-turn').addEventListener('click', () => sendAction('initiative_action', { subAction: 'next_turn' }));
  $('#btn-dm-roll-init').addEventListener('click', () => sendAction('initiative_action', { subAction: 'roll_all' }));

  $('#btn-dm-toggle-session').addEventListener('click', () => {
    const nextAction = state?.session?.status === 'active' ? 'stop' : 'start';
    sendAction('session_control', { action: nextAction });
  });
  $('#btn-dm-start-session').addEventListener('click', () => sendAction('session_control', {
    action: 'start',
    title: $('#dm-sess-title').value,
    pausedMessage: $('#dm-sess-pause-msg').value,
  }));
  $('#btn-dm-stop-session').addEventListener('click', () => sendAction('session_control', {
    action: 'stop',
    title: $('#dm-sess-title').value,
    pausedMessage: $('#dm-sess-pause-msg').value,
  }));
  $('#btn-dm-reset').addEventListener('click', () => sendAction('reset_campaign', {}));

  $('#dm-toast-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('#dm-toast-msg').value.trim();
    if (!msg) return;
    await sendAction('broadcast_toast', {
      title: $('#dm-toast-title').value.trim(),
      category: $('#dm-toast-cat').value,
      target: $('#dm-toast-target').value,
      message: msg,
    });
    $('#dm-toast-msg').value = '';
  });

  $('#dm-invite-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await sendAction('dm_manage_invites', {
      subAction: 'add',
      email: $('#dm-invite-email').value.trim(),
      characterId: $('#dm-invite-char').value,
      characterName: $('#dm-invite-char-name').value.trim(),
      race: $('#dm-invite-char-race').value.trim(),
      className: $('#dm-invite-char-class').value.trim(),
    });
    $('#dm-invite-email').value = '';
  });

  $('#btn-dm-add-floor').addEventListener('click', () => sendAction('update_map', { subAction: 'add_floor', startFogged: true }));
  $('#btn-dm-reveal-all').addEventListener('click', () => sendAction('update_map', { subAction: 'set_fog_bulk', mode: 'reveal_all' }));
  $('#btn-dm-cover-all').addEventListener('click', () => sendAction('update_map', { subAction: 'set_fog_bulk', mode: 'cover_all' }));

  $('#btn-add-custom-stat').addEventListener('click', () => {
    const ed = $('#mech-stats-editor');
    const div = document.createElement('div');
    div.className = 'grid-4 mech-stat-row';
    div.innerHTML = `
      <input type="text" class="mech-st-key" value="MANA" placeholder="KEY" />
      <input type="text" class="mech-st-name" value="Custom Stat" placeholder="Full Name" />
      <input type="number" class="mech-st-def" value="10" />
      <button type="button" class="btn btn-xs btn-danger-outline" data-del-stat="new">Del</button>
    `;
    ed.appendChild(div);
  });

  $('#dm-mechanics-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const stats = $$('#mech-stats-editor .mech-stat-row').map((row) => ({
      key: row.querySelector('.mech-st-key').value,
      name: row.querySelector('.mech-st-name').value,
      defaultValue: Number(row.querySelector('.mech-st-def').value || 10),
    }));
    await sendAction('update_mechanics', {
      presetName: $('#mech-name').value.trim(),
      combatMode: $('#mech-combat-mode').value,
      statFormula: $('#mech-stat-formula').value.trim(),
      damageFormula: $('#mech-dmg-formula').value.trim(),
      hitFormula: $('#mech-hit-formula').value.trim(),
      critMultiplier: Number($('#mech-crit-mult').value || 2),
      resourceName: $('#mech-resource-name').value.trim(),
      showExactMonsterHpToPlayers: $('#mech-show-hp').checked,
      stats,
    });
  });

  $('#dm-gdoc-import-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await sendAction('deity_action', {
      subAction: 'import_google_doc',
      docUrl: $('#dm-gdoc-url').value.trim(),
      rawText: $('#dm-gdoc-text').value.trim(),
    });
    $('#dm-gdoc-text').value = '';
  });

  $('#dm-notes-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await sendAction('update_notes', {
      dmPrivate: $('#dm-private-notes').value,
      sharedQuests: $('#dm-shared-quests').value,
    });
    showToast({ title: 'NOTES SAVED', message: 'DM & Shared Quest notes saved.', category: 'info' });
  });

  $('#dm-dice-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const res = await sendAction('roll_dice', {
      count: Number($('#dm-dice-count').value || 1),
      sides: Number($('#dm-dice-sides').value || 20),
      modifier: Number($('#dm-dice-mod').value || 0),
      label: $('#dm-dice-label').value.trim() || 'DM Roll',
      rollerName: 'Dungeon Master',
      isSecret: $('#dm-dice-secret').checked,
    });
    showToast({
      title: res.roll.isSecret ? 'SECRET DM ROLL' : 'DM ROLL',
      message: `${res.roll.formula} = ${res.roll.total}`,
      category: 'warning',
    });
  });

  $('#dm-view').addEventListener('click', async (ev) => {
    const monHp = ev.target.closest('[data-mon-hp]');
    if (monHp) return sendAction('update_monster', { monsterId: monHp.dataset.monHp, hpDelta: Number(monHp.dataset.delta) });

    const monHide = ev.target.closest('[data-mon-hide]');
    if (monHide) return sendAction('update_monster', { monsterId: monHide.dataset.monHide, hiddenFromPlayers: monHide.dataset.hidden === 'true' });

    const monDel = ev.target.closest('[data-mon-del]');
    if (monDel) return sendAction('update_monster', { monsterId: monDel.dataset.monDel, remove: true });

    const resetAcc = ev.target.closest('[data-reset-acc]');
    if (resetAcc) return sendAction('dm_manage_invites', { subAction: 'reset_activation', email: resetAcc.dataset.resetAcc });

    const remAcc = ev.target.closest('[data-remove-acc]');
    if (remAcc) return sendAction('dm_manage_invites', { subAction: 'remove', email: remAcc.dataset.removeAcc });

    const flRev = ev.target.closest('[data-floor-reveal]');
    if (flRev) return sendAction('update_map', { subAction: 'floor_fog', floorNumber: Number(flRev.dataset.floorReveal), covered: false });

    const flFog = ev.target.closest('[data-floor-fog]');
    if (flFog) return sendAction('update_map', { subAction: 'floor_fog', floorNumber: Number(flFog.dataset.floorFog), covered: true });

    const delStat = ev.target.closest('[data-del-stat]');
    if (delStat) return delStat.closest('.mech-stat-row').remove();

    const delDeity = ev.target.closest('[data-del-deity]');
    if (delDeity) return sendAction('deity_action', { subAction: 'remove_deity', deityId: delDeity.dataset.delDeity });

    const grantFav = ev.target.closest('[data-grant-favor]');
    if (grantFav) return sendAction('deity_action', { subAction: 'grant_favor', characterId: grantFav.dataset.grantFavor, delta: 1 });

    const healCh = ev.target.closest('[data-heal-char]');
    if (healCh) return sendAction('update_character', { characterId: healCh.dataset.healChar, updates: { hpDelta: 10 } });

    const beatPres = ev.target.closest('[data-beat-present]');
    if (beatPres) {
      return sendAction('story_action', {
        subAction: beatPres.dataset.presented === 'true' ? 'present_beat' : 'hide_beat',
        beatId: beatPres.dataset.beatPresent,
      });
    }

    const beatSpawn = ev.target.closest('[data-beat-spawn]');
    if (beatSpawn) {
      const res = await sendAction('story_action', { subAction: 'spawn_beat_monsters', beatId: beatSpawn.dataset.beatSpawn });
      return showToast({ title: 'ENCOUNTER SPAWNED', message: `Spawned ${res.spawned?.length || 0} monster(s) from Story Beat.`, category: 'combat' });
    }

    const beatAward = ev.target.closest('[data-beat-award]');
    if (beatAward) {
      return sendAction('story_action', {
        subAction: 'award_beat_treasure',
        beatId: beatAward.dataset.beatAward,
        characterId: $('#dm-story-loot-target').value || 'all',
      });
    }

    const beatXp = ev.target.closest('[data-beat-xp]');
    if (beatXp) {
      return sendAction('story_action', {
        subAction: 'award_beat_xp',
        beatId: beatXp.dataset.beatXp,
        characterId: $('#dm-story-loot-target').value || 'all',
      });
    }

    const grantXp = ev.target.closest('[data-grant-xp]');
    if (grantXp) return sendAction('grant_xp', { characterId: grantXp.dataset.grantXp, xp: 50 });

    const beatResolve = ev.target.closest('[data-beat-resolve]');
    if (beatResolve) return sendAction('story_action', { subAction: 'set_status', beatId: beatResolve.dataset.beatResolve, status: 'resolved' });

    const beatDel = ev.target.closest('[data-beat-del]');
    if (beatDel) return sendAction('story_action', { subAction: 'delete_beat', beatId: beatDel.dataset.beatDel });

    const unMon = ev.target.closest('[data-unstage-mon]');
    if (unMon) {
      stagedBeatMonsters.splice(Number(unMon.dataset.unstageMon), 1);
      return renderStagedBeatAttachments();
    }

    const unTr = ev.target.closest('[data-unstage-tr]');
    if (unTr) {
      stagedBeatTreasures.splice(Number(unTr.dataset.unstageTr), 1);
      return renderStagedBeatAttachments();
    }
  });

  // -------------------------------------------------------------------------
  // Story Beat Tactical Arena Map (ONLY Players in Fight, Spawned Monsters, Grid)
  // -------------------------------------------------------------------------
  function getCellPxForGrid(cols) {
    if (arenaCellOverride) return arenaCellOverride;
    return cols >= 50 ? 30 : cols >= 40 ? 36 : cols >= 30 ? 42 : cols >= 25 ? 48 : 54;
  }

  function renderBeatMapModal() {
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatMapId);
    if (!beat) return;
    const arena = beat.arena || { cols: 20, rows: 20, tokens: [] };
    const cols = arena.cols || 20;
    const rows = arena.rows || 20;
    const isDm = session?.role === 'dm';

    $('#beat-map-title').textContent = beat.title;
    $('#beat-map-size-badge').textContent = `${cols} × ${rows} Spaces`;
    $('#beat-map-dm-controls').classList.toggle('hidden', !isDm);
    if (isDm && document.activeElement?.id !== 'beat-custom-cols' && document.activeElement?.id !== 'beat-custom-rows') {
      $('#beat-custom-cols').value = cols;
      $('#beat-custom-rows').value = rows;
    }

    $$('[data-beat-grid]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.beatGrid) === cols && cols === rows);
    });

    if (isDm) {
      const presentIds = new Set((arena.tokens || []).map((t) => t.id));
      $('#beat-map-players-bar').innerHTML = '<span class="muted small">Fighters:</span>' + Object.values(state.characters || {}).map((ch) => {
        const active = presentIds.has(ch.id);
        return `<button type="button" class="chip-btn ${active ? 'active' : ''}" data-beat-toggle-player="${esc(ch.id)}">${esc(ch.name.split(' ')[0])}</button>`;
      }).join('');
    }

    const canvas = $('#beat-map-canvas');
    const cellPx = getCellPxForGrid(cols);
    const axisPad = 24;
    const w = axisPad + cols * cellPx;
    const h = axisPad + rows * cellPx;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, w, h);

    // Coordinate Axis Labels (1..cols, 1..rows)
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 10px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    for (let x = 0; x < cols; x++) {
      ctx.fillText(String(x + 1), axisPad + x * cellPx + cellPx / 2, 15);
    }
    for (let y = 0; y < rows; y++) {
      ctx.fillText(String(y + 1), 12, axisPad + y * cellPx + cellPx / 2 + 3);
    }

    // Draw clean tactical grid spaces
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath();
      ctx.moveTo(axisPad + x * cellPx, axisPad);
      ctx.lineTo(axisPad + x * cellPx, h);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(axisPad, axisPad + y * cellPx);
      ctx.lineTo(w, axisPad + y * cellPx);
      ctx.stroke();
    }

    // Draw ONLY players in fight & spawned monsters for this story beat
    for (const tok of arena.tokens || []) {
      const cx = axisPad + tok.x * cellPx + cellPx / 2;
      const cy = axisPad + tok.y * cellPx + cellPx / 2;
      const r = Math.max(11, Math.floor(cellPx * 0.4));

      drawTokenAvatar(ctx, tok, cx, cy, r, arenaSelectedTokenId === tok.id);

      if (tok.maxHp > 0 && tok.hp !== null) {
        const bw = cellPx - 6;
        const pct = Math.max(0, Math.min(1, tok.hp / tok.maxHp));
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx - bw / 2, cy + r + 2, bw, 4);
        ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : '#22c55e';
        ctx.fillRect(cx - bw / 2, cy + r + 2, bw * pct, 4);
      }
    }

    if (arenaMeasureStart && arenaMeasureEnd) {
      const sx = axisPad + arenaMeasureStart.x * cellPx + cellPx / 2;
      const sy = axisPad + arenaMeasureStart.y * cellPx + cellPx / 2;
      const ex = axisPad + arenaMeasureEnd.x * cellPx + cellPx / 2;
      const ey = axisPad + arenaMeasureEnd.y * cellPx + cellPx / 2;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      const dist = Math.max(Math.abs(arenaMeasureEnd.x - arenaMeasureStart.x), Math.abs(arenaMeasureEnd.y - arenaMeasureStart.y));
      $('#beat-map-info').textContent = `Measured: ${dist} Spaces`;
    }
  }

  document.addEventListener('click', (ev) => {
    const viewBtn = ev.target.closest('[data-beat-view-map]');
    if (viewBtn) {
      activeBeatMapId = viewBtn.dataset.beatViewMap;
      arenaSelectedTokenId = session?.role === 'player' ? session.characterId : null;
      arenaMeasureStart = null;
      arenaMeasureEnd = null;
      $('#beat-map-modal').classList.remove('hidden');
      renderBeatMapModal();
    }
  });

  $('#btn-close-beat-map').addEventListener('click', () => {
    $('#beat-map-modal').classList.add('hidden');
    activeBeatMapId = null;
  });

  $$('[data-arena-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-arena-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      arenaTool = btn.dataset.arenaTool;
      arenaMeasureStart = null;
      arenaMeasureEnd = null;
      renderBeatMapModal();
    });
  });

  $('#beat-map-modal').addEventListener('click', async (ev) => {
    const gridBtn = ev.target.closest('[data-beat-grid]');
    if (gridBtn && activeBeatMapId) {
      const size = Number(gridBtn.dataset.beatGrid);
      arenaCellOverride = null;
      await sendAction('story_action', { subAction: 'set_beat_grid', beatId: activeBeatMapId, cols: size, rows: size });
      return;
    }
    if (ev.target.id === 'btn-apply-beat-grid' && activeBeatMapId) {
      const cols = Math.max(5, Math.min(100, Number($('#beat-custom-cols').value || 20)));
      const rows = Math.max(5, Math.min(100, Number($('#beat-custom-rows').value || 20)));
      arenaCellOverride = null;
      await sendAction('story_action', { subAction: 'set_beat_grid', beatId: activeBeatMapId, cols, rows });
      return;
    }
    if (ev.target.id === 'btn-beat-save-starts' && activeBeatMapId) {
      await sendAction('story_action', { subAction: 'save_beat_starts', beatId: activeBeatMapId });
      showToast({ title: 'START POSITIONS SAVED', message: 'Designated starting positions saved for this Story Beat.', category: 'info' });
      return;
    }
    if (ev.target.id === 'btn-beat-reset-starts' && activeBeatMapId) {
      await sendAction('story_action', { subAction: 'reset_beat_starts', beatId: activeBeatMapId });
      return;
    }
    if (ev.target.id === 'btn-arena-zoom-in') {
      const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatMapId);
      const cur = getCellPxForGrid(beat?.arena?.cols || 20);
      arenaCellOverride = Math.min(84, cur + 8);
      return renderBeatMapModal();
    }
    if (ev.target.id === 'btn-arena-zoom-out') {
      const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatMapId);
      const cur = getCellPxForGrid(beat?.arena?.cols || 20);
      arenaCellOverride = Math.max(24, cur - 8);
      return renderBeatMapModal();
    }
    const togPlayer = ev.target.closest('[data-beat-toggle-player]');
    if (togPlayer && activeBeatMapId) {
      await sendAction('story_action', { subAction: 'toggle_beat_player', beatId: activeBeatMapId, characterId: togPlayer.dataset.beatTogglePlayer });
    }
  });

  $('#beat-map-canvas').addEventListener('click', async (ev) => {
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatMapId);
    if (!beat) return;
    const arena = beat.arena || { cols: 20, rows: 20, tokens: [] };
    const cols = arena.cols || 20;
    const rows = arena.rows || 20;
    const cellPx = getCellPxForGrid(cols);
    const axisPad = 24;
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left - axisPad) / cellPx);
    const y = Math.floor((ev.clientY - rect.top - axisPad) / cellPx);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;

    if (arenaTool === 'measure') {
      if (!arenaMeasureStart) {
        arenaMeasureStart = { x, y };
        arenaMeasureEnd = { x, y };
      } else {
        arenaMeasureEnd = { x, y };
        renderBeatMapModal();
        arenaMeasureStart = null;
        return;
      }
      renderBeatMapModal();
      return;
    }

    if (session?.role === 'dm') {
      const hit = (arena.tokens || []).find((t) => t.x === x && t.y === y);
      if (hit) {
        arenaSelectedTokenId = hit.id;
        $('#beat-map-info').textContent = `Selected ${hit.name}. Tap a destination space.`;
        renderBeatMapModal();
      } else if (arenaSelectedTokenId) {
        await sendAction('story_action', { subAction: 'move_beat_token', beatId: activeBeatMapId, tokenId: arenaSelectedTokenId, x, y });
      }
    } else if (session?.characterId) {
      await sendAction('story_action', { subAction: 'move_beat_token', beatId: activeBeatMapId, tokenId: session.characterId, x, y });
    }
  });

  // -------------------------------------------------------------------------
  // Token Hover & Touch-Hold Tooltip Hint (Shows Player/Monster Full Name)
  // -------------------------------------------------------------------------
  const tokenTooltip = $('#map-token-tooltip');
  let holdTooltipTimer = null;

  function showTokenTooltip(tok, clientX, clientY) {
    if (!tok || !tokenTooltip) return;
    const ch = tok.type === 'player' ? state?.characters?.[tok.id] : null;
    const displayName = ch?.name || tok.name;
    const hpText = tok.hp !== null && tok.maxHp ? ` • ${tok.hp}/${tok.maxHp} HP` : '';
    tokenTooltip.textContent = `${displayName}${hpText}`;
    tokenTooltip.className = `token-tooltip ${tok.type === 'monster' ? 'monster' : ''}`;
    tokenTooltip.style.left = `${clientX}px`;
    tokenTooltip.style.top = `${clientY}px`;
  }

  function hideTokenTooltip() {
    clearTimeout(holdTooltipTimer);
    if (tokenTooltip) tokenTooltip.classList.add('hidden');
  }

  function attachTokenTooltip(canvasId, findTokenAtClientPoint) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.addEventListener('mousemove', (ev) => {
      const tok = findTokenAtClientPoint(canvas, ev.clientX, ev.clientY);
      if (tok) showTokenTooltip(tok, ev.clientX, ev.clientY);
      else hideTokenTooltip();
    });
    canvas.addEventListener('mouseleave', hideTokenTooltip);
    canvas.addEventListener('touchstart', (ev) => {
      const touch = ev.touches?.[0];
      if (!touch) return;
      clearTimeout(holdTooltipTimer);
      const tok = findTokenAtClientPoint(canvas, touch.clientX, touch.clientY);
      if (tok) {
        holdTooltipTimer = setTimeout(() => showTokenTooltip(tok, touch.clientX, touch.clientY), 260);
      }
    }, { passive: true });
    canvas.addEventListener('touchend', hideTokenTooltip, { passive: true });
    canvas.addEventListener('touchcancel', hideTokenTooltip, { passive: true });
    canvas.addEventListener('touchmove', hideTokenTooltip, { passive: true });
  }

  function findTowerTokenAt(canvas, clientX, clientY) {
    if (!state?.map?.tokens) return null;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    const cellX = Math.floor((px - 36) / 48);
    const cellY = Math.floor(py / 48);
    return state.map.tokens.find((t) => t.x === cellX && t.y === cellY) || null;
  }

  function findBeatTokenAt(canvas, clientX, clientY) {
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatMapId);
    if (!beat?.arena?.tokens) return null;
    const cols = beat.arena.cols || 20;
    const cellPx = getCellPxForGrid(cols);
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - 24) / cellPx);
    const y = Math.floor((clientY - rect.top - 24) / cellPx);
    return beat.arena.tokens.find((t) => t.x === x && t.y === y) || null;
  }

  attachTokenTooltip('player-tower-canvas', findTowerTokenAt);
  attachTokenTooltip('dm-tower-canvas', findTowerTokenAt);
  attachTokenTooltip('beat-map-canvas', findBeatTokenAt);

  // Restore saved session if present
  try {
    const saved = localStorage.getItem('tower_vtt_session');
    if (saved) enterSession(JSON.parse(saved));
  } catch {}
})();
