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
  let activeBeatDetailId = null;
  let lastVisitedViewId = null;
  let lastScrollY = 0;
  let editBeatEncounters = [];
  let editBeatTreasures = [];
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
      if (activeBeatDetailId && $('#beat-detail-view')?.classList.contains('active')) {
        renderBeatDetailModal();
      }
      if (state) {
        if (session?.role === 'dm') drawTowerCanvas('dm-tower-canvas', true);
        else drawTowerCanvas('player-tower-canvas', false);
      }
    };
    img.src = url;
    return null;
  }

  function drawChestIcon(ctx, chest, cx, cy, size) {
    const half = Math.max(7, Math.floor(size * 0.36));
    ctx.save();
    if (chest.opened) ctx.globalAlpha = 0.45;
    // Chest body
    ctx.fillStyle = chest.opened ? '#78350f' : '#b45309';
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - half, cy - half * 0.75, half * 2, half * 1.5, 3);
    ctx.fill();
    ctx.stroke();
    // Lid band & gold lock clasp
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(cx - half, cy - 2, half * 2, 3);
    ctx.fillRect(cx - 2.5, cy - 3.5, 5, 6);
    ctx.restore();
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
      ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : tok.type === 'npc' ? '#10b981' : (tok.color || '#38bdf8');
      ctx.fill();
      ctx.fillStyle = '#020617';
      ctx.font = `bold ${Math.max(9, Math.floor(r * 0.72))}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(tok.label || tok.name.slice(0, 2).toUpperCase(), cx, cy + Math.floor(r * 0.25));
    }

    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? '#fbbf24' : (tok.type === 'monster' ? '#fca5a5' : tok.type === 'npc' ? '#6ee7b7' : '#7dd3fc');
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

    const rawMsg = String(toast.message || '').trim();
    const displayMsg = /^SYSTEM:/i.test(rawMsg) ? rawMsg : `SYSTEM: ${rawMsg}`;
    const stack = $('#toast-stack');
    const card = document.createElement('div');
    card.className = `toast-card ${toast.category || 'info'}`;
    card.innerHTML = `
      <div>
        <div class="toast-title">[${esc(toast.title || 'SYSTEM NOTICE')}]</div>
        <div class="toast-body">${esc(displayMsg)}</div>
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
    $('#beat-detail-view')?.classList.remove('active');
    activeBeatDetailId = null;
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
    activeBeatDetailId = null;
    localStorage.removeItem('tower_vtt_session');
    $('#player-view').classList.remove('active');
    $('#dm-view').classList.remove('active');
    $('#beat-detail-view')?.classList.remove('active');
    $('#login-view').classList.add('active');
    resetLoginStep();
  }

  // -------------------------------------------------------------------------
  // Auth / Unified Login Handler (routes to DM or Player by credentials)
  // -------------------------------------------------------------------------
  let pendingDmSetupEmail = null;
  let loginIdentifierVerified = false;

  function resetLoginStep() {
    loginIdentifierVerified = false;
    $('#login-view')?.classList.remove('login-denied');
    $('#login-password-group')?.classList.add('hidden');
    if ($('#login-password')) {
      $('#login-password').value = '';
      $('#login-password').required = false;
    }
    if ($('#login-identifier')) $('#login-identifier').readOnly = false;
    $('#player-login-error')?.classList.add('hidden');
  }

  $('#btn-login-change-user')?.addEventListener('click', () => {
    resetLoginStep();
    $('#login-identifier')?.focus();
  });

  $('#login-identifier')?.addEventListener('input', () => {
    $('#login-view')?.classList.remove('login-denied');
    $('#player-login-error')?.classList.add('hidden');
    if (loginIdentifierVerified) resetLoginStep();
  });

  $('#player-login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errBox = $('#player-login-error');
    errBox.classList.add('hidden');
    $('#login-view')?.classList.remove('login-denied');
    const identifier = $('#login-identifier').value.trim();
    try {
      if (!loginIdentifierVerified) {
        const check = await api('/api/auth/check-identifier', { identifier });
        if (check.requiresDmSetup) {
          pendingDmSetupEmail = check.email;
          if ($('#dm-setup-email-label')) $('#dm-setup-email-label').textContent = check.email;
          $('#dm-setup-error')?.classList.add('hidden');
          $('#dm-setup-modal')?.classList.remove('hidden');
          return;
        }
        loginIdentifierVerified = true;
        $('#login-identifier').readOnly = true;
        $('#login-password-group')?.classList.remove('hidden');
        if ($('#login-password-label')) {
          $('#login-password-label').textContent = check.activated === false
            ? 'Create Password (First-Time Setup)'
            : 'Password';
        }
        if ($('#login-password')) {
          $('#login-password').required = true;
          $('#login-password').focus();
        }
        return;
      }

      const res = await api('/api/auth/login', {
        identifier,
        password: $('#login-password').value,
      });
      if (res.requiresDmSetup) {
        pendingDmSetupEmail = res.email;
        if ($('#dm-setup-email-label')) $('#dm-setup-email-label').textContent = res.email;
        $('#dm-setup-error')?.classList.add('hidden');
        $('#dm-setup-modal')?.classList.remove('hidden');
        return;
      }
      resetLoginStep();
      enterSession(res.session);
      if (res.firstTimeActivated) {
        showToast({
          title: 'ACCOUNT ACTIVATED',
          message: 'Password saved! You can update your username or password anytime under Account.',
          category: 'info',
        });
      }
    } catch (err) {
      $('#login-view')?.classList.add('login-denied');
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  });

  $('#btn-close-dm-setup')?.addEventListener('click', () => {
    $('#dm-setup-modal')?.classList.add('hidden');
  });

  $('#dm-setup-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errBox = $('#dm-setup-error');
    errBox?.classList.add('hidden');
    const pw = $('#dm-setup-password').value;
    const confirm = $('#dm-setup-confirm').value;
    if (pw !== confirm) {
      if (errBox) {
        errBox.textContent = 'Passwords do not match.';
        errBox.classList.remove('hidden');
      }
      return;
    }
    try {
      const res = await api('/api/auth/dm-setup', {
        email: pendingDmSetupEmail || 'jairusjimenez@live.com',
        newUsername: $('#dm-setup-username').value.trim(),
        newPassword: pw,
      });
      $('#dm-setup-modal')?.classList.add('hidden');
      ev.target.reset();
      enterSession(res.session);
      showToast({
        title: 'DM LOGIN CREATED',
        message: `Welcome, ${res.session.username}! Your DM login is now active.`,
        category: 'info',
      });
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      }
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

    const milestones = state.mechanics?.statMilestones || [];
    const statsGrid = $('#p-stats-grid');
    statsGrid.innerHTML = (state.mechanics?.stats || []).map((st) => {
      const score = Number(ch.stats?.[st.key] ?? st.defaultValue ?? 10);
      const mod = evalLocalFormula(state.mechanics.statFormula, { ...ch.stats, SCORE: score, LEVEL: ch.level });
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      const statMilestones = milestones
        .filter((m) => m.statKey === st.key)
        .sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));
      const unlockedList = statMilestones.filter((m) => score >= Number(m.threshold || 20));
      const nextMs = statMilestones.find((m) => score < Number(m.threshold || 20));
      const msUnlocked = unlockedList.length > 0;
      const latestUnlocked = unlockedList[unlockedList.length - 1];
      const msBadge = statMilestones.length
        ? `<div class="muted small" style="margin-top:4px; color:${msUnlocked ? '#fbbf24' : '#94a3b8'};" title="${esc((latestUnlocked || nextMs)?.description || '')}">
            ${latestUnlocked ? `AWAKENED (${latestUnlocked.threshold}): ${esc(latestUnlocked.abilityName)}` : ''}
            ${latestUnlocked && nextMs ? '<br>' : ''}
            ${nextMs ? `Next ${nextMs.threshold}: ${esc(nextMs.abilityName)}` : ''}
          </div>`
        : '';
      return `
        <div class="stat-card ${msUnlocked ? 'card-glow-gold' : ''}">
          <div class="stat-key">${esc(st.key)}</div>
          <div class="stat-mod">${esc(modStr)}</div>
          <input type="number" data-stat-input="${esc(st.key)}" value="${score}" />
          <div class="btn-row mt-xs" style="justify-content:center;">
            ${unspentPts > 0 ? `<button type="button" class="btn btn-xs btn-gold" data-alloc-stat="${esc(st.key)}">+1</button>` : ''}
            <button type="button" class="btn btn-xs btn-outline" data-roll-stat="${esc(st.key)}" data-stat-mod="${mod}">d20${esc(modStr)}</button>
          </div>
          ${msBadge}
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
          <button type="button" class="btn btn-xs btn-gold" data-beat-open="${esc(activeBeat.id)}">View Beat</button>
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
    renderTowerFloorsAndBeats('p-tower-floors-beats', false);
    if (activeBeatMapId && !$('#beat-map-modal').classList.contains('hidden')) {
      renderBeatMapModal();
    }
    if (activeBeatDetailId && $('#beat-detail-view')?.classList.contains('active')) {
      renderBeatDetailModal();
    }
    if (activeDmCharModalId && !$('#dm-char-modal')?.classList.contains('hidden')) {
      renderDmCharModal(activeDmCharModalId);
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
            <button type="button" class="btn btn-xs btn-gold" data-beat-open="${esc(b.id)}">View Beat</button>
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
    if ($('#dm-toast-target')) {
      $('#dm-toast-target').innerHTML = '<option value="all">All Connected Players</option>' + chars.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    }
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
            <button type="button" class="btn btn-xs btn-cyan" data-view-char="${esc(acc.characterId)}">View Character</button>
            <button type="button" class="btn btn-xs btn-outline" data-reset-acc="${esc(acc.email)}">Reset Password Setup</button>
            <button type="button" class="btn btn-xs btn-danger-outline" data-remove-acc="${esc(acc.email)}">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    if ($('#dm-player-history-list')) {
      const historyEntries = state.playerHistory || [];
      $('#dm-player-history-list').innerHTML = historyEntries.length
        ? historyEntries.map((h) => `
            <div class="feed-entry">
              <span class="tag tag-cyan">${esc((h.category || 'event').toUpperCase())}</span>
              <strong>${esc(h.characterName || 'Player')}</strong>: ${esc(h.summary)}
              <span class="muted small">(${new Date(h.timestamp).toLocaleTimeString()})</span>
            </div>
          `).join('')
        : '<div class="muted small">No player activity logged yet.</div>';
    }

    // Floor Fog Buttons
    if ($('#dm-floor-fog-buttons')) {
      $('#dm-floor-fog-buttons').innerHTML = (state.map?.floors || []).map((f) => `
        <button type="button" class="btn btn-xs btn-outline" data-floor-reveal="${f.number}">Reveal ${f.number}F</button>
        <button type="button" class="btn btn-xs btn-outline" data-floor-fog="${f.number}">Fog ${f.number}F</button>
      `).join('');
    }

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
          <input type="text" class="mech-st-key" value="${esc(s.key)}" placeholder="KEY" title="Formula variable key (e.g. STR)" aria-label="Stat Key" />
          <input type="text" class="mech-st-name" value="${esc(s.name)}" placeholder="Full Name" title="Display name (e.g. Strength)" aria-label="Stat Name" />
          <input type="number" class="mech-st-def" value="${Number(s.defaultValue ?? 10)}" title="Starting Value for new characters" aria-label="Starting Value" />
          <button type="button" class="btn btn-xs btn-danger-outline" data-del-stat="${idx}">Del</button>
        </div>
      `).join('');
      if ($('#mech-milestones-editor')) {
        const allMs = (mech.statMilestones || []).map((ms, idx) => ({ ...ms, _idx: idx }));
        const grouped = new Map();
        for (const ms of allMs) {
          const k = ms.statKey || 'OTHER';
          if (!grouped.has(k)) grouped.set(k, []);
          grouped.get(k).push(ms);
        }
        $('#mech-milestones-editor').innerHTML = Array.from(grouped.entries()).map(([statKey, list], gIdx) => {
          const statObj = (mech.stats || []).find((s) => s.key === statKey);
          const statName = statObj ? `${statKey} — ${statObj.name}` : statKey;
          const tiersSummary = list.map((m) => m.threshold).join(' / ');
          const rowsHtml = list.map((ms) => `
            <div class="mech-ms-row" data-ms-id="${esc(ms.id || `ms-${ms._idx}`)}" style="padding:6px 0; border-top:1px solid rgba(148,163,184,0.12);">
              <input type="hidden" class="mech-ms-key" value="${esc(ms.statKey)}" />
              <div class="btn-row" style="gap:8px; align-items:center;">
                <span class="tag tag-gold" style="min-width:44px; text-align:center;">Lv/Stat</span>
                <input type="number" class="mech-ms-thresh" value="${Number(ms.threshold || 20)}" min="1" style="width:72px; min-height:30px; padding:4px 8px;" aria-label="Threshold" />
                <input type="text" class="mech-ms-name" value="${esc(ms.abilityName)}" placeholder="Ability Name" style="flex:1; min-width:160px; min-height:30px; padding:4px 8px;" aria-label="Ability Name" />
              </div>
              <input type="text" class="mech-ms-desc mt-xs" value="${esc(ms.description)}" placeholder="Ability effect description..." style="min-height:30px; padding:4px 8px; font-size:0.84rem;" aria-label="Description" />
            </div>
          `).join('');
          return `
            <details class="sub-details" ${gIdx === 0 ? 'open' : ''}>
              <summary>${esc(statName)} <span class="muted small">(${esc(tiersSummary)})</span></summary>
              <div class="mt-xs">${rowsHtml}</div>
            </details>
          `;
        }).join('');
      }
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
    $('#dm-party-list').innerHTML = chars.map((c) => {
      const statPills = Object.entries(c.stats || {}).map(([k, v]) => {
        const mod = evalLocalFormula(state.mechanics?.statFormula || 'floor((SCORE - 10) / 2)', { ...c.stats, SCORE: Number(v), LEVEL: c.level });
        const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
        return `<span class="stat-pill">${esc(k)}: <b>${v}</b> (${modStr})</span>`;
      }).join('');
      const equipEntries = Object.entries(c.equipment || {}).filter(([, item]) => Boolean(item));
      const equipHtml = equipEntries.length
        ? equipEntries.map(([slot, item]) => {
            const label = typeof item === 'string' ? item : (item.name || 'Equipped');
            return `<span class="stat-pill"><b>${esc(slot)}:</b> ${esc(label)}</span>`;
          }).join('')
        : '<span class="muted small">None equipped</span>';
      const invList = c.inventory || [];
      const invHtml = invList.length
        ? invList.map((it) => `<li><b>${esc(it.name)}</b> <span class="muted small">(${esc(it.category || 'item')}${it.qty > 1 ? ` ×${it.qty}` : ''}${it.damageDice ? ` • ${esc(it.damageDice)}` : ''})</span></li>`).join('')
        : '<li class="muted small">Empty inventory</li>';
      return `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(c.name)} (Lv ${c.level}${c.className ? ` ${esc(c.className)}` : ''})</strong>
            <span>HP ${c.hp}/${c.maxHp} • MP ${c.mp}/${c.maxMp} • AC ${c.ac} • DR ${c.dr || 0}</span>
          </div>
          <div class="muted small">XP ${c.xp || 0}/${c.xpToNext || c.level * 100} • Pts ${c.unspentStatPoints || 0} • Favor ${c.favor || 0} • ${c.currency?.gold || 0}G • ${c.currency?.manaStones || 0} Stones</div>
          <div class="stat-pills">${statPills}</div>
          <div class="small mt-xs"><b>Equipment:</b></div>
          <div class="stat-pills">${equipHtml}</div>
          <details class="sub-details mt-xs">
            <summary class="small">Inventory (${invList.length})</summary>
            <ul class="small" style="margin:4px 0 0 16px; padding:0;">${invHtml}</ul>
          </details>
          <div class="btn-row mt-xs">
            <button type="button" class="btn btn-xs btn-outline" data-view-char="${esc(c.id)}">View Character</button>
            <button type="button" class="btn btn-xs btn-purple" data-grant-xp="${esc(c.id)}">+50 XP</button>
            <button type="button" class="btn btn-xs btn-gold" data-grant-favor="${esc(c.id)}">+1 Favor</button>
            <button type="button" class="btn btn-xs btn-cyan" data-heal-char="${esc(c.id)}">+10 HP</button>
          </div>
        </div>
      `;
    }).join('');

    if ($('#dm-private-notes') && document.activeElement?.id !== 'dm-private-notes') $('#dm-private-notes').value = state.notes?.dmPrivate || '';
    if ($('#dm-shared-quests') && document.activeElement?.id !== 'dm-shared-quests') $('#dm-shared-quests').value = state.notes?.sharedQuests || '';

    if (typeof renderBeatDraftDesigner === 'function') renderBeatDraftDesigner();

    $('#dm-roll-log').innerHTML = (state.rollLog || []).map((r) => `
      <div class="feed-entry ${r.isSecret ? 'secret' : ''}">
        ${r.isSecret ? '<span class="tag tag-gold">SECRET</span> ' : ''}
        <strong>${esc(r.rollerName)}</strong> rolled <b>${esc(r.formula)}</b> (${esc(r.label)}) = <b>${r.total}</b>
      </div>
    `).join('');

    drawTowerCanvas('dm-tower-canvas', true);
    renderTowerFloorsAndBeats('dm-tower-floors-beats', true);
    renderDmFloorThemeRows();
    if (activeBeatMapId && !$('#beat-map-modal').classList.contains('hidden')) {
      renderBeatMapModal();
    }
    if (activeBeatDetailId && $('#beat-detail-view')?.classList.contains('active')) {
      renderBeatDetailModal();
    }
    if (activeDmCharModalId && !$('#dm-char-modal')?.classList.contains('hidden')) {
      renderDmCharModal(activeDmCharModalId);
    }
  }

  function renderTowerFloorsAndBeats(containerId, isDmView) {
    const el = document.getElementById(containerId);
    if (!el || !state?.map?.floors) return;
    const floors = [...state.map.floors].sort((a, b) => a.number - b.number);
    const mapTokens = state.map.tokens || [];
    const charsMap = state.characters || {};

    el.innerHTML = floors.map((fl) => {
      const theme = (fl.theme || 'obsidian').toUpperCase();
      const beats = (state.storyBeats || []).filter((b) => Number(b.floor) === Number(fl.number) && (isDmView || b.presented));
      const activeBeats = beats.filter((b) => b.presented || b.status === 'active');
      const resolvedBeats = beats.filter((b) => b.status === 'resolved');

      // 1. Players currently on this floor & their status
      const floorPlayerTokens = mapTokens.filter((t) => t.type === 'player' && t.y >= fl.rowStart && t.y <= fl.rowEnd);
      const playersHtml = floorPlayerTokens.length
        ? `<div class="stat-pills" style="margin-top:6px;">
            ${floorPlayerTokens.map((pt) => {
              const ch = charsMap[pt.id];
              const hp = ch ? ch.hp : pt.hp;
              const maxHp = ch ? ch.maxHp : pt.maxHp;
              const mp = ch ? ch.mp : null;
              const maxMp = ch ? ch.maxMp : null;
              const statusText = hp <= 0 ? 'Downed' : (maxHp && hp <= maxHp * 0.5 ? 'Wounded' : 'Healthy');
              const condText = ch?.conditions?.length ? ` • ${ch.conditions.join(', ')}` : '';
              return `<span class="stat-pill"><b>${esc(ch?.name || pt.name)}</b> (Lv ${ch?.level || 1}) • HP ${hp}/${maxHp}${mp !== null ? ` • MP ${mp}/${maxMp}` : ''} • <i>${esc(statusText)}${esc(condText)}</i></span>`;
            }).join('')}
          </div>`
        : '<div class="muted small" style="margin-top:6px;">No players currently on this floor.</div>';

      // 2. Current & all Story Beats on this floor
      const beatsHtml = beats.length
        ? beats.map((b) => {
            const isCurrent = b.presented || b.status === 'active';
            return `
              <div class="item-card ${isCurrent ? 'card-glow-cyan' : ''}" style="margin-top:6px;">
                <div class="item-card-top">
                  <strong>${esc(b.title)} ${isCurrent ? '<span class="tag tag-cyan">CURRENT BEAT</span>' : `<span class="tag tag-gold">${esc((b.status || 'upcoming').toUpperCase())}</span>`}</strong>
                  <button type="button" class="btn btn-xs btn-gold" data-beat-open="${esc(b.id)}">View Beat</button>
                </div>
                ${b.narration ? `<div class="muted small">${esc(b.narration)}</div>` : ''}
              </div>
            `;
          }).join('')
        : '<div class="muted small" style="margin-top:4px;">No story beats on this floor yet.</div>';

      // 3. Floor Overview (what happened on this floor)
      const openedChests = beats.reduce((n, b) => n + (b.arena?.chests || []).filter((c) => c.opened).length, 0);
      const talkedNpcs = beats.reduce((n, b) => n + (b.arena?.tokens || []).filter((t) => t.type === 'npc' && t.rewardClaimed).length, 0);
      const defeatedMons = beats.reduce((n, b) => n + (b.arena?.tokens || []).filter((t) => t.type === 'monster' && t.hp !== null && t.hp <= 0).length, 0);
      const floorLogs = (state.combatLog || [])
        .filter((l) => (l.summary || '').includes(`${fl.number}F`))
        .slice(0, 3);
      const summaryParts = [
        `${beats.length} Story Beat${beats.length === 1 ? '' : 's'} (${activeBeats.length} active, ${resolvedBeats.length} resolved)`,
        defeatedMons ? `${defeatedMons} monster${defeatedMons === 1 ? '' : 's'} defeated` : '',
        openedChests ? `${openedChests} chest${openedChests === 1 ? '' : 's'} opened` : '',
        talkedNpcs ? `${talkedNpcs} NPC reward${talkedNpcs === 1 ? '' : 's'} claimed` : '',
      ].filter(Boolean).join(' • ');

      return `
        <div class="panel" style="padding:10px 12px;">
          <div class="panel-header">
            <strong>${esc(fl.title)}</strong>
            <div class="btn-row" style="align-items:center;">
              <span class="tag tag-green">${esc(theme)}</span>
              ${isDmView && floors.length > 1 ? `<button type="button" class="btn btn-xs btn-danger-outline" data-dm-delete-floor="${fl.number}" data-floor-title="${esc(fl.title)}">Delete Floor</button>` : ''}
            </div>
          </div>
          ${fl.description ? `<div class="muted small" style="margin-top:2px;">${esc(fl.description)}</div>` : ''}
          <div class="small" style="margin-top:6px;"><b>Overview:</b> ${esc(summaryParts)}</div>
          ${floorLogs.length ? `<div class="muted small" style="margin-top:3px;">Recent: ${floorLogs.map((l) => esc(l.summary)).join(' | ')}</div>` : ''}
          <div class="small" style="margin-top:6px;"><b>Players on ${fl.number}F:</b></div>
          ${playersHtml}
          <div class="small" style="margin-top:8px;"><b>Story Beats on ${fl.number}F:</b></div>
          ${beatsHtml}
        </div>
      `;
    }).join('');
  }

  function renderDmFloorThemeRows() {
    const el = $('#dm-floor-theme-rows');
    if (!el || !state?.map?.floors) return;
    const themes = ['forest', 'desert', 'underworld', 'plains', 'frost', 'obsidian'];
    const floors = [...state.map.floors].sort((a, b) => a.number - b.number);
    el.innerHTML = floors.map((fl) => `
      <label class="chip-btn" style="display:inline-flex; align-items:center; gap:6px;">
        <span>${fl.number}F:</span>
        <select data-floor-theme-pick="${fl.number}" style="width:auto; min-height:26px; padding:2px 6px;">
          ${themes.map((t) => `<option value="${t}" ${fl.theme === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
        </select>
      </label>
    `).join('');
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
    const floorThemeColors = {
      forest:     { top: '#11291a', bot: '#09180f', spine: '#4ade80', border: '#22c55e' },
      desert:     { top: '#3b2812', bot: '#211508', spine: '#fbbf24', border: '#f59e0b' },
      underworld: { top: '#310d14', bot: '#18060a', spine: '#f87171', border: '#ef4444' },
      plains:     { top: '#1f2d14', bot: '#111a0b', spine: '#a3e635', border: '#84cc16' },
      frost:      { top: '#0e293d', bot: '#081826', spine: '#7dd3fc', border: '#38bdf8' },
      obsidian:   { top: '#0f172a', bot: '#090f1d', spine: '#38bdf8', border: '#38bdf8' },
    };
    for (const fl of state.map.floors || []) {
      const yTop = fl.rowStart * cellSize;
      const flH = (fl.rowEnd - fl.rowStart + 1) * cellSize;
      const thKey = fl.theme || (fl.safeZone ? 'forest' : 'obsidian');
      const th = floorThemeColors[thKey] || floorThemeColors.obsidian;
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop + flH);
      grad.addColorStop(0, th.top);
      grad.addColorStop(1, th.bot);
      ctx.fillStyle = grad;
      ctx.fillRect(labelW, yTop, cols * cellSize, flH);

      // Floor Left Spine Marker
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, yTop, labelW, flH);
      ctx.fillStyle = th.spine;
      ctx.font = 'bold 13px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${fl.number}F`, labelW / 2, yTop + flH / 2 + 4);

      // Floor header banner + Theme + Story Beats summary
      const floorBeats = (state.storyBeats || []).filter((b) => Number(b.floor) === Number(fl.number) && (isDmView || b.presented));
      const beatNames = floorBeats.length ? ` • Beats: ${floorBeats.map((b) => b.title).join(' | ')}` : '';
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${fl.title} [${thKey.toUpperCase()}]${beatNames}`, labelW + 8, yTop + 15);

      // Warp Gate / Ascend Portal
      const px = labelW + fl.portalCol * cellSize + cellSize / 2;
      const py = fl.portalRow * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.strokeStyle = th.border;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.fill();

      // Floor Divider Line
      ctx.strokeStyle = th.border;
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

  $('#player-tower-canvas')?.addEventListener('click', async (ev) => {
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
    renderTowerFloorsAndBeats('p-tower-floors-beats', false);
        measureStart = null;
      }
      drawTowerCanvas('player-tower-canvas', false);
    renderTowerFloorsAndBeats('p-tower-floors-beats', false);
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

  $('#dm-tower-canvas')?.addEventListener('click', async (ev) => {
    const cell = getGridCellFromClick(ev.currentTarget, ev);
    if (!cell || !session) return;
    if (dmMapTool === 'move') {
      const hitTok = (state.map.tokens || []).find((t) => t.x === cell.x && t.y === cell.y);
      if (hitTok) {
        dmSelectedTokenId = hitTok.id;
        drawTowerCanvas('dm-tower-canvas', true);
    renderTowerFloorsAndBeats('dm-tower-floors-beats', true);
    renderDmFloorThemeRows();
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
    renderTowerFloorsAndBeats('dm-tower-floors-beats', true);
    renderDmFloorThemeRows();
        measureStart = null;
      }
      drawTowerCanvas('dm-tower-canvas', true);
    renderTowerFloorsAndBeats('dm-tower-floors-beats', true);
    renderDmFloorThemeRows();
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
  function renderDiePolyhedronSvg(sides) {
    const s = Number(sides || 20);
    if (s === 4) {
      return '<svg viewBox="0 0 64 64"><polygon points="32,6 58,54 6,54" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    }
    if (s === 6) {
      return '<svg viewBox="0 0 64 64"><rect x="10" y="10" width="44" height="44" rx="8" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" stroke-width="2.5"/></svg>';
    }
    if (s === 8) {
      return '<svg viewBox="0 0 64 64"><polygon points="32,5 57,32 32,59 7,32" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round"/><line x1="7" y1="32" x2="57" y2="32" stroke="rgba(56,189,248,0.35)" stroke-width="1.5"/></svg>';
    }
    if (s === 10 || s === 100) {
      return '<svg viewBox="0 0 64 64"><polygon points="32,5 56,28 32,59 8,28" fill="rgba(168,85,247,0.18)" stroke="#a855f7" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    }
    if (s === 12) {
      return '<svg viewBox="0 0 64 64"><polygon points="32,6 56,24 47,54 17,54 8,24" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    }
    return '<svg viewBox="0 0 64 64"><polygon points="32,5 55,18 55,46 32,59 9,46 9,18" fill="rgba(56,189,248,0.16)" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round"/><polygon points="32,14 48,42 16,42" fill="none" stroke="rgba(56,189,248,0.35)" stroke-width="1.3"/></svg>';
  }

  function simulateDiceTray(stageId, sides, roll) {
    const stage = document.getElementById(stageId);
    if (!stage || !roll) return;
    const rolls = Array.isArray(roll.rolls) && roll.rolls.length ? roll.rolls : [roll.total];
    const s = Number(sides || 20);
    const svg = renderDiePolyhedronSvg(s);

    stage.innerHTML = rolls.map((_, idx) => `
      <div class="dice-sim-die rolling" data-die-idx="${idx}">
        ${svg}
        <span class="dice-sim-val">${Math.floor(Math.random() * s) + 1}</span>
      </div>
    `).join('') + `<div class="dice-sim-total">Rolling <b>${esc(roll.formula)}</b>...</div>`;

    const tick = setInterval(() => {
      stage.querySelectorAll('.dice-sim-die.rolling .dice-sim-val').forEach((el) => {
        el.textContent = String(Math.floor(Math.random() * s) + 1);
      });
    }, 65);

    setTimeout(() => {
      clearInterval(tick);
      stage.querySelectorAll('.dice-sim-die').forEach((dieEl, idx) => {
        dieEl.classList.remove('rolling');
        const val = Number(rolls[idx] ?? roll.total);
        dieEl.querySelector('.dice-sim-val').textContent = String(val);
        if (s >= 4 && val === s) dieEl.classList.add('crit');
        else if (s >= 4 && val === 1) dieEl.classList.add('fumble');
      });
      const totalEl = stage.querySelector('.dice-sim-total');
      if (totalEl) {
        totalEl.innerHTML = `<b>${esc(roll.formula)}</b> (${esc(roll.label || 'Roll')}) = <strong class="tag tag-gold">${roll.total}</strong>`;
      }
    }, 460);
  }

  function displayLastRoll(roll) {
    if (!roll) return;
    const sidesMatch = String(roll.formula || '').match(/d(\d+)/i);
    simulateDiceTray('p-dice-sim-stage', sidesMatch ? Number(sidesMatch[1]) : 20, roll);
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
  let stagedBeatNpcs = [];
  let stagedBeatTreasures = [];
  let draftPlayerPositions = {}; // { [charId]: { x, y } }
  let draftChests = [];          // [{ name, x, y, gold, itemName }]
  let draftBiome = 'obsidian';
  let draftTerrain = [];         // [{ x, y, type: 'tree'|'rock'|'water' }]
  let draftSelectedTool = null;  // { kind: 'player', id } | { kind: 'monster', index } | { kind: 'chest' | 'tree' | 'rock' | 'water' }
  let draftHoverCell = null;

  function getScaledCanvasCell(canvas, clientX, clientY, axisPad, cellPx) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / rect.width);
    const py = (clientY - rect.top) * (canvas.height / rect.height);
    return {
      x: Math.floor((px - axisPad) / cellPx),
      y: Math.floor((py - axisPad) / cellPx),
    };
  }

  function hashSeedStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeSeededRng(seed) {
    let s = (seed || 1) >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function generateLocalDraftTerrain(promptText, cols, rows, explicitBiome, occupiedSet) {
    const lower = String(promptText || '').toLowerCase();
    let biome = ['obsidian', 'forest', 'plains', 'desert'].includes(explicitBiome) ? explicitBiome : 'obsidian';
    if (!explicitBiome || explicitBiome === 'obsidian') {
      if (/\b(forest|wood|woods|grove|jungle|glade|thicket|canopy|trees?)\b/.test(lower)) biome = 'forest';
      else if (/\b(desert|sand|dune|oasis|arid|canyon|wasteland|sunbaked)\b/.test(lower)) biome = 'desert';
      else if (/\b(plain|plains|meadow|grass|steppe|field|prairie|savanna)\b/.test(lower)) biome = 'plains';
    }
    const rng = makeSeededRng(hashSeedStr(`${promptText || ''}|${cols}x${rows}|${biome}`));
    const terrain = [];
    const seen = new Set(occupiedSet || []);
    const addTile = (x, y, type) => {
      if (x < 0 || x >= cols || y < 0 || y >= rows) return;
      const k = `${x},${y}`;
      if (seen.has(k)) return;
      seen.add(k);
      terrain.push({ x, y, type });
    };

    const wantsWater = /\b(river|stream|water|creek|brook|lake|pond|ford|moat|flood|oasis|marsh)\b/.test(lower);
    const wantsRocks = /\b(rock|rocks|boulder|boulders|crag|cliff|stone|ruin|ruins|rubble|canyon|pillar)\b/.test(lower);
    const wantsTrees = /\b(tree|trees|forest|wood|woods|grove|jungle|thicket|timber)\b/.test(lower) || biome === 'forest';

    if (wantsWater || (lower.trim() && rng() < 0.35)) {
      const horizontal = rng() < 0.6;
      const ford1 = Math.floor((horizontal ? cols : rows) * (0.28 + rng() * 0.14));
      const ford2 = Math.floor((horizontal ? cols : rows) * (0.66 + rng() * 0.14));
      let pos = Math.floor((horizontal ? rows : cols) * (0.35 + rng() * 0.3));
      const len = horizontal ? cols : rows;
      for (let i = 0; i < len; i++) {
        if (i === ford1 || i === ford1 + 1 || i === ford2) continue;
        if (horizontal) {
          addTile(i, pos, 'water');
          if (rng() < 0.35) addTile(i, pos + 1, 'water');
        } else {
          addTile(pos, i, 'water');
          if (rng() < 0.35) addTile(pos + 1, i, 'water');
        }
        if (rng() < 0.4) pos += rng() < 0.5 ? -1 : 1;
        pos = Math.max(2, Math.min((horizontal ? rows : cols) - 3, pos));
      }
    }

    const area = cols * rows;
    const rockCount = Math.max(2, Math.round(area * (wantsRocks ? 0.055 : 0.02)));
    for (let i = 0; i < rockCount; i++) {
      const rx = Math.floor(rng() * cols);
      const ry = Math.floor(rng() * rows);
      addTile(rx, ry, 'rock');
      if (wantsRocks && rng() < 0.35) addTile(rx + (rng() < 0.5 ? 1 : -1), ry, 'rock');
    }

    const treeDensity = biome === 'forest' ? 0.09 : biome === 'plains' ? 0.03 : biome === 'desert' ? 0.008 : 0.015;
    const treeCount = Math.round(area * (wantsTrees ? Math.max(treeDensity, 0.06) : treeDensity));
    for (let i = 0; i < treeCount; i++) {
      addTile(Math.floor(rng() * cols), Math.floor(rng() * rows), 'tree');
    }
    return { biome, terrain };
  }

  function drawArenaBackground(ctx, biome, axisPad, cols, rows, cellPx, w, h) {
    const palettes = {
      obsidian: { bg: '#070b14', alt: 'rgba(56, 189, 248, 0.03)', grid: 'rgba(56, 189, 248, 0.2)', axis: '#64748b' },
      forest:   { bg: '#102116', alt: 'rgba(74, 222, 128, 0.05)', grid: 'rgba(74, 222, 128, 0.18)', axis: '#86efac' },
      plains:   { bg: '#1e2b15', alt: 'rgba(163, 230, 53, 0.05)', grid: 'rgba(163, 230, 53, 0.18)', axis: '#bef264' },
      desert:   { bg: '#2b1e10', alt: 'rgba(251, 191, 36, 0.06)', grid: 'rgba(251, 191, 36, 0.18)', axis: '#fcd34d' },
    };
    const pal = palettes[biome] || palettes.obsidian;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle biome texture patches
    ctx.fillStyle = pal.alt;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (((x * 13 + y * 29) % 7) === 0) {
          ctx.fillRect(axisPad + x * cellPx, axisPad + y * cellPx, cellPx, cellPx);
        }
      }
    }

    ctx.fillStyle = pal.axis;
    ctx.font = `bold ${cellPx >= 36 ? 10 : 9}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    for (let x = 0; x < cols; x++) ctx.fillText(String(x + 1), axisPad + x * cellPx + cellPx / 2, axisPad - 8);
    for (let y = 0; y < rows; y++) ctx.fillText(String(y + 1), Math.floor(axisPad / 2), axisPad + y * cellPx + cellPx / 2 + 3);

    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath(); ctx.moveTo(axisPad + x * cellPx, axisPad); ctx.lineTo(axisPad + x * cellPx, h); ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath(); ctx.moveTo(axisPad, axisPad + y * cellPx); ctx.lineTo(w, axisPad + y * cellPx); ctx.stroke();
    }
  }

  function drawTerrainTile(ctx, tile, cx, cy, cellPx, biome) {
    const half = cellPx / 2;
    const x0 = cx - half;
    const y0 = cy - half;
    if (tile.type === 'water') {
      ctx.fillStyle = '#0369a1';
      ctx.fillRect(x0 + 1, y0 + 1, cellPx - 2, cellPx - 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = Math.max(1, cellPx * 0.06);
      ctx.beginPath();
      ctx.moveTo(x0 + cellPx * 0.2, cy - cellPx * 0.14);
      ctx.quadraticCurveTo(cx, cy - cellPx * 0.24, x0 + cellPx * 0.8, cy - cellPx * 0.14);
      ctx.moveTo(x0 + cellPx * 0.22, cy + cellPx * 0.16);
      ctx.quadraticCurveTo(cx, cy + cellPx * 0.06, x0 + cellPx * 0.78, cy + cellPx * 0.16);
      ctx.stroke();
    } else if (tile.type === 'rock') {
      ctx.fillStyle = biome === 'desert' ? '#92400e' : '#475569';
      ctx.beginPath();
      ctx.moveTo(cx - cellPx * 0.34, cy + cellPx * 0.26);
      ctx.lineTo(cx - cellPx * 0.38, cy - cellPx * 0.08);
      ctx.lineTo(cx - cellPx * 0.08, cy - cellPx * 0.34);
      ctx.lineTo(cx + cellPx * 0.32, cy - cellPx * 0.2);
      ctx.lineTo(cx + cellPx * 0.36, cy + cellPx * 0.24);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = biome === 'desert' ? '#f59e0b' : '#94a3b8';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(cx - cellPx * 0.08, cy - cellPx * 0.12, cellPx * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else if (tile.type === 'tree') {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(cx + 1, cy + cellPx * 0.26, cellPx * 0.28, cellPx * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#78350f';
      ctx.fillRect(cx - cellPx * 0.08, cy + cellPx * 0.05, cellPx * 0.16, cellPx * 0.24);
      ctx.fillStyle = biome === 'desert' ? '#65a30d' : '#15803d';
      ctx.beginPath();
      ctx.arc(cx, cy - cellPx * 0.05, cellPx * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = biome === 'desert' ? '#84cc16' : '#22c55e';
      ctx.beginPath();
      ctx.arc(cx - cellPx * 0.07, cy - cellPx * 0.12, cellPx * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function getDraftCellPx(gridSize) {
    return gridSize >= 50 ? 22 : gridSize >= 40 ? 24 : gridSize >= 30 ? 26 : 30;
  }

  function renderBeatDraftDesigner() {
    const palette = $('#beat-draft-palette');
    const canvas = $('#beat-draft-canvas');
    if (!palette || !canvas || !state?.characters) return;

    const gridSize = Number($('#beat-grid-size')?.value || 20);
    const chars = Object.values(state.characters);
    if (!draftSelectedTool && chars[0]) draftSelectedTool = { kind: 'player', id: chars[0].id };

    // Initialize default starting coordinates for players if not set
    const startX = Math.max(0, Math.floor(gridSize / 2) - Math.floor(chars.length / 2));
    const startY = Math.max(0, gridSize - 4);
    chars.forEach((ch, idx) => {
      if (!draftPlayerPositions[ch.id]) {
        draftPlayerPositions[ch.id] = { x: Math.min(gridSize - 1, startX + idx * 2), y: startY };
      }
      draftPlayerPositions[ch.id].x = Math.min(gridSize - 1, draftPlayerPositions[ch.id].x);
      draftPlayerPositions[ch.id].y = Math.min(gridSize - 1, draftPlayerPositions[ch.id].y);
    });

    const chips = [
      ...chars.map((ch) => {
        const active = draftSelectedTool?.kind === 'player' && draftSelectedTool.id === ch.id;
        return `<button type="button" class="chip-btn ${active ? 'active' : ''}" data-draft-pick="player" data-id="${esc(ch.id)}">${esc(ch.name.split(' ')[0])}</button>`;
      }),
      ...stagedBeatMonsters.map((m, idx) => {
        const active = draftSelectedTool?.kind === 'monster' && draftSelectedTool.index === idx;
        return `<button type="button" class="chip-btn ${active ? 'active' : ''}" data-draft-pick="monster" data-idx="${idx}" style="border-color:rgba(239,68,68,0.6);">${esc(m.name)}</button>`;
      }),
      ...stagedBeatNpcs.map((n, idx) => {
        const active = draftSelectedTool?.kind === 'npc' && draftSelectedTool.index === idx;
        return `<button type="button" class="chip-btn ${active ? 'active' : ''}" data-draft-pick="npc" data-idx="${idx}" style="border-color:rgba(16,185,129,0.7); color:#34d399;">${esc(n.name)}</button>`;
      }),
      `<button type="button" class="chip-btn ${draftSelectedTool?.kind === 'chest' ? 'active' : ''}" data-draft-pick="chest" style="border-color:rgba(251,191,36,0.7); color:#fbbf24;">+ Treasure Chest</button>`,
      `<button type="button" class="chip-btn ${draftSelectedTool?.kind === 'tree' ? 'active' : ''}" data-draft-pick="tree" style="border-color:rgba(34,197,94,0.6); color:#4ade80;">Tree</button>`,
      `<button type="button" class="chip-btn ${draftSelectedTool?.kind === 'rock' ? 'active' : ''}" data-draft-pick="rock" style="border-color:rgba(148,163,184,0.6); color:#cbd5e1;">Rock</button>`,
      `<button type="button" class="chip-btn ${draftSelectedTool?.kind === 'water' ? 'active' : ''}" data-draft-pick="water" style="border-color:rgba(56,189,248,0.6); color:#38bdf8;">Water</button>`,
    ];
    palette.innerHTML = chips.join('');

    const cellPx = getDraftCellPx(gridSize);
    const axisPad = 22;
    const w = axisPad + gridSize * cellPx;
    const h = axisPad + gridSize * cellPx;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    drawArenaBackground(ctx, draftBiome, axisPad, gridSize, gridSize, cellPx, w, h);

    if (draftHoverCell && draftHoverCell.x >= 0 && draftHoverCell.x < gridSize && draftHoverCell.y >= 0 && draftHoverCell.y < gridSize) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.fillRect(axisPad + draftHoverCell.x * cellPx, axisPad + draftHoverCell.y * cellPx, cellPx, cellPx);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(axisPad + draftHoverCell.x * cellPx + 0.5, axisPad + draftHoverCell.y * cellPx + 0.5, cellPx - 1, cellPx - 1);
    }

    // Draw Impassable Terrain
    for (const tile of draftTerrain) {
      if (tile.x >= gridSize || tile.y >= gridSize) continue;
      const cx = axisPad + tile.x * cellPx + cellPx / 2;
      const cy = axisPad + tile.y * cellPx + cellPx / 2;
      drawTerrainTile(ctx, tile, cx, cy, cellPx, draftBiome);
    }

    // Draw staged Treasure Chests
    for (const c of draftChests) {
      const cx = axisPad + c.x * cellPx + cellPx / 2;
      const cy = axisPad + c.y * cellPx + cellPx / 2;
      drawChestIcon(ctx, c, cx, cy, cellPx);
    }

    // Draw player starting positions
    for (const ch of chars) {
      const pos = draftPlayerPositions[ch.id];
      if (!pos) continue;
      const cx = axisPad + pos.x * cellPx + cellPx / 2;
      const cy = axisPad + pos.y * cellPx + cellPx / 2;
      const tok = { id: ch.id, name: ch.name, type: 'player', label: ch.name.slice(0, 2).toUpperCase() };
      drawTokenAvatar(ctx, tok, cx, cy, Math.max(7, Math.floor(cellPx * 0.4)), draftSelectedTool?.kind === 'player' && draftSelectedTool.id === ch.id);
    }

    // Draw attached monsters starting positions
    stagedBeatMonsters.forEach((m, idx) => {
      const mx = (m.startX ? Number(m.startX) - 1 : Math.min(gridSize - 1, startX + idx * 2));
      const my = (m.startY ? Number(m.startY) - 1 : Math.min(gridSize - 1, 3));
      const cx = axisPad + mx * cellPx + cellPx / 2;
      const cy = axisPad + my * cellPx + cellPx / 2;
      const tok = { id: `draft-mon-${idx}`, name: m.name, type: 'monster', label: m.name.slice(0, 2).toUpperCase() };
      drawTokenAvatar(ctx, tok, cx, cy, Math.max(7, Math.floor(cellPx * 0.4)), draftSelectedTool?.kind === 'monster' && draftSelectedTool.index === idx);
    });

    // Draw attached NPCs starting positions
    stagedBeatNpcs.forEach((n, idx) => {
      const nx = (n.startX ? Number(n.startX) - 1 : Math.min(gridSize - 1, 2 + idx * 2));
      const ny = (n.startY ? Number(n.startY) - 1 : Math.min(gridSize - 1, Math.floor(gridSize / 2)));
      const cx = axisPad + nx * cellPx + cellPx / 2;
      const cy = axisPad + ny * cellPx + cellPx / 2;
      const tok = { id: `draft-npc-${idx}`, name: n.name, type: 'npc', label: n.name.slice(0, 2).toUpperCase() };
      drawTokenAvatar(ctx, tok, cx, cy, Math.max(7, Math.floor(cellPx * 0.4)), draftSelectedTool?.kind === 'npc' && draftSelectedTool.index === idx);
    });
  }

  $('#beat-grid-size').addEventListener('change', renderBeatDraftDesigner);
  $('#beat-draft-biome').addEventListener('change', (ev) => {
    draftBiome = ev.target.value || 'obsidian';
    renderBeatDraftDesigner();
  });
  $('#btn-draft-gen-terrain').addEventListener('click', () => {
    const gridSize = Number($('#beat-grid-size')?.value || 20);
    const prompt = $('#beat-draft-prompt').value.trim();
    const occ = new Set();
    Object.values(draftPlayerPositions).forEach((p) => { if (p) occ.add(`${p.x},${p.y}`); });
    stagedBeatMonsters.forEach((m) => { if (m.startX && m.startY) occ.add(`${Number(m.startX) - 1},${Number(m.startY) - 1}`); });
    draftChests.forEach((c) => occ.add(`${c.x},${c.y}`));
    const gen = generateLocalDraftTerrain(prompt, gridSize, gridSize, draftBiome, occ);
    draftBiome = gen.biome;
    draftTerrain = gen.terrain;
    $('#beat-draft-biome').value = draftBiome;
    $('#beat-draft-hint').textContent = `Generated ${draftTerrain.length} terrain tiles (${draftBiome}).`;
    renderBeatDraftDesigner();
  });
  $('#beat-map-designer-details').addEventListener('toggle', () => {
    if ($('#beat-map-designer-details').open) renderBeatDraftDesigner();
  });

  $('#beat-draft-palette').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-draft-pick]');
    if (!btn) return;
    const kind = btn.dataset.draftPick;
    if (kind === 'player') draftSelectedTool = { kind: 'player', id: btn.dataset.id };
    else if (kind === 'monster') draftSelectedTool = { kind: 'monster', index: Number(btn.dataset.idx) };
    else if (kind === 'npc') draftSelectedTool = { kind: 'npc', index: Number(btn.dataset.idx) };
    else draftSelectedTool = { kind };
    renderBeatDraftDesigner();
  });

  $('#beat-draft-canvas').addEventListener('mousemove', (ev) => {
    const gridSize = Number($('#beat-grid-size')?.value || 20);
    const cellPx = getDraftCellPx(gridSize);
    const cell = getScaledCanvasCell(ev.currentTarget, ev.clientX, ev.clientY, 22, cellPx);
    if (cell.x >= 0 && cell.x < gridSize && cell.y >= 0 && cell.y < gridSize) {
      if (!draftHoverCell || draftHoverCell.x !== cell.x || draftHoverCell.y !== cell.y) {
        draftHoverCell = cell;
        renderBeatDraftDesigner();
      }
    } else if (draftHoverCell) {
      draftHoverCell = null;
      renderBeatDraftDesigner();
    }
  });

  $('#beat-draft-canvas').addEventListener('mouseleave', () => {
    if (draftHoverCell) {
      draftHoverCell = null;
      renderBeatDraftDesigner();
    }
  });

  $('#beat-draft-canvas').addEventListener('click', (ev) => {
    const gridSize = Number($('#beat-grid-size')?.value || 20);
    const cellPx = getDraftCellPx(gridSize);
    const { x, y } = getScaledCanvasCell(ev.currentTarget, ev.clientX, ev.clientY, 22, cellPx);
    if (x < 0 || x >= gridSize || y < 0 || y >= gridSize || !draftSelectedTool) return;

    if (draftSelectedTool.kind === 'player') {
      draftPlayerPositions[draftSelectedTool.id] = { x, y };
      $('#beat-draft-hint').textContent = `Set player start to (${x + 1}, ${y + 1}).`;
    } else if (draftSelectedTool.kind === 'monster') {
      const m = stagedBeatMonsters[draftSelectedTool.index];
      if (m) {
        m.startX = x + 1;
        m.startY = y + 1;
        $('#beat-draft-hint').textContent = `Set ${m.name} start to (${x + 1}, ${y + 1}).`;
      }
    } else if (draftSelectedTool.kind === 'npc') {
      const n = stagedBeatNpcs[draftSelectedTool.index];
      if (n) {
        n.startX = x + 1;
        n.startY = y + 1;
        $('#beat-draft-hint').textContent = `Set NPC ${n.name} start to (${x + 1}, ${y + 1}).`;
      }
    } else if (draftSelectedTool.kind === 'tree' || draftSelectedTool.kind === 'rock' || draftSelectedTool.kind === 'water') {
      const idx = draftTerrain.findIndex((t) => t.x === x && t.y === y);
      if (idx >= 0 && draftTerrain[idx].type === draftSelectedTool.kind) {
        draftTerrain.splice(idx, 1);
        $('#beat-draft-hint').textContent = `Cleared ${draftSelectedTool.kind} at (${x + 1}, ${y + 1}).`;
      } else if (idx >= 0) {
        draftTerrain[idx].type = draftSelectedTool.kind;
        $('#beat-draft-hint').textContent = `Set ${draftSelectedTool.kind} at (${x + 1}, ${y + 1}).`;
      } else {
        draftTerrain.push({ x, y, type: draftSelectedTool.kind });
        $('#beat-draft-hint').textContent = `Placed ${draftSelectedTool.kind} at (${x + 1}, ${y + 1}).`;
      }
    } else if (draftSelectedTool.kind === 'chest') {
      const existingIdx = draftChests.findIndex((c) => c.x === x && c.y === y);
      if (existingIdx >= 0) {
        draftChests.splice(existingIdx, 1);
        $('#beat-draft-hint').textContent = `Removed chest at (${x + 1}, ${y + 1}).`;
      } else {
        draftChests.push({
          name: $('#draft-chest-name').value.trim() || 'Treasure Chest',
          gold: Number($('#draft-chest-gold').value || 0),
          manaStones: 1,
          itemName: $('#draft-chest-item').value.trim(),
          x,
          y,
        });
        $('#beat-draft-hint').textContent = `Placed Treasure Chest at (${x + 1}, ${y + 1}). Click again to remove.`;
      }
    }
    renderBeatDraftDesigner();
  });

  function renderStagedBeatAttachments() {
    const monEl = $('#beat-encounters-staged');
    const npcEl = $('#beat-npcs-staged');
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
    if (npcEl) {
      npcEl.innerHTML = stagedBeatNpcs.map((n, i) => `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(n.name)} <span class="tag tag-green">${esc(n.npcRole || 'NPC')}</span></strong>
            <span>${n.startX && n.startY ? `Start (${n.startX}, ${n.startY})` : 'Auto Start'}</span>
            <button type="button" class="btn btn-xs btn-danger-outline" data-unstage-npc="${i}">Remove</button>
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

  $('#btn-stage-beat-npc')?.addEventListener('click', () => {
    const name = $('#beat-npc-name').value.trim();
    if (!name) return showToast({ title: 'NPC NAME NEEDED', message: 'Enter an NPC name before adding.', category: 'warning' });
    stagedBeatNpcs.push({
      name,
      npcRole: $('#beat-npc-role').value.trim() || 'NPC',
      startX: $('#beat-npc-x').value ? Number($('#beat-npc-x').value) : null,
      startY: $('#beat-npc-y').value ? Number($('#beat-npc-y').value) : null,
      dialogue: $('#beat-npc-dialogue')?.value.trim() || '',
      rewardType: $('#beat-npc-reward-type')?.value || 'none',
      rewardItemName: $('#beat-npc-reward-name')?.value.trim() || '',
      rewardXp: Number($('#beat-npc-reward-xp')?.value || 0),
    });
    $('#beat-npc-name').value = '';
    $('#beat-npc-role').value = '';
    $('#beat-npc-x').value = '';
    $('#beat-npc-y').value = '';
    if ($('#beat-npc-dialogue')) $('#beat-npc-dialogue').value = '';
    if ($('#beat-npc-reward-name')) $('#beat-npc-reward-name').value = '';
    renderStagedBeatAttachments();
    renderBeatDraftDesigner();
  });

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
      loot: {
        itemName: $('#beat-mon-loot-item')?.value.trim() || '',
        gold: Number($('#beat-mon-loot-gold')?.value || 0),
        manaStones: Number($('#beat-mon-loot-stones')?.value || 0),
      },
    });
    $('#beat-mon-name').value = '';
    $('#beat-mon-x').value = '';
    $('#beat-mon-y').value = '';
    if ($('#beat-mon-loot-item')) $('#beat-mon-loot-item').value = '';
    if ($('#beat-mon-loot-gold')) $('#beat-mon-loot-gold').value = '0';
    if ($('#beat-mon-loot-stones')) $('#beat-mon-loot-stones').value = '0';
    renderStagedBeatAttachments();
    renderBeatDraftDesigner();
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
        loot: {
          itemName: $('#beat-mon-loot-item')?.value.trim() || '',
          gold: Number($('#beat-mon-loot-gold')?.value || 0),
          manaStones: Number($('#beat-mon-loot-stones')?.value || 0),
        },
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

    const npcs = [...stagedBeatNpcs];
    const npcName = $('#beat-npc-name')?.value.trim();
    if (npcName) {
      npcs.push({
        name: npcName,
        npcRole: $('#beat-npc-role')?.value.trim() || 'NPC',
        startX: $('#beat-npc-x')?.value ? Number($('#beat-npc-x').value) : null,
        startY: $('#beat-npc-y')?.value ? Number($('#beat-npc-y').value) : null,
        dialogue: $('#beat-npc-dialogue')?.value.trim() || '',
        rewardType: $('#beat-npc-reward-type')?.value || 'none',
        rewardItemName: $('#beat-npc-reward-name')?.value.trim() || '',
        rewardXp: Number($('#beat-npc-reward-xp')?.value || 0),
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
      npcs,
      treasures,
      playerPositions: draftPlayerPositions,
      chests: draftChests,
      biome: draftBiome,
      terrain: draftTerrain,
      arenaPrompt: $('#beat-draft-prompt')?.value.trim() || '',
    });
    stagedBeatMonsters = [];
    stagedBeatNpcs = [];
    stagedBeatTreasures = [];
    draftPlayerPositions = {};
    draftChests = [];
    draftBiome = 'obsidian';
    draftTerrain = [];
    ev.target.reset();
    if ($('#beat-draft-biome')) $('#beat-draft-biome').value = 'obsidian';
    renderStagedBeatAttachments();
    renderBeatDraftDesigner();
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
      loot: {
        itemName: $('#dm-mon-loot-item')?.value.trim() || '',
        gold: Number($('#dm-mon-loot-gold')?.value || 0),
        xp: Number($('#dm-mon-loot-xp')?.value || 0),
      },
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
    if ($('#dm-sess-title')) $('#dm-sess-title').value = state?.session?.title || '';
    if ($('#dm-sess-pause-msg')) $('#dm-sess-pause-msg').value = state?.session?.pausedMessage || '';
    $('#dm-session-modal')?.classList.remove('hidden');
  });
  $('#btn-close-session-modal')?.addEventListener('click', () => {
    $('#dm-session-modal')?.classList.add('hidden');
  });
  $('#btn-dm-start-session').addEventListener('click', async () => {
    await sendAction('session_control', {
      action: 'start',
      title: $('#dm-sess-title').value,
      pausedMessage: $('#dm-sess-pause-msg').value,
    });
    $('#dm-session-modal')?.classList.add('hidden');
  });
  $('#btn-dm-stop-session').addEventListener('click', async () => {
    await sendAction('session_control', {
      action: 'stop',
      title: $('#dm-sess-title').value,
      pausedMessage: $('#dm-sess-pause-msg').value,
    });
    $('#dm-session-modal')?.classList.add('hidden');
  });
  $('#btn-dm-reset').addEventListener('click', () => sendAction('reset_campaign', {}));

  $('#dm-toast-form')?.addEventListener('submit', async (ev) => {
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

  $('#btn-dm-add-floor').addEventListener('click', () => {
    const theme = $('#dm-new-floor-theme')?.value || 'auto';
    sendAction('update_map', {
      subAction: 'add_floor',
      theme: theme === 'auto' ? '' : theme,
      startFogged: true,
    });
  });

  $('#btn-dm-apply-tower-preset')?.addEventListener('click', () => {
    const preset = $('#dm-tower-preset')?.value || 'classic';
    sendAction('update_map', {
      subAction: 'apply_tower_themes',
      preset,
      ensureFloors: preset === 'classic' ? 3 : undefined,
    });
  });

  $('#dm-floor-theme-rows')?.addEventListener('change', (ev) => {
    const sel = ev.target.closest('[data-floor-theme-pick]');
    if (!sel) return;
    sendAction('update_map', {
      subAction: 'set_floor_theme',
      floorNumber: Number(sel.dataset.floorThemePick),
      theme: sel.value,
    });
  });

  $('#dm-tower-floors-beats')?.addEventListener('click', (ev) => {
    const delBtn = ev.target.closest('[data-dm-delete-floor]');
    if (!delBtn) return;
    const floorNum = Number(delBtn.dataset.dmDeleteFloor);
    const floorTitle = delBtn.dataset.floorTitle || `${floorNum}F`;
    const ok = window.confirm(`Delete "${floorTitle}" (${floorNum}F) and all story beats/monsters on this floor? Players on this floor will be moved safely to another floor.`);
    if (!ok) return;
    sendAction('update_map', { subAction: 'delete_floor', floorNumber: floorNum });
  });
  $('#btn-dm-reveal-all').addEventListener('click', () => sendAction('update_map', { subAction: 'set_fog_bulk', mode: 'reveal_all' }));
  $('#btn-dm-cover-all')?.addEventListener('click', () => sendAction('update_map', { subAction: 'set_fog_bulk', mode: 'cover_all' }));

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
    const prevMilestones = state?.mechanics?.statMilestones || [];
    const statMilestones = $$('#mech-milestones-editor .mech-ms-row').map((row, idx) => {
      const prev = prevMilestones[idx] || {};
      return {
        ...prev,
        id: row.dataset.msId || prev.id || `ms-${idx}`,
        statKey: row.querySelector('.mech-ms-key').value.trim().toUpperCase(),
        threshold: Number(row.querySelector('.mech-ms-thresh').value || 20),
        abilityName: row.querySelector('.mech-ms-name').value.trim(),
        description: row.querySelector('.mech-ms-desc').value.trim(),
      };
    });
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
      statMilestones: statMilestones.length ? statMilestones : undefined,
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

  $('#dm-notes-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await sendAction('update_notes', {
      dmPrivate: $('#dm-private-notes').value,
      sharedQuests: $('#dm-shared-quests').value,
    });
    showToast({ title: 'NOTES SAVED', message: 'DM & Shared Quest notes saved.', category: 'info' });
  });

  async function rollDmDice(sides) {
    const res = await sendAction('roll_dice', {
      count: Number($('#dm-dice-count').value || 1),
      sides,
      modifier: Number($('#dm-dice-mod').value || 0),
      label: $('#dm-dice-label').value.trim() || `DM d${sides} Roll`,
      rollerName: 'Dungeon Master',
      isSecret: $('#dm-dice-secret').checked,
    });
    simulateDiceTray('dm-dice-sim-stage', sides, res.roll);
    showToast({
      title: res.roll.isSecret ? 'SECRET DM ROLL' : 'DM ROLL',
      message: `${res.roll.formula} = ${res.roll.total}`,
      category: 'warning',
    });
  }

  $$('#dm-dice-buttons [data-dm-sides]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sides = Number(btn.dataset.dmSides || 20);
      if ($('#dm-dice-sides')) $('#dm-dice-sides').value = sides;
      rollDmDice(sides);
    });
  });

  $('#dm-dice-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const sides = Math.max(1, Math.min(100, Number($('#dm-dice-sides').value || 20)));
    await rollDmDice(sides);
  });

  let activeDmCharModalId = null;

  function renderDmCharModal(charId) {
    const ch = state?.characters?.[charId];
    if (!ch) return;
    $('#dm-char-modal-name').textContent = ch.name;
    $('#dm-char-modal-sub').textContent = `Lv ${ch.level} ${ch.race || ''} ${ch.className || ''} • HP ${ch.hp}/${ch.maxHp} • MP ${ch.mp}/${ch.maxMp} • AC ${ch.ac} • DR ${ch.dr || 0}`;

    const statPills = Object.entries(ch.stats || {}).map(([k, v]) => {
      const mod = evalLocalFormula(state.mechanics?.statFormula || 'floor((SCORE - 10) / 2)', { ...ch.stats, SCORE: Number(v), LEVEL: ch.level });
      const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
      return `<span class="stat-pill">${esc(k)}: <b>${v}</b> (${modStr})</span>`;
    }).join('');

    const equipEntries = Object.entries(ch.equipment || {}).filter(([, item]) => Boolean(item));
    const equipHtml = equipEntries.length
      ? equipEntries.map(([slot, item]) => {
          const label = typeof item === 'string' ? item : (item.name || 'Equipped');
          return `<div class="item-card"><div class="item-card-top"><strong>${esc(slot)}</strong><span>${esc(label)}</span></div></div>`;
        }).join('')
      : '<div class="muted small">No equipment equipped.</div>';

    const invList = ch.inventory || [];
    const invHtml = invList.length
      ? invList.map((it) => `
          <div class="item-card">
            <div class="item-card-top">
              <strong>${esc(it.name)} <span class="tag tag-cyan">${esc(it.category || 'item')}</span></strong>
              <span>Qty ${it.qty || 1}${it.damageDice ? ` • ${esc(it.damageDice)}` : ''}</span>
            </div>
            ${it.notes ? `<div class="muted small">${esc(it.notes)}</div>` : ''}
          </div>
        `).join('')
      : '<div class="muted small">Empty inventory.</div>';

    const artHistory = (ch.artHistory || []).map((a) => `<img class="art-thumb" src="${esc(a.url)}" title="${esc(a.prompt || '')}" />`).join('');
    const histList = (ch.history || (state.playerHistory || []).filter((h) => h.characterId === ch.id));
    const histHtml = histList.length
      ? histList.map((h) => `<div class="feed-entry"><span class="tag tag-cyan">${esc((h.category || 'event').toUpperCase())}</span> ${esc(h.summary)} <span class="muted small">(${new Date(h.timestamp).toLocaleTimeString()})</span></div>`).join('')
      : '<div class="muted small">No activity recorded yet.</div>';

    $('#dm-char-modal-body').innerHTML = `
      <div class="two-col">
        <div class="col stack">
          <div class="panel" style="text-align:center;">
            <div class="panel-header"><h4>AI Character Art</h4></div>
            ${ch.portraitUrl ? `<img src="${esc(ch.portraitUrl)}" alt="${esc(ch.name)}" style="max-width:100%; max-height:260px; border-radius:10px; border:1px solid var(--border); object-fit:cover;" />` : '<div class="muted small">No portrait generated yet.</div>'}
            ${artHistory ? `<div class="art-history mt-xs">${artHistory}</div>` : ''}
          </div>
          <div class="panel">
            <div class="panel-header"><h4>Stats &amp; Currencies</h4></div>
            <div class="muted small">Gold: <b>${ch.currency?.gold || 0}G</b> • Mana Stones: <b>${ch.currency?.manaStones || 0}</b> • Favor: <b>${ch.favor || 0}</b></div>
            <div class="stat-pills mt-xs">${statPills}</div>
          </div>
        </div>
        <div class="col stack">
          <div class="panel">
            <div class="panel-header"><h4>Equipment</h4></div>
            <div class="list-stack">${equipHtml}</div>
          </div>
          <div class="panel">
            <div class="panel-header"><h4>Inventory (${invList.length})</h4></div>
            <div class="list-stack" style="max-height:220px; overflow-y:auto;">${invHtml}</div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h4>Character Log History</h4></div>
        <div class="feed-list" style="max-height:180px;">${histHtml}</div>
      </div>
    `;
  }

  $('#btn-close-char-modal')?.addEventListener('click', () => {
    $('#dm-char-modal')?.classList.add('hidden');
    activeDmCharModalId = null;
  });

  $('#dm-view').addEventListener('click', async (ev) => {
    const viewCharBtn = ev.target.closest('[data-view-char]');
    if (viewCharBtn) {
      activeDmCharModalId = viewCharBtn.dataset.viewChar;
      renderDmCharModal(activeDmCharModalId);
      $('#dm-char-modal')?.classList.remove('hidden');
      return;
    }
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
      renderBeatDraftDesigner();
      return renderStagedBeatAttachments();
    }

    const unNpc = ev.target.closest('[data-unstage-npc]');
    if (unNpc) {
      stagedBeatNpcs.splice(Number(unNpc.dataset.unstageNpc), 1);
      renderBeatDraftDesigner();
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

  function drawBeatArenaCanvas(canvas, beat, cellPx, selectedTokenId) {
    if (!canvas || !beat) return;
    const arena = beat.arena || { cols: 20, rows: 20, tokens: [] };
    const cols = arena.cols || 20;
    const rows = arena.rows || 20;
    const axisPad = 24;
    const w = axisPad + cols * cellPx;
    const h = axisPad + rows * cellPx;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    const biome = arena.biome || 'obsidian';
    drawArenaBackground(ctx, biome, axisPad, cols, rows, cellPx, w, h);

    for (const tile of arena.terrain || []) {
      const cx = axisPad + tile.x * cellPx + cellPx / 2;
      const cy = axisPad + tile.y * cellPx + cellPx / 2;
      drawTerrainTile(ctx, tile, cx, cy, cellPx, biome);
    }

    for (const chest of arena.chests || []) {
      const cx = axisPad + chest.x * cellPx + cellPx / 2;
      const cy = axisPad + chest.y * cellPx + cellPx / 2;
      drawChestIcon(ctx, chest, cx, cy, cellPx);
    }

    for (const tok of arena.tokens || []) {
      const cx = axisPad + tok.x * cellPx + cellPx / 2;
      const cy = axisPad + tok.y * cellPx + cellPx / 2;
      const r = Math.max(9, Math.floor(cellPx * 0.4));

      drawTokenAvatar(ctx, tok, cx, cy, r, selectedTokenId === tok.id);

      if (tok.maxHp > 0 && tok.hp !== null) {
        const bw = cellPx - 6;
        const pct = Math.max(0, Math.min(1, tok.hp / tok.maxHp));
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(cx - bw / 2, cy + r + 2, bw, 4);
        ctx.fillStyle = tok.type === 'monster' ? '#ef4444' : '#22c55e';
        ctx.fillRect(cx - bw / 2, cy + r + 2, bw * pct, 4);
      }
    }
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
    if (isDm && $('#arena-biome-select') && document.activeElement?.id !== 'arena-biome-select') {
      $('#arena-biome-select').value = arena.biome || 'obsidian';
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
    drawBeatArenaCanvas(canvas, beat, cellPx, arenaSelectedTokenId);
    const ctx = canvas.getContext('2d');
    const axisPad = 24;

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

  function getDetailCellPx(cols) {
    return cols >= 50 ? 22 : cols >= 40 ? 24 : cols >= 30 ? 28 : 34;
  }

  function renderBeatDetailModal() {
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatDetailId);
    if (!beat) return;
    const isDm = session?.role === 'dm';
    const arena = beat.arena || { cols: 20, rows: 20, tokens: [], chests: [] };
    const cols = arena.cols || 20;

    $('#beat-detail-title').textContent = beat.title;
    $('#beat-detail-floor').textContent = `${beat.floor}F`;
    $('#btn-beat-detail-edit')?.classList.toggle('hidden', !isDm);
    if (!isDm) $('#beat-detail-edit-panel')?.classList.add('hidden');
    const statusEl = $('#beat-detail-status');
    statusEl.textContent = beat.presented ? 'PRESENTED' : beat.status.toUpperCase();
    statusEl.className = `tag ${beat.presented ? 'tag-cyan' : 'tag-gold'}`;
    const xpEl = $('#beat-detail-xp');
    if (beat.xpReward) {
      xpEl.textContent = `+${beat.xpReward} XP`;
      xpEl.classList.remove('hidden');
    } else {
      xpEl.classList.add('hidden');
    }

    const narrEl = $('#beat-detail-narration');
    narrEl.textContent = beat.narration || '';
    narrEl.classList.toggle('hidden', !beat.narration);

    const secEl = $('#beat-detail-secret');
    if (isDm && beat.dmSecret) {
      secEl.innerHTML = `<strong>DM Secret:</strong> ${esc(beat.dmSecret)}`;
      secEl.classList.remove('hidden');
    } else {
      secEl.classList.add('hidden');
    }

    // Real-time Arena Map
    drawBeatArenaCanvas($('#beat-detail-canvas'), beat, getDetailCellPx(cols), arenaSelectedTokenId);

    // Stat-Based Initiative & Turn Order below the map
    const combat = state.combat || { round: 1, turnIndex: 0, combatants: [] };
    if ($('#beat-detail-round-pill')) $('#beat-detail-round-pill').textContent = `ROUND ${combat.round || 1}`;
    $('#btn-beat-init-prev')?.classList.toggle('hidden', !isDm);
    $('#btn-beat-init-next')?.classList.toggle('hidden', !isDm);
    $('#btn-beat-init-roll-all')?.classList.toggle('hidden', !isDm);
    $('#btn-beat-init-roll-self')?.classList.toggle('hidden', isDm || !session?.characterId);

    const initListEl = $('#beat-detail-initiative-list');
    if (initListEl) {
      const activeCombatant = combat.combatants?.[combat.turnIndex];
      const arenaIds = new Set((arena.tokens || []).map((t) => t.id));
      const relevant = (combat.combatants || []).filter((c) => c.type === 'player' || arenaIds.has(c.id));
      initListEl.innerHTML = relevant.map((c) => {
        const isCurrent = activeCombatant && activeCombatant.id === c.id;
        let mod = 0;
        let statLabel = 'Stat';
        if (c.type === 'player' && state.characters?.[c.id]) {
          const ch = state.characters[c.id];
          const agiScore = ch.stats?.AGI ?? ch.stats?.DEX ?? 10;
          mod = Math.floor((Number(agiScore) - 10) / 2);
          statLabel = `AGI ${agiScore}`;
        } else if (c.type === 'monster') {
          const mon = (state.monsters || []).find((m) => m.id === c.id);
          const acVal = mon ? (mon.agi ?? mon.ac ?? 12) : 12;
          mod = Math.floor((Number(acVal) - 10) / 2);
          statLabel = mon ? `AC ${mon.ac}` : 'Monster';
        }
        const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
        return `
          <div class="item-card ${isCurrent ? 'card-glow-cyan' : ''}">
            <div class="item-card-top">
              <strong>${esc(c.name)} <span class="tag ${c.type === 'monster' ? 'tag-crimson' : 'tag-cyan'}">${c.type === 'monster' ? 'MONSTER' : 'PLAYER'}</span> ${isCurrent ? '<span class="tag tag-gold">ACTIVE TURN</span>' : ''}</strong>
              <span>Init: <b>${c.initiative ?? '—'}</b> <span class="muted small">(${statLabel} • ${modStr})</span></span>
            </div>
          </div>
        `;
      }).join('') || '<div class="muted small">No combatants in initiative order yet.</div>';
    }

    // Players & Live Stats
    const chars = Object.values(state.characters || {});
    const tokenIds = new Set((arena.tokens || []).map((t) => t.id));
    $('#beat-detail-players').innerHTML = chars.map((ch) => {
      const hpPct = ch.maxHp ? Math.max(0, Math.min(100, (ch.hp / ch.maxHp) * 100)) : 0;
      const inArena = tokenIds.has(ch.id);
      const statEntries = Object.entries(ch.stats || {})
        .map(([k, v]) => `<span class="stat-pill">${esc(k)}: <b>${v}</b></span>`)
        .join('');
      return `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(ch.name)} <span class="tag tag-cyan">Lv ${ch.level} ${esc(ch.className || '')}</span> ${inArena ? '' : '<span class="muted small">(Off-map)</span>'}</strong>
            <span>HP <b>${ch.hp}/${ch.maxHp}</b> • MP <b>${ch.mp}/${ch.maxMp}</b> • AC ${ch.ac} • DR ${ch.dr || 0}</span>
          </div>
          <div class="progress"><div class="progress-fill hp" style="width:${hpPct}%"></div></div>
          <div class="stat-pills">${statEntries}</div>
        </div>
      `;
    }).join('') || '<div class="muted small">No players in session.</div>';

    // Spawned Monsters + Unspawned Encounters
    const spawnBtn = $('#btn-beat-detail-spawn');
    spawnBtn.classList.toggle('hidden', !(isDm && (beat.encounters || []).length > 0));
    const arenaMons = (arena.tokens || []).filter((t) => t.type === 'monster');
    const monCards = arenaMons.map((tok) => {
      const liveMon = (state.monsters || []).find((m) => m.id === tok.id);
      const hp = liveMon ? liveMon.hp : tok.hp;
      const maxHp = liveMon ? liveMon.maxHp : tok.maxHp;
      const pct = maxHp ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
      const lootInfo = liveMon?.loot && (liveMon.loot.itemName || liveMon.loot.gold || liveMon.loot.manaStones)
        ? `<div class="muted small">Loot: ${[liveMon.loot.itemName, liveMon.loot.gold ? `${liveMon.loot.gold}G` : '', liveMon.loot.manaStones ? `${liveMon.loot.manaStones} Stones` : ''].filter(Boolean).join(', ')}${liveMon.loot.dropped ? ' (Dropped!)' : ''}</div>`
        : '';
      return `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(tok.name)} ${hp <= 0 ? '<span class="tag tag-gold">DEFEATED</span>' : ''}</strong>
            <span>${hp !== null && maxHp ? `HP <b>${hp}/${maxHp}</b>` : ''}${liveMon ? ` • AC ${liveMon.ac} • DR ${liveMon.dr}` : ''}</span>
          </div>
          ${maxHp ? `<div class="progress"><div class="progress-fill monster" style="width:${pct}%"></div></div>` : ''}
          ${lootInfo}
          ${isDm && liveMon ? `<div class="btn-row mt-xs"><button type="button" class="btn btn-xs btn-outline" data-mon-hp="${esc(liveMon.id)}" data-delta="-5">-5 HP</button><button type="button" class="btn btn-xs btn-outline" data-mon-hp="${esc(liveMon.id)}" data-delta="5">+5 HP</button></div>` : ''}
        </div>
      `;
    });
    if (arenaMons.length === 0 && (beat.encounters || []).length > 0) {
      monCards.push(...beat.encounters.map((e) => `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(e.name)} <span class="tag tag-crimson">READY TO SPAWN</span></strong>
            <span>HP ${e.maxHp} • AC ${e.ac} • DR ${e.dr} • ${esc(e.damageFormula || '')}</span>
          </div>
        </div>
      `));
    }
    $('#beat-detail-monsters').innerHTML = monCards.join('') || '<div class="muted small">No monsters in this story beat.</div>';

    // Treasure & Arena Chests
    const trCards = (beat.treasures || []).map((t) => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${esc(t.name)} <span class="tag tag-gold">${esc(t.category || 'treasure')}</span></strong>
          <span>${[t.gold ? `${t.gold}G` : '', t.manaStones ? `${t.manaStones} Stones` : '', t.damageDice || ''].filter(Boolean).join(' • ') || 'Story Reward'}</span>
        </div>
      </div>
    `);
    const chestCards = (arena.chests || []).map((c) => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${esc(c.name)} <span class="tag ${c.opened ? 'tag-cyan' : 'tag-gold'}">${c.opened ? 'OPENED' : 'CHEST'}</span></strong>
          <span>${[c.gold ? `${c.gold}G` : '', c.manaStones ? `${c.manaStones} Stones` : '', c.itemName || ''].filter(Boolean).join(', ') || 'Empty'}</span>
        </div>
      </div>
    `);
    $('#beat-detail-treasure').innerHTML = [...trCards, ...chestCards].join('') || '<div class="muted small">No treasure or chests attached.</div>';

    // NPCs
    const npcTokens = (arena.tokens || []).filter((t) => t.type === 'npc');
    $('#beat-detail-npcs').innerHTML = npcTokens.map((n) => `
      <div class="item-card">
        <div class="item-card-top">
          <strong>${esc(n.name)} <span class="tag tag-green">${esc(n.npcRole || 'NPC')}</span></strong>
          <span>${n.rewardType && n.rewardType !== 'none' ? (n.rewardClaimed ? 'Reward Claimed' : esc(n.rewardType === 'xp' ? `+${n.rewardXp} XP` : n.rewardItemName || n.rewardType)) : 'Dialogue'}</span>
        </div>
        ${n.dialogue ? `<div class="muted small">"${esc(n.dialogue)}"</div>` : ''}
      </div>
    `).join('') || '<div class="muted small">No NPCs placed in this scene.</div>';

    if (!$('#beat-detail-edit-panel')?.classList.contains('hidden')) {
      renderBeatEditLists(beat);
    }

    const toastPanel = $('#beat-detail-toast-panel');
    if (toastPanel) {
      toastPanel.classList.toggle('hidden', !isDm);
      if (isDm && $('#beat-toast-target')) {
        const prev = $('#beat-toast-target').value || 'all';
        $('#beat-toast-target').innerHTML = '<option value="all">All Players</option>' +
          chars.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
        $('#beat-toast-target').value = prev;
      }
    }
  }

  function renderBeatEditLists(beat) {
    const monEl = $('#edit-beat-encounters-list');
    if (monEl) {
      monEl.innerHTML = editBeatEncounters.map((m, i) => `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(m.name)}</strong>
            <span>HP ${m.maxHp} • AC ${m.ac} • DR ${m.dr}</span>
            <button type="button" class="btn btn-xs btn-danger-outline" data-edit-remove-mon="${i}">Remove</button>
          </div>
        </div>
      `).join('');
    }
    const trEl = $('#edit-beat-treasures-list');
    if (trEl) {
      trEl.innerHTML = editBeatTreasures.map((t, i) => `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(t.name)} <span class="tag tag-cyan">${esc(t.category || 'relic')}</span></strong>
            <span>${t.gold ? `${t.gold}G ` : ''}${t.manaStones ? `${t.manaStones} Stones` : ''}</span>
            <button type="button" class="btn btn-xs btn-danger-outline" data-edit-remove-tr="${i}">Remove</button>
          </div>
        </div>
      `).join('');
    }
    const npcEl = $('#edit-beat-npcs-list');
    if (npcEl && beat) {
      const npcs = (beat.arena?.tokens || []).filter((t) => t.type === 'npc');
      npcEl.innerHTML = npcs.map((n) => `
        <div class="item-card">
          <div class="item-card-top">
            <strong>${esc(n.name)} <span class="tag tag-green">${esc(n.npcRole || 'NPC')}</span></strong>
            <button type="button" class="btn btn-xs btn-danger-outline" data-edit-remove-npc="${esc(n.id)}">Remove</button>
          </div>
        </div>
      `).join('');
    }
  }

  function populateBeatEditForm(beat) {
    if (!beat) return;
    $('#edit-beat-title').value = beat.title || '';
    $('#edit-beat-floor').value = beat.floor || 1;
    $('#edit-beat-xp').value = beat.xpReward || 0;
    $('#edit-beat-grid-size').value = String(beat.arena?.cols || 20);
    $('#edit-beat-status').value = beat.status || 'upcoming';
    $('#edit-beat-narration').value = beat.narration || '';
    $('#edit-beat-secret').value = beat.dmSecret || '';
    $('#edit-beat-present-now').checked = Boolean(beat.presented);
    editBeatEncounters = JSON.parse(JSON.stringify(beat.encounters || []));
    editBeatTreasures = JSON.parse(JSON.stringify(beat.treasures || []));
    renderBeatEditLists(beat);
  }

  document.addEventListener('click', (ev) => {
    const openBeatBtn = ev.target.closest('[data-beat-open]');
    if (openBeatBtn) {
      lastVisitedViewId = $('#dm-view').classList.contains('active')
        ? 'dm-view'
        : ($('#player-view').classList.contains('active') ? 'player-view' : (session?.role === 'dm' ? 'dm-view' : 'player-view'));
      lastScrollY = window.scrollY || 0;
      activeBeatDetailId = openBeatBtn.dataset.beatOpen;
      arenaSelectedTokenId = session?.role === 'player' ? session.characterId : null;
      $('#player-view').classList.remove('active');
      $('#dm-view').classList.remove('active');
      $('#beat-detail-view').classList.add('active');
      window.scrollTo(0, 0);
      renderBeatDetailModal();
      return;
    }
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

  $('#btn-close-beat-detail')?.addEventListener('click', () => {
    $('#beat-detail-view').classList.remove('active');
    $('#beat-detail-edit-panel')?.classList.add('hidden');
    activeBeatDetailId = null;
    const returnId = lastVisitedViewId || (session?.role === 'dm' ? 'dm-view' : 'player-view');
    document.getElementById(returnId)?.classList.add('active');
    window.scrollTo(0, lastScrollY || 0);
  });

  $('#btn-beat-detail-edit')?.addEventListener('click', () => {
    const panel = $('#beat-detail-edit-panel');
    if (!panel || !activeBeatDetailId) return;
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    if (opening) {
      const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatDetailId);
      populateBeatEditForm(beat);
    }
  });

  $('#btn-cancel-beat-edit')?.addEventListener('click', () => {
    $('#beat-detail-edit-panel')?.classList.add('hidden');
  });

  $('#btn-edit-add-mon')?.addEventListener('click', () => {
    const name = $('#edit-beat-mon-name').value.trim();
    if (!name) return showToast({ title: 'MONSTER NAME NEEDED', message: 'Enter a monster name.', category: 'warning' });
    editBeatEncounters.push({
      name,
      maxHp: Number($('#edit-beat-mon-hp').value || 35),
      ac: Number($('#edit-beat-mon-ac').value || 14),
      dr: Number($('#edit-beat-mon-dr').value || 1),
      damageFormula: $('#edit-beat-mon-dmg').value.trim() || '2d6+3',
      hiddenFromPlayers: false,
      loot: {
        itemName: $('#edit-beat-mon-loot-item')?.value.trim() || '',
        gold: Number($('#edit-beat-mon-loot-gold')?.value || 0),
        manaStones: Number($('#edit-beat-mon-loot-stones')?.value || 0),
      },
    });
    $('#edit-beat-mon-name').value = '';
    if ($('#edit-beat-mon-loot-item')) $('#edit-beat-mon-loot-item').value = '';
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatDetailId);
    renderBeatEditLists(beat);
  });

  $('#btn-edit-add-tr')?.addEventListener('click', () => {
    const name = $('#edit-beat-tr-name').value.trim();
    const gold = Number($('#edit-beat-tr-gold').value || 0);
    const manaStones = Number($('#edit-beat-tr-stones').value || 0);
    if (!name && gold <= 0 && manaStones <= 0) {
      return showToast({ title: 'TREASURE NEEDED', message: 'Enter an item name, Gold, or Mana Stones.', category: 'warning' });
    }
    editBeatTreasures.push({
      name: name || 'Tower Gold Cache',
      category: $('#edit-beat-tr-cat').value,
      qty: 1,
      gold,
      manaStones,
      damageDice: $('#edit-beat-tr-dmg').value.trim(),
    });
    $('#edit-beat-tr-name').value = '';
    $('#edit-beat-tr-dmg').value = '';
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatDetailId);
    renderBeatEditLists(beat);
  });

  $('#btn-edit-add-npc')?.addEventListener('click', async () => {
    if (!activeBeatDetailId) return;
    const name = $('#edit-beat-npc-name').value.trim();
    if (!name) return showToast({ title: 'NPC NAME NEEDED', message: 'Enter an NPC name.', category: 'warning' });
    await sendAction('story_action', {
      subAction: 'add_beat_npc',
      beatId: activeBeatDetailId,
      name,
      npcRole: $('#edit-beat-npc-role').value.trim() || 'NPC',
      x: Math.max(0, Number($('#edit-beat-npc-x').value || 5) - 1),
      y: Math.max(0, Number($('#edit-beat-npc-y').value || 5) - 1),
      dialogue: $('#edit-beat-npc-dialogue').value.trim(),
      rewardType: $('#edit-beat-npc-reward-type').value || 'none',
      rewardItemName: $('#edit-beat-npc-reward-name').value.trim(),
      rewardXp: Number($('#edit-beat-npc-reward-xp').value || 0),
    });
    $('#edit-beat-npc-name').value = '';
    $('#edit-beat-npc-role').value = '';
    $('#edit-beat-npc-dialogue').value = '';
    $('#edit-beat-npc-reward-name').value = '';
  });

  $('#beat-edit-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!activeBeatDetailId) return;
    await sendAction('story_action', {
      subAction: 'update_beat',
      beatId: activeBeatDetailId,
      title: $('#edit-beat-title').value.trim(),
      floor: Number($('#edit-beat-floor').value || 1),
      xpReward: Number($('#edit-beat-xp').value || 0),
      gridSize: Number($('#edit-beat-grid-size').value || 20),
      status: $('#edit-beat-status').value,
      narration: $('#edit-beat-narration').value.trim(),
      dmSecret: $('#edit-beat-secret').value.trim(),
      presented: $('#edit-beat-present-now').checked,
      encounters: editBeatEncounters,
      treasures: editBeatTreasures,
    });
    $('#beat-detail-edit-panel')?.classList.add('hidden');
    showToast({ title: 'STORY BEAT UPDATED', message: 'Story beat changes saved!', category: 'info' });
  });

  $('#btn-beat-detail-open-map')?.addEventListener('click', () => {
    if (!activeBeatDetailId) return;
    activeBeatMapId = activeBeatDetailId;
    $('#beat-map-modal').classList.remove('hidden');
    renderBeatMapModal();
  });

  $('#btn-beat-detail-spawn')?.addEventListener('click', async () => {
    if (!activeBeatDetailId) return;
    await sendAction('story_action', { subAction: 'spawn_beat_monsters', beatId: activeBeatDetailId });
  });

  $('#btn-beat-init-prev')?.addEventListener('click', () => sendAction('combat_action', { subAction: 'prev_turn' }));
  $('#btn-beat-init-next')?.addEventListener('click', () => sendAction('combat_action', { subAction: 'next_turn' }));
  $('#btn-beat-init-roll-all')?.addEventListener('click', () => sendAction('combat_action', { subAction: 'roll_all' }));
  $('#btn-beat-init-roll-self')?.addEventListener('click', async () => {
    if (!session?.characterId) return;
    await sendAction('combat_action', { subAction: 'player_roll_initiative', characterId: session.characterId });
  });

  $('#beat-toast-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const message = $('#beat-toast-msg').value.trim();
    if (!message) return;
    await sendAction('broadcast_toast', {
      title: 'SYSTEM NOTICE',
      category: $('#beat-toast-cat').value || 'info',
      target: $('#beat-toast-target').value || 'all',
      message,
    });
    $('#beat-toast-msg').value = '';
  });

  $('#beat-detail-view')?.addEventListener('click', async (ev) => {
    const monHp = ev.target.closest('[data-mon-hp]');
    if (monHp) {
      await sendAction('update_monster', { monsterId: monHp.dataset.monHp, hpDelta: Number(monHp.dataset.delta) });
      return;
    }
    const rmMon = ev.target.closest('[data-edit-remove-mon]');
    if (rmMon) {
      editBeatEncounters.splice(Number(rmMon.dataset.editRemoveMon), 1);
      const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatDetailId);
      renderBeatEditLists(beat);
      return;
    }
    const rmTr = ev.target.closest('[data-edit-remove-tr]');
    if (rmTr) {
      editBeatTreasures.splice(Number(rmTr.dataset.editRemoveTr), 1);
      const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatDetailId);
      renderBeatEditLists(beat);
      return;
    }
    const rmNpc = ev.target.closest('[data-edit-remove-npc]');
    if (rmNpc && activeBeatDetailId) {
      await sendAction('story_action', { subAction: 'remove_beat_npc', beatId: activeBeatDetailId, tokenId: rmNpc.dataset.editRemoveNpc });
    }
  });

  $('#beat-detail-canvas')?.addEventListener('click', async (ev) => {
    if (!activeBeatDetailId) return;
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatDetailId);
    if (!beat?.arena) return;
    const arena = beat.arena;
    const cols = arena.cols || 20;
    const rows = arena.rows || 20;
    const cellPx = getDetailCellPx(cols);
    const { x, y } = getScaledCanvasCell(ev.currentTarget, ev.clientX, ev.clientY, 24, cellPx);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;

    const clickedChest = (arena.chests || []).find((c) => c.x === x && c.y === y && !c.opened);
    if (clickedChest && !((arena.tokens || []).some((t) => t.x === x && t.y === y))) {
      await sendAction('story_action', {
        subAction: 'open_beat_chest',
        beatId: activeBeatDetailId,
        chestId: clickedChest.id,
        characterId: session?.characterId || null,
      });
      return;
    }

    const npcHit = (arena.tokens || []).find((t) => t.x === x && t.y === y && t.type === 'npc');
    if (npcHit && session?.role !== 'dm') {
      await sendAction('story_action', {
        subAction: 'talk_beat_npc',
        beatId: activeBeatDetailId,
        tokenId: npcHit.id,
        characterId: session?.characterId || null,
      });
      return;
    }

    if (session?.role === 'dm') {
      const hit = (arena.tokens || []).find((t) => t.x === x && t.y === y);
      if (hit) {
        arenaSelectedTokenId = hit.id;
        $('#beat-detail-map-hint').textContent = `Selected ${hit.name}. Tap a destination space.`;
        renderBeatDetailModal();
      } else if (arenaSelectedTokenId) {
        await sendAction('story_action', { subAction: 'move_beat_token', beatId: activeBeatDetailId, tokenId: arenaSelectedTokenId, x, y });
      }
    } else if (session?.characterId) {
      await sendAction('story_action', { subAction: 'move_beat_token', beatId: activeBeatDetailId, tokenId: session.characterId, x, y });
    }
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
    if (ev.target.id === 'btn-arena-gen-terrain' && activeBeatMapId) {
      const prompt = $('#arena-gen-prompt')?.value.trim() || '';
      const biome = $('#arena-biome-select')?.value || 'obsidian';
      await sendAction('story_action', { subAction: 'generate_beat_terrain', beatId: activeBeatMapId, prompt, biome });
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

  $('#arena-biome-select').addEventListener('change', async (ev) => {
    if (!activeBeatMapId) return;
    await sendAction('story_action', { subAction: 'set_beat_biome', beatId: activeBeatMapId, biome: ev.target.value });
  });

  $('#beat-map-canvas').addEventListener('click', async (ev) => {
    const beat = (state?.storyBeats || []).find((b) => b.id === activeBeatMapId);
    if (!beat) return;
    const arena = beat.arena || { cols: 20, rows: 20, tokens: [] };
    const cols = arena.cols || 20;
    const rows = arena.rows || 20;
    const cellPx = getCellPxForGrid(cols);
    const { x, y } = getScaledCanvasCell(ev.currentTarget, ev.clientX, ev.clientY, 24, cellPx);
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

    if (arenaTool === 'chest' && session?.role === 'dm') {
      const existingChest = (arena.chests || []).find((c) => c.x === x && c.y === y);
      if (existingChest) {
        await sendAction('story_action', { subAction: 'remove_beat_chest', beatId: activeBeatMapId, chestId: existingChest.id });
      } else {
        await sendAction('story_action', {
          subAction: 'add_beat_chest',
          beatId: activeBeatMapId,
          name: $('#arena-chest-name').value.trim() || 'Treasure Chest',
          gold: Number($('#arena-chest-gold').value || 0),
          itemName: $('#arena-chest-item').value.trim(),
          x,
          y,
        });
      }
      return;
    }

    if (session?.role === 'dm' && arenaTool === 'npc') {
      const rType = $('#arena-npc-reward-type')?.value || 'none';
      const rVal = $('#arena-npc-reward-value')?.value.trim() || '';
      await sendAction('story_action', {
        subAction: 'add_beat_npc',
        beatId: activeBeatMapId,
        name: $('#arena-npc-name')?.value.trim() || 'Tower Guide',
        npcRole: $('#arena-npc-role')?.value.trim() || 'NPC',
        dialogue: $('#arena-npc-dialogue')?.value.trim() || '',
        rewardType: rType,
        rewardItemName: (rType === 'item' || rType === 'skill_book') ? rVal : '',
        rewardXp: rType === 'xp' ? Number(rVal || 50) : 0,
        x,
        y,
      });
      return;
    }

    if (session?.role === 'dm' && arenaTool === 'talk') {
      const npcHit = (arena.tokens || []).find((t) => t.x === x && t.y === y && t.type === 'npc');
      if (npcHit) {
        await sendAction('story_action', { subAction: 'talk_beat_npc', beatId: activeBeatMapId, tokenId: npcHit.id });
      }
      return;
    }

    if (session?.role === 'dm' && (arenaTool === 'tree' || arenaTool === 'rock' || arenaTool === 'water')) {
      await sendAction('story_action', {
        subAction: 'toggle_beat_terrain',
        beatId: activeBeatMapId,
        x,
        y,
        terrainType: arenaTool,
      });
      return;
    }

    const clickedChest = (arena.chests || []).find((c) => c.x === x && c.y === y && !c.opened);
    if (clickedChest && !((arena.tokens || []).some((t) => t.x === x && t.y === y))) {
      await sendAction('story_action', {
        subAction: 'open_beat_chest',
        beatId: activeBeatMapId,
        chestId: clickedChest.id,
        characterId: session?.characterId || null,
      });
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
      const npcHit = (arena.tokens || []).find((t) => t.x === x && t.y === y && t.type === 'npc');
      if (npcHit) {
        await sendAction('story_action', { subAction: 'talk_beat_npc', beatId: activeBeatMapId, tokenId: npcHit.id, characterId: session.characterId });
        return;
      }
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
    const roleTag = tok.type === 'npc'
      ? ` (${tok.npcRole || 'NPC'})${tok.rewardClaimed ? ' — Talked' : ' — Tap to Talk'}`
      : '';
    const hpText = tok.hp !== null && tok.maxHp ? ` • ${tok.hp}/${tok.maxHp} HP` : '';
    tokenTooltip.textContent = `${displayName}${roleTag}${hpText}`;
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
    const targetBeatId = canvas?.id === 'beat-detail-canvas' ? activeBeatDetailId : activeBeatMapId;
    const beat = (state?.storyBeats || []).find((b) => b.id === targetBeatId);
    if (!beat?.arena) return null;
    const cols = beat.arena.cols || 20;
    const cellPx = canvas?.id === 'beat-detail-canvas' ? getDetailCellPx(cols) : getCellPxForGrid(cols);
    const { x, y } = getScaledCanvasCell(canvas, clientX, clientY, 24, cellPx);
    const tok = (beat.arena.tokens || []).find((t) => t.x === x && t.y === y);
    if (tok) return tok;
    const chest = (beat.arena.chests || []).find((c) => c.x === x && c.y === y);
    if (chest) {
      return {
        id: chest.id,
        type: 'chest',
        name: chest.opened ? `${chest.name} (Opened)` : `${chest.name}${session?.role === 'dm' && chest.gold ? ` (${chest.gold}G)` : ' — Tap to Open'}`,
        hp: null,
      };
    }
    const tile = (beat.arena.terrain || []).find((t) => t.x === x && t.y === y);
    if (tile) {
      const labels = { tree: 'Tree (Impassable)', rock: 'Boulder / Rock (Impassable)', water: 'Deep Water (Impassable)' };
      return { id: `terrain-${x}-${y}`, type: 'terrain', name: labels[tile.type] || 'Impassable Terrain', hp: null };
    }
    return null;
  }

  attachTokenTooltip('player-tower-canvas', findTowerTokenAt);
  attachTokenTooltip('dm-tower-canvas', findTowerTokenAt);
  attachTokenTooltip('beat-map-canvas', findBeatTokenAt);
  attachTokenTooltip('beat-detail-canvas', findBeatTokenAt);

  // Restore saved session if present
  try {
    const saved = localStorage.getItem('tower_vtt_session');
    if (saved) enterSession(JSON.parse(saved));
  } catch {}
})();
