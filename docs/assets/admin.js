/* The admin page: nominees, settings & sharing, live results, danger zone. */
(function () {
  'use strict';
  const { $, $$, esc, store, uid, avatar, formatDateTime, timeAgo, toast, confirmDialog, copyText, downloadFile, csvCell, ICONS } = U;

  const root = $('#root');
  const session = {
    get(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    remove(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const PASS_KEY = 'ccv:admin-pass';
  const TAB_KEY = 'ccv:admin-tab';
  const MSG_KEY = 'ccv:share-message';

  const TABS = [
    { id: 'nominees', label: 'Nominees' },
    { id: 'settings', label: 'Settings & sharing' },
    { id: 'results', label: 'Live results' },
    { id: 'danger', label: 'Danger zone' },
  ];

  const S = {
    pass: session.get(PASS_KEY),
    server: null,
    positions: [],
    nominees: [],
    dirty: false,
    tab: session.get(TAB_KEY) || 'nominees',
    results: null,
    resultsTimer: null,
    tickTimer: null,
    codes: null,
  };

  const SVG = {
    up: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    trash: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    edit: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
    grip: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    external: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    close: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  // ───────────── Server calls ─────────────

  async function adminCall(action, payload) {
    try {
      return await Api.call('admin.' + action, Object.assign({ passcode: S.pass }, payload || {}));
    } catch (e) {
      if (e.code === 'BAD_PASSCODE' || e.code === 'LOCKED_OUT') {
        logout(e.message);
      }
      throw e;
    }
  }

  function applyState(st, opts) {
    S.server = st;
    if (!S.dirty || (opts && opts.replaceEdits)) {
      S.positions = st.positions.map((p) => ({ id: p.id, name: p.name, maxSelections: p.maxSelections }));
      S.nominees = [];
      st.positions.forEach((p) => p.nominees.forEach((n) => S.nominees.push({
        id: n.id, positionId: p.id, displayName: n.displayName, bio: n.bio || '', photoUrl: n.photoUrl || '', active: n.active !== false,
      })));
      S.dirty = false;
    }
    updateSavebar();
    renderHeader();
  }

  async function refreshState() {
    applyState(await adminCall('state'));
  }

  // ───────────── Login ─────────────

  const mockBanner = () => (Api.isMock
    ? '<div class="mock-banner">Demo mode — data is stored only in this browser. The passcode is <b>admin</b>.</div>'
    : '');

  function renderLogin(message) {
    stopTimers();
    root.innerHTML = `
      ${mockBanner()}
      <div class="login">
        <div class="card">
          <div class="hero-mark" style="margin:6px auto 16px">${ICONS.ballot}</div>
          <h1 class="center" style="font-size:1.6rem">Election admin</h1>
          <p class="muted center">Enter the admin passcode you set in Apps Script.</p>
          <form id="login" novalidate>
            <div class="field">
              <label for="pass">Passcode</label>
              <input id="pass" type="password" autocomplete="current-password" required>
            </div>
            <p class="field-error" id="login-err" role="alert">${esc(message || '')}</p>
            <button class="btn btn-primary btn-lg btn-block" id="login-btn">Sign in</button>
          </form>
        </div>
      </div>`;
    const input = $('#pass');
    input.focus();
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pass = input.value.trim();
      if (!pass) { $('#login-err').textContent = 'Please enter the passcode.'; return; }
      const btn = $('#login-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Signing in…';
      S.pass = pass;
      try {
        const st = await Api.call('admin.state', { passcode: pass });
        session.set(PASS_KEY, pass);
        applyState(st, { replaceEdits: true });
        renderShell();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Sign in';
        $('#login-err').textContent = err.code === 'NOT_CONFIGURED' && !String(err.message).includes('passcode')
          ? 'This page is not connected to the spreadsheet yet. Paste your Apps Script URL into config.js (see SETUP.md).'
          : err.message;
      }
    });
  }

  function logout(message) {
    session.remove(PASS_KEY);
    S.pass = '';
    S.dirty = false;
    renderLogin(message);
  }

  // ───────────── Shell ─────────────

  function voterLink() {
    const u = new URL('./', location.href);
    if (Api.isMock && new URLSearchParams(location.search).has('mock')) u.search = '?mock';
    return u.href;
  }

  function renderShell() {
    root.innerHTML = `
      ${mockBanner()}
      <div class="admin">
        <header class="admin-header">
          <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" style="width:40px;height:40px"><rect width="32" height="32" rx="9" fill="#2f6b4f"/><path d="M9 17h14v6.5a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1z" fill="#fff"/><path d="M12 17V9a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v8" fill="none" stroke="#fff" stroke-width="2"/><path d="m13.6 12.4 1.7 1.7 3.2-3.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div class="grow">
            <h1 id="hdr-title"></h1>
            <div class="row" id="hdr-status" style="gap:8px;margin-top:4px"></div>
          </div>
          <a class="btn btn-sm" href="${esc(voterLink())}" target="_blank" rel="noopener">Open voting page ${SVG.external}</a>
        </header>
        <nav class="tabs" role="tablist" aria-label="Admin sections">
          ${TABS.map((t) => `<button class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="panel">${t.label}</button>`).join('')}
        </nav>
        <main id="panel" role="tabpanel" tabindex="-1"></main>
      </div>
      <div class="savebar" id="savebar" aria-hidden="true">
        <div class="savebar-inner">
          <span class="grow"><b>Unsaved changes</b> to the ballot</span>
          <button class="btn btn-ghost" id="discard">Discard</button>
          <button class="btn btn-primary" id="save">Save changes</button>
        </div>
      </div>`;
    $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('#save').addEventListener('click', () => saveBallot());
    $('#discard').addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Discard your changes?', body: 'Your unsaved edits to positions and nominees will be lost.', confirmText: 'Discard', danger: true }))) return;
      S.dirty = false;
      applyState(S.server, { replaceEdits: true });
      renderTab();
    });
    renderHeader();
    updateSavebar();
    switchTab(TABS.some((t) => t.id === S.tab) ? S.tab : 'nominees');
  }

  function statusPill(status) {
    const label = { draft: 'Draft — not open yet', open: 'Voting is open', closed: 'Voting closed' }[status] || status;
    return `<span class="pill pill-${esc(status)}"><span class="dot"></span>${label}</span>`;
  }

  function renderHeader() {
    const t = $('#hdr-title');
    if (!t || !S.server) return;
    const s = S.server.settings;
    t.textContent = s.electionTitle;
    document.title = 'Admin · ' + s.electionTitle;
    const voters = S.server.stats.voters;
    $('#hdr-status').innerHTML = `${statusPill(s.status)}<span class="muted" style="font-weight:700">${voters} voted</span>`;
  }

  function switchTab(id) {
    S.tab = id;
    session.set(TAB_KEY, id);
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    renderTab();
  }

  function renderTab() {
    stopTimers();
    const panel = $('#panel');
    if (!panel) return;
    panel.setAttribute('aria-labelledby', 'tab-' + S.tab);
    ({ nominees: renderNominees, settings: renderSettings, results: renderResults, danger: renderDanger })[S.tab]();
  }

  function stopTimers() {
    clearInterval(S.resultsTimer);
    clearInterval(S.tickTimer);
  }

  function markDirty() {
    S.dirty = true;
    updateSavebar();
  }

  function updateSavebar() {
    const bar = $('#savebar');
    if (!bar) return;
    bar.classList.toggle('show', S.dirty);
    bar.setAttribute('aria-hidden', String(!S.dirty));
  }

  window.addEventListener('beforeunload', (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(label || 'Saving…')}`;
    } else if (btn.dataset.label !== undefined) {
      btn.innerHTML = btn.dataset.label;
      btn.disabled = false;
    }
  }

  // ───────────── Nominees tab ─────────────

  const keyOf = (name) => Dedupe.tokens(name).join(' ');

  function renderNominees() {
    const panel = $('#panel');
    const voters = S.server.stats.voters;
    const onBallot = S.nominees.filter((n) => n.active).length;
    panel.innerHTML = `
      <div class="section-title"><h2>Ballot</h2><span class="muted">${S.positions.length} position${S.positions.length === 1 ? '' : 's'} · ${onBallot} nominee${onBallot === 1 ? '' : 's'} on the ballot</span></div>
      ${voters ? `<div class="notice notice-warning" style="margin-bottom:16px">${ICONS.alert}<span><b>${voters} ${voters === 1 ? 'person has' : 'people have'} already voted.</b> Changing the ballot now can affect the results. Votes already cast stay counted, even for someone you remove.</span></div>` : ''}
      <div class="toolbar">
        <button class="btn btn-primary" id="import">Import from nominations</button>
        <button class="btn" id="preview">Preview ballot</button>
        <button class="btn" id="add-pos">+ Add position</button>
      </div>
      ${S.positions.length ? S.positions.map(posCard).join('') : `
        <div class="card empty">
          <div class="state-icon primary" style="margin:0 auto 14px">${ICONS.ballot}</div>
          <h3>No positions yet</h3>
          <p class="muted">Start by importing the names from your nomination form. You can tidy them up before anything goes on the ballot.</p>
          <button class="btn btn-primary" id="import-empty">Import from nominations</button>
        </div>`}`;

    $('#import').addEventListener('click', openWizard);
    const ie = $('#import-empty');
    if (ie) ie.addEventListener('click', openWizard);
    $('#preview').addEventListener('click', openPreview);
    $('#add-pos').addEventListener('click', () => {
      const p = { id: uid('p'), name: 'New position', maxSelections: 1 };
      S.positions.push(p);
      markDirty();
      renderNominees();
      const input = $(`.pos-card[data-pid="${p.id}"] .pos-name`);
      input.focus();
      input.select();
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    // The panel element survives re-renders, so its delegated listeners are attached once.
    if (!panel.dataset.nomineeEvents) {
      panel.dataset.nomineeEvents = '1';
      bindNomineeEvents(panel);
    }
  }

  function posCard(p, i) {
    const list = S.nominees.filter((n) => n.positionId === p.id);
    const votes = S.server.stats.votesByNominee || {};
    return `
      <section class="card pos-card" data-pid="${esc(p.id)}">
        <div class="pos-head">
          <input class="input pos-name" value="${esc(p.name)}" aria-label="Position name" maxlength="80">
          <label class="pos-max">Choose up to
            <select class="pos-max-select" aria-label="How many people voters can choose">
              ${[1, 2, 3, 4, 5].map((k) => `<option value="${k}" ${k === p.maxSelections ? 'selected' : ''}>${k}</option>`).join('')}
            </select>
          </label>
          <div class="pos-tools">
            <button class="icon-btn" data-act="pos-up" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} up" title="Move up">${SVG.up}</button>
            <button class="icon-btn" data-act="pos-down" ${i === S.positions.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} down" title="Move down">${SVG.down}</button>
            <button class="icon-btn" data-act="pos-del" aria-label="Delete ${esc(p.name)}" title="Delete position">${SVG.trash}</button>
          </div>
        </div>
        <ul class="nominee-list" data-pid="${esc(p.id)}">${list.map((n, j) => `
          <li class="nominee-row ${n.active ? '' : 'inactive'}" draggable="true" data-nid="${esc(n.id)}">
            <span class="drag-handle" title="Drag to reorder" aria-hidden="true">${SVG.grip}</span>
            ${avatar(n.displayName, n.photoUrl, 'md')}
            <span class="n-text"><span class="n-name">${esc(n.displayName)}</span>${n.bio ? `<span class="n-bio">${esc(n.bio)}</span>` : ''}</span>
            ${n.active ? '' : '<span class="badge">Hidden</span>'}
            ${votes[n.id] ? `<span class="badge badge-primary">${votes[n.id]} vote${votes[n.id] === 1 ? '' : 's'}</span>` : ''}
            <span class="n-tools">
              <button class="icon-btn updown" data-act="nom-up" ${j === 0 ? 'disabled' : ''} aria-label="Move ${esc(n.displayName)} up">${SVG.up}</button>
              <button class="icon-btn updown" data-act="nom-down" ${j === list.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(n.displayName)} down">${SVG.down}</button>
              <button class="icon-btn" data-act="nom-edit" aria-label="Edit ${esc(n.displayName)}" title="Edit">${SVG.edit}</button>
            </span>
          </li>`).join('')}</ul>
        ${list.length ? '' : '<p class="hint" style="margin-top:4px">No nominees yet — add one below, or drag one here.</p>'}
        <form class="add-nominee" data-pid="${esc(p.id)}">
          <input class="input" placeholder="Add a nominee for ${esc(p.name)}…" aria-label="New nominee for ${esc(p.name)}" maxlength="80">
          <button class="btn">Add</button>
        </form>
      </section>`;
  }

  function bindNomineeEvents(panel) {
    panel.addEventListener('input', (e) => {
      if (!e.target.classList.contains('pos-name')) return;
      const p = S.positions.find((x) => x.id === e.target.closest('.pos-card').dataset.pid);
      p.name = e.target.value;
      markDirty();
    });
    panel.addEventListener('change', (e) => {
      if (!e.target.classList.contains('pos-max-select')) return;
      const p = S.positions.find((x) => x.id === e.target.closest('.pos-card').dataset.pid);
      p.maxSelections = Number(e.target.value);
      markDirty();
    });
    panel.addEventListener('submit', (e) => {
      const form = e.target.closest('.add-nominee');
      if (!form) return;
      e.preventDefault();
      const input = $('input', form);
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) return;
      const pid = form.dataset.pid;
      if (S.nominees.some((n) => n.positionId === pid && keyOf(n.displayName) === keyOf(name))) {
        toast(name + ' is already listed for this position.', 'error');
        return;
      }
      S.nominees.push({ id: uid('n'), positionId: pid, displayName: name, bio: '', photoUrl: '', active: true });
      markDirty();
      renderNominees();
      $(`.add-nominee[data-pid="${pid}"] input`).focus();
    });
    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const card = btn.closest('.pos-card');
      const pid = card && card.dataset.pid;
      const row = btn.closest('.nominee-row');
      const act = btn.dataset.act;
      if (act === 'pos-up' || act === 'pos-down') {
        const i = S.positions.findIndex((p) => p.id === pid);
        const j = act === 'pos-up' ? i - 1 : i + 1;
        if (j < 0 || j >= S.positions.length) return;
        [S.positions[i], S.positions[j]] = [S.positions[j], S.positions[i]];
        markDirty();
        renderNominees();
        $(`.pos-card[data-pid="${pid}"] [data-act="${act}"]`)?.focus();
      } else if (act === 'pos-del') {
        const p = S.positions.find((x) => x.id === pid);
        const count = S.nominees.filter((n) => n.positionId === pid).length;
        const ok = await confirmDialog({
          title: `Delete ${p.name || 'this position'}?`,
          body: count ? `Its ${count} nominee${count === 1 ? '' : 's'} will be removed too.` : 'This position has no nominees.',
          confirmText: 'Delete', danger: true,
        });
        if (!ok) return;
        S.positions = S.positions.filter((x) => x.id !== pid);
        S.nominees = S.nominees.filter((n) => n.positionId !== pid);
        markDirty();
        renderNominees();
      } else if (act === 'nom-up' || act === 'nom-down') {
        moveNominee(row.dataset.nid, act === 'nom-up' ? -1 : 1);
        renderNominees();
        $(`.nominee-row[data-nid="${row.dataset.nid}"] [data-act="${act}"]`)?.focus();
      } else if (act === 'nom-edit') {
        editNominee(row.dataset.nid);
      }
    });

    // Drag and drop (mouse). Touch users get the up/down buttons and the edit dialog.
    let dragEl = null;
    panel.addEventListener('dragstart', (e) => {
      const li = e.target.closest && e.target.closest('.nominee-row');
      if (!li) return;
      dragEl = li;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.nid);
    });
    panel.addEventListener('dragover', (e) => {
      if (!dragEl) return;
      const list = e.target.closest('.nominee-list') || (e.target.closest('.pos-card') && $('.nominee-list', e.target.closest('.pos-card')));
      if (!list) return;
      e.preventDefault();
      const after = $$('.nominee-row:not(.dragging)', list).find((r) => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
      });
      if (after) list.insertBefore(dragEl, after);
      else list.appendChild(dragEl);
    });
    panel.addEventListener('drop', (e) => { if (dragEl) e.preventDefault(); });
    panel.addEventListener('dragend', () => {
      if (!dragEl) return;
      dragEl.classList.remove('dragging');
      dragEl = null;
      const byId = new Map(S.nominees.map((n) => [n.id, n]));
      const ordered = [];
      $$('.nominee-list', panel).forEach((list) => {
        $$('.nominee-row', list).forEach((li) => {
          const n = byId.get(li.dataset.nid);
          if (!n) return;
          n.positionId = list.dataset.pid;
          ordered.push(n);
          byId.delete(li.dataset.nid);
        });
      });
      byId.forEach((n) => ordered.push(n));
      const changed = ordered.some((n, i) => S.nominees[i] !== n);
      S.nominees = ordered;
      if (changed) markDirty();
      renderNominees();
    });
  }

  function moveNominee(id, dir) {
    const i = S.nominees.findIndex((n) => n.id === id);
    const pid = S.nominees[i].positionId;
    let j = i + dir;
    while (j >= 0 && j < S.nominees.length && S.nominees[j].positionId !== pid) j += dir;
    if (j < 0 || j >= S.nominees.length) return;
    [S.nominees[i], S.nominees[j]] = [S.nominees[j], S.nominees[i]];
    markDirty();
  }

  function editNominee(id) {
    const n = S.nominees.find((x) => x.id === id);
    const votes = (S.server.stats.votesByNominee || {})[id] || 0;
    const d = document.createElement('dialog');
    d.innerHTML = `
      <form method="dialog">
        <div class="dialog-body">
          <h2>Edit nominee</h2>
          <div class="row" style="margin:6px 0 16px"><span id="n-prev">${avatar(n.displayName, n.photoUrl)}</span><span class="hint">A photo is optional — initials are shown otherwise.</span></div>
          <div class="field"><label for="n-name">Name on the ballot</label><input id="n-name" value="${esc(n.displayName)}" required maxlength="80"></div>
          <div class="field"><label for="n-bio">Short description <span class="muted">(optional)</span></label>
            <textarea id="n-bio" maxlength="240" placeholder="e.g. Serves on the media team, 3 years">${esc(n.bio)}</textarea></div>
          <div class="field"><label for="n-photo">Photo link <span class="muted">(optional)</span></label>
            <input id="n-photo" type="url" inputmode="url" placeholder="https://…" value="${esc(n.photoUrl)}">
            <p class="hint">Paste a link to an image. Google Drive links work if the file is shared as “Anyone with the link”.</p></div>
          <div class="field"><label for="n-pos">Position</label>
            <select id="n-pos" class="select">${S.positions.map((p) => `<option value="${esc(p.id)}" ${p.id === n.positionId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <label class="switch"><input type="checkbox" id="n-active" ${n.active ? 'checked' : ''}> Show on the ballot</label>
        </div>
        <div class="dialog-actions">
          <button class="btn btn-ghost" value="delete" formnovalidate style="margin-right:auto;color:var(--danger)">${SVG.trash} Delete</button>
          <button class="btn" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-primary" value="save">Done</button>
        </div>
      </form>`;
    document.body.appendChild(d);
    const preview = () => { $('#n-prev', d).innerHTML = avatar($('#n-name', d).value, $('#n-photo', d).value); };
    $('#n-name', d).addEventListener('input', preview);
    $('#n-photo', d).addEventListener('input', preview);
    d.addEventListener('close', async () => {
      const action = d.returnValue;
      const values = {
        displayName: $('#n-name', d).value.replace(/\s+/g, ' ').trim(),
        bio: $('#n-bio', d).value.trim(),
        photoUrl: $('#n-photo', d).value.trim(),
        positionId: $('#n-pos', d).value,
        active: $('#n-active', d).checked,
      };
      d.remove();
      if (action === 'save') {
        if (!values.displayName) return toast('The name can’t be empty.', 'error');
        if (values.photoUrl && !/^https:\/\//i.test(values.photoUrl)) toast('Photo links must start with https:// — the photo was left out.', 'error', 5000);
        if (values.photoUrl && !/^https:\/\//i.test(values.photoUrl)) values.photoUrl = '';
        const moved = values.positionId !== n.positionId;
        Object.assign(n, values);
        if (moved) { S.nominees = S.nominees.filter((x) => x !== n).concat(n); }
        markDirty();
        renderNominees();
      } else if (action === 'delete') {
        const ok = await confirmDialog({
          title: `Remove ${n.displayName}?`,
          body: votes
            ? `<b>${n.displayName} already has ${votes} vote${votes === 1 ? '' : 's'}.</b> Those votes stay in the results as “(removed)”. To take them off the ballot without that, switch off “Show on the ballot” instead.`
            : 'They will be removed from the ballot when you save.',
          confirmText: 'Remove', danger: true,
        });
        if (!ok) return;
        S.nominees = S.nominees.filter((x) => x.id !== id);
        markDirty();
        renderNominees();
      }
    });
    d.showModal();
  }

  async function saveBallot(force) {
    const blank = S.positions.find((p) => !p.name.trim());
    if (blank) { toast('Every position needs a name.', 'error'); return false; }
    const btn = $('#save');
    busy(btn, true, 'Saving…');
    try {
      const st = await adminCall('saveBallot', {
        positions: S.positions.map((p) => ({ id: p.id, name: p.name.trim(), maxSelections: p.maxSelections })),
        nominees: S.nominees,
        force: !!force,
      });
      S.dirty = false;
      applyState(st, { replaceEdits: true });
      if (S.tab === 'nominees') renderNominees();
      toast('Ballot saved', 'success');
      return true;
    } catch (e) {
      if (e.code === 'VOTES_EXIST' && !force) {
        busy(btn, false);
        const ok = await confirmDialog({
          title: 'People have already voted',
          body: `<p>${S.server.stats.voters} ${S.server.stats.voters === 1 ? 'person has' : 'people have'} voted on the current ballot. Changing it now may be unfair to them, and votes already cast won't move.</p><p>Only continue if you're fixing a mistake, like a misspelled name.</p>`,
          confirmText: 'Save anyway', danger: true,
        });
        return ok ? saveBallot(true) : false;
      }
      if (e.code !== 'BAD_PASSCODE') toast(e.message, 'error', 5000);
      return false;
    } finally {
      busy(btn, false);
    }
  }

  // ───────────── Preview ─────────────

  function openPreview() {
    const positions = S.positions
      .map((p) => ({
        id: p.id, name: p.name, maxSelections: p.maxSelections,
        nominees: S.nominees.filter((n) => n.positionId === p.id && n.active)
          .map((n) => ({ id: n.id, displayName: n.displayName, bio: n.bio, photoUrl: n.photoUrl })),
      }))
      .filter((p) => p.nominees.length);
    if (!positions.length) return toast('Add some nominees first.', 'error');
    const s = S.server.settings;
    const d = document.createElement('dialog');
    d.className = 'preview-dialog';
    const src = 'index.html?preview=1' + (Api.isMock && new URLSearchParams(location.search).has('mock') ? '&mock' : '');
    d.innerHTML = `
      <div class="dialog-head"><span class="grow">Ballot preview${S.dirty ? ' <span class="badge badge-warning">includes unsaved changes</span>' : ''}</span>
        <button class="icon-btn" aria-label="Close preview">${SVG.close}</button></div>
      <iframe title="Ballot preview" src="${src}"></iframe>`;
    document.body.appendChild(d);
    const frame = $('iframe', d);
    const onMessage = (e) => {
      if (e.origin !== location.origin || e.source !== frame.contentWindow || !e.data || e.data.type !== 'preview-ready') return;
      frame.contentWindow.postMessage({
        type: 'preview-ballot',
        election: { title: s.electionTitle, voterCheckMode: s.voterCheckMode, closesAt: s.closesAt, round: 0 },
        positions,
      }, location.origin);
    };
    window.addEventListener('message', onMessage);
    $('.icon-btn', d).addEventListener('click', () => d.close());
    d.addEventListener('close', () => { window.removeEventListener('message', onMessage); d.remove(); });
    d.showModal();
  }

  // ───────────── Import wizard ─────────────

  let W = null;

  async function openWizard() {
    const d = document.createElement('dialog');
    d.className = 'wizard';
    d.innerHTML = '<div class="dialog-body"><div class="loading" style="padding:48px 0"><span class="spinner"></span>Reading the nomination form…</div></div>';
    document.body.appendChild(d);
    d.addEventListener('close', () => { d.remove(); W = null; });
    d.showModal();
    try {
      const data = await adminCall('nominations');
      const everyone = [];
      data.positions.forEach((p) => p.names.forEach((n) => everyone.push({ name: n, position: p.positionName })));
      W = {
        dialog: d,
        data,
        positions: data.positions.map((p, pi) => {
          const existingPos = S.positions.find((x) => x.name.trim().toLowerCase() === p.positionName.trim().toLowerCase());
          const existing = new Set(existingPos ? S.nominees.filter((n) => n.positionId === existingPos.id).map((n) => keyOf(n.displayName)) : []);
          const groups = Dedupe.groupNames(p.names, everyone.filter((x) => x.position !== p.positionName));
          return {
            name: p.positionName,
            total: p.names.length,
            groups: groups.map((g) => Object.assign(g, {
              id: pi + '-' + g.id,
              decision: existing.has(keyOf(g.name)) ? 'existing' : null,
            })),
          };
        }),
      };
      renderWizard();
      bindWizard();
    } catch (e) {
      $('.dialog-body', d).innerHTML = `
        <h2>Couldn't read the nominations</h2><p class="muted">${esc(e.message)}</p>
        <div class="dialog-actions" style="padding:0"><button class="btn" onclick="this.closest('dialog').close()">Close</button></div>`;
    }
  }

  function wizardCounts() {
    let toAdd = 0;
    let undecided = 0;
    W.positions.forEach((wp) => wp.groups.forEach((g) => {
      if (g.decision === 'include') toAdd++;
      if (g.decision === null) undecided++;
    }));
    return { toAdd, undecided };
  }

  function renderWizard() {
    const d = W.dialog;
    const body = $('.dialog-body', d);
    const scroll = body ? body.scrollTop : 0;
    const { toAdd, undecided } = wizardCounts();
    const comments = W.data.comments || [];
    d.innerHTML = `
      <div class="dialog-body">
        <h2>Import from nominations</h2>
        <p class="muted">${W.data.responseCount} responses in “${esc(W.data.sheetName)}”. Names that look like the same person are grouped together.
          For each group, fix the name if needed, then choose <b>Include</b> or <b>Reject</b>. Nothing goes on the ballot until you press <b>Add to ballot</b>.</p>
        ${W.positions.map((wp, pi) => {
          const left = wp.groups.filter((g) => g.decision === null).length;
          return `
          <details class="wiz-pos" open>
            <summary>${esc(wp.name)}
              <span class="badge">${wp.total} nomination${wp.total === 1 ? '' : 's'}</span>
              <span class="badge">${wp.groups.length} ${wp.groups.length === 1 ? 'person' : 'people'}</span>
              ${left ? `<span class="badge badge-warning">${left} to check</span>` : '<span class="badge badge-success">Done</span>'}
            </summary>
            ${wp.groups.map((g) => groupCard(pi, g, wp)).join('') || '<p class="muted">No names were typed for this position.</p>'}
          </details>`;
        }).join('')}
        ${comments.length ? `<details class="wiz-pos"><summary>Comments from the form <span class="badge">${comments.length}</span></summary>
          <ul class="comments-list">${comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
      </div>
      <div class="wizard-foot">
        <span class="grow muted" style="font-weight:700">${undecided ? `${undecided} group${undecided === 1 ? '' : 's'} still to check` : 'All checked — ready to add'}</span>
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn" data-act="include-all" ${undecided ? '' : 'disabled'}>Include all remaining</button>
        <button class="btn btn-primary" data-act="finish" ${undecided || !toAdd ? 'disabled' : ''}>Add ${toAdd} to ballot</button>
      </div>`;
    $('.dialog-body', d).scrollTop = scroll;
  }

  function groupCard(pi, g, wp) {
    const cls = g.decision === 'include' ? 'included' : g.decision === 'reject' ? 'rejected' : g.decision === 'existing' ? 'existing' : (g.ambiguous ? 'needs' : '');
    const showVariants = g.variants.length > 1 || g.variants[0].text !== g.name;
    const others = wp.groups.filter((x) => x !== g && x.decision !== 'existing');
    return `
      <div class="group ${cls}" data-pi="${pi}" data-gid="${esc(g.id)}">
        <div class="group-top">
          <input class="input" data-act="rename" value="${esc(g.name)}" aria-label="Name for this group" ${g.decision === 'existing' ? 'disabled' : ''}>
          <span class="badge badge-primary">${g.count} nomination${g.count === 1 ? '' : 's'}</span>
          ${g.decision === 'existing'
            ? '<span class="badge badge-success">Already on the ballot</span>'
            : `<div class="decide">
                <button class="btn btn-sm yes" data-act="include" aria-pressed="${g.decision === 'include'}">✓ Include</button>
                <button class="btn btn-sm no" data-act="reject" aria-pressed="${g.decision === 'reject'}">✕ Reject</button>
              </div>`}
        </div>
        ${showVariants ? `<div class="variants"><span class="hint" style="align-self:center">Typed as:</span>${g.variants.map((v) => `
          <span class="chip">“${esc(v.text)}” ×${v.count}${g.variants.length > 1 ? `<button data-act="split" data-text="${esc(v.text)}" aria-label="Split “${esc(v.text)}” into its own group" title="Not the same person — split off">✕</button>` : ''}</span>`).join('')}</div>` : ''}
        ${g.ambiguous && g.decision === null ? `<div class="group-extra warn">${ICONS.alert} Could be ${g.ambiguous.options.map((o) => '<b>' + esc(o) + '</b>').join(' or ')}.
          ${g.ambiguous.options.map((o) => `<button class="chip-btn" data-act="amb-merge" data-name="${esc(o)}">Same as ${esc(o)}</button>`).join('')}
          <button class="chip-btn" data-act="amb-keep">A different person</button></div>` : ''}
        ${g.hints.length && g.decision !== 'existing' ? `<div class="group-extra"><span class="muted">Fuller names on the form:</span>${g.hints.map((h) => `
          <button class="chip-btn" data-act="hint" data-name="${esc(h.name)}" title="Use this name">${esc(h.name)}</button><span class="hint">${esc(h.position)}</span>`).join('')}</div>` : ''}
        ${others.length && g.decision !== 'existing' ? `<div class="group-extra"><label class="muted">Same person as…
          <select class="select" data-act="merge" style="min-height:34px;margin-left:4px"><option value="">Choose to merge</option>
          ${others.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label></div>` : ''}
      </div>`;
  }

  function bindWizard() {
    const d = W.dialog;
    const find = (el) => {
      const card = el.closest('.group');
      if (!card) return {};
      const wp = W.positions[Number(card.dataset.pi)];
      return { wp, g: wp.groups.find((x) => x.id === card.dataset.gid) };
    };
    d.addEventListener('input', (e) => {
      if (e.target.dataset.act !== 'rename') return;
      const { g } = find(e.target);
      g.name = e.target.value;
    });
    d.addEventListener('change', (e) => {
      if (e.target.dataset.act !== 'merge' || !e.target.value) return;
      const { wp, g } = find(e.target);
      const into = wp.groups.find((x) => x.id === e.target.value);
      mergeGroups(wp, g, into);
      toast(`Merged into ${into.name}`);
      renderWizard();
    });
    d.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || btn.tagName === 'INPUT' || btn.tagName === 'SELECT') return;
      const act = btn.dataset.act;
      if (act === 'close') return d.close();
      if (act === 'include-all') {
        let left = 0;
        W.positions.forEach((wp) => wp.groups.forEach((g) => {
          if (g.decision !== null) return;
          if (g.ambiguous) left++;
          else g.decision = 'include';
        }));
        if (left) toast(`${left} possible match${left === 1 ? '' : 'es'} still need${left === 1 ? 's' : ''} your decision (highlighted).`, '', 5000);
        renderWizard();
        const first = $('.group.needs', d);
        if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      if (act === 'finish') return finishWizard();
      const { wp, g } = find(btn);
      if (!g) return;
      if (act === 'include' || act === 'reject') {
        g.decision = g.decision === act ? null : act;
      } else if (act === 'split') {
        const v = g.variants.find((x) => x.text === btn.dataset.text);
        g.variants = g.variants.filter((x) => x !== v);
        g.count -= v.count;
        const fresh = { id: uid('g'), name: Dedupe.displayName(v.text), count: v.count, variants: [v], ambiguous: null, hints: [], decision: null };
        wp.groups.splice(wp.groups.indexOf(g) + 1, 0, fresh);
        if (g.name === Dedupe.displayName(v.text)) g.name = Dedupe.displayName(g.variants[0].text);
      } else if (act === 'amb-merge') {
        const k = keyOf(btn.dataset.name);
        const into = wp.groups.find((x) => x !== g && (keyOf(x.name) === k || x.variants.some((v) => keyOf(v.text) === k)));
        if (into) { mergeGroups(wp, g, into); toast(`Merged into ${into.name}`); }
        else { g.name = btn.dataset.name; g.ambiguous = null; }
      } else if (act === 'amb-keep') {
        g.ambiguous = null;
      } else if (act === 'hint') {
        const k = keyOf(btn.dataset.name);
        const into = wp.groups.find((x) => x !== g && keyOf(x.name) === k);
        if (into) { mergeGroups(wp, g, into); toast(`Merged into ${into.name}`); }
        else { g.name = btn.dataset.name; toast(`Renamed to ${btn.dataset.name}`); }
      }
      renderWizard();
    });
  }

  function mergeGroups(wp, from, into) {
    from.variants.forEach((v) => {
      const same = into.variants.find((x) => x.text === v.text);
      if (same) same.count += v.count;
      else into.variants.push(v);
    });
    into.count += from.count;
    if (into.decision === 'reject') into.decision = null;
    wp.groups = wp.groups.filter((x) => x !== from);
  }

  async function finishWizard() {
    let added = 0;
    const created = [];
    W.positions.forEach((wp) => {
      const included = wp.groups.filter((g) => g.decision === 'include' && g.name.trim());
      if (!included.length) return;
      let pos = S.positions.find((p) => p.name.trim().toLowerCase() === wp.name.trim().toLowerCase());
      if (!pos) {
        pos = { id: uid('p'), name: wp.name, maxSelections: 1 };
        S.positions.push(pos);
        created.push(wp.name);
      }
      const have = new Set(S.nominees.filter((n) => n.positionId === pos.id).map((n) => keyOf(n.displayName)));
      included.forEach((g) => {
        const name = g.name.replace(/\s+/g, ' ').trim();
        if (have.has(keyOf(name))) return;
        have.add(keyOf(name));
        S.nominees.push({ id: uid('n'), positionId: pos.id, displayName: name, bio: '', photoUrl: '', active: true });
        added++;
      });
    });
    W.dialog.close();
    if (!added) return toast('Nothing new to add.');
    markDirty();
    renderNominees();
    const ok = await saveBallot();
    if (ok) toast(`Added ${added} nominee${added === 1 ? '' : 's'}${created.length ? ` across ${created.length} new position${created.length === 1 ? '' : 's'}` : ''}.`, 'success', 4500);
  }

  // ───────────── Settings & sharing tab ─────────────

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function defaultMessage() {
    const s = S.server.settings;
    return `🗳️ *${s.electionTitle}*\n\nVoting is now open! It only takes about a minute:\n${voterLink()}\n${s.closesAt ? `\nPlease vote before ${formatDateTime(s.closesAt)}.\n` : ''}\nThank you, and God bless! 🙏`;
  }

  function renderSettings() {
    const s = S.server.settings;
    const panel = $('#panel');
    const savedMsg = store.get(MSG_KEY, '');
    const modes = [
      { id: 'namePhone', title: 'Name + phone number', tag: 'Recommended', text: 'Voters type their name and phone number. Each phone number can vote once (07…, +254… and 254… count as the same number).' },
      { id: 'code', title: 'Voter codes', text: 'You hand each voter a one-time code. The strictest option, but you need to share the codes.' },
      { id: 'open', title: 'Open — one vote per device', tag: 'Weakest', text: 'No details asked. Anyone can vote again by using another phone or clearing their browser. Only use this for informal polls.' },
    ];
    panel.innerHTML = `
      <div class="grid-2">
        <section class="card">
          <h3>Voting status</h3>
          <div class="row">${statusPill(s.status)}</div>
          <div class="status-buttons" role="group" aria-label="Change voting status">
            <button class="btn" data-status="draft" aria-pressed="${s.status === 'draft'}">Draft<small>Not open yet</small></button>
            <button class="btn" data-status="open" aria-pressed="${s.status === 'open'}">Open<small>Accepting votes</small></button>
            <button class="btn" data-status="closed" aria-pressed="${s.status === 'closed'}">Closed<small>No more votes</small></button>
          </div>
          <p class="hint">When voting closes, the results are emailed to you automatically.</p>
        </section>

        <section class="card">
          <h3>Share the voting link</h3>
          <div class="link-box">
            <input class="input" id="voter-link" readonly value="${esc(voterLink())}" aria-label="Voting link">
            <button class="btn" id="copy-link">Copy</button>
          </div>
          <div class="qr-box">
            <canvas id="qr" width="160" height="160" aria-label="QR code for the voting link" role="img"></canvas>
            <div class="stack" style="flex:1;min-width:150px">
              <p class="hint" style="margin:0">Show this on a screen or print it so people can scan it with their phone camera.</p>
              <button class="btn btn-sm" id="dl-qr">Download QR code</button>
            </div>
          </div>
          <div class="field">
            <label for="share-msg">WhatsApp message</label>
            <textarea id="share-msg" rows="7">${esc(savedMsg || defaultMessage())}</textarea>
            <button class="btn btn-ghost btn-sm" id="reset-msg" type="button" style="justify-self:start">Reset message</button>
          </div>
          <div class="row">
            <a class="btn btn-primary" id="wa" target="_blank" rel="noopener">Share on WhatsApp</a>
            ${navigator.share ? '<button class="btn" id="native-share">More ways to share…</button>' : ''}
          </div>
          ${s.status !== 'open' ? `<p class="hint" style="margin-top:10px">${ICONS.alert} Voting isn't open yet — people who open the link now will see “Voting hasn't opened yet”.</p>` : ''}
        </section>

        <section class="card">
          <form id="settings-form" novalidate>
            <h3>Election details</h3>
            <div class="field"><label for="s-title">Election title</label><input id="s-title" value="${esc(s.electionTitle)}" maxlength="120" required></div>
            <div class="field">
              <label for="s-close">Closing time <span class="muted">(optional)</span></label>
              <div class="row" style="flex-wrap:nowrap"><input id="s-close" type="datetime-local" value="${esc(toLocalInput(s.closesAt))}"><button type="button" class="btn btn-ghost btn-sm" id="clear-close">Clear</button></div>
              <p class="hint">Voting closes automatically at this time (within 15 minutes) and you'll get the results by email. Voters see a countdown.</p>
            </div>
            <label class="switch" style="margin-bottom:22px"><input type="checkbox" id="s-results" ${s.resultsVisibleToVoters ? 'checked' : ''}> Show results to voters after voting closes</label>
            <h3>How voters are checked</h3>
            <p class="hint" style="margin-bottom:10px">This stops people from voting more than once.</p>
            ${modes.map((m) => `
              <label class="mode-option ${s.voterCheckMode === m.id ? 'is-selected' : ''}">
                <input type="radio" name="mode" value="${m.id}" ${s.voterCheckMode === m.id ? 'checked' : ''}>
                <span><b>${m.title} ${m.tag ? `<span class="badge ${m.tag === 'Weakest' ? 'badge-warning' : 'badge-success'}">${m.tag}</span>` : ''}</b><span>${m.text}</span></span>
              </label>`).join('')}
            <button class="btn btn-primary" id="save-settings" style="margin-top:8px">Save settings</button>
          </form>
        </section>

        ${s.voterCheckMode === 'code' ? `
        <section class="card" id="codes-card">
          <h3>Voter codes</h3>
          <p class="hint">Generate one code per voter, then download them and share each code privately (or print and cut them out).</p>
          <div class="row" style="margin:12px 0">
            <input class="input" id="code-count" type="number" min="1" max="500" value="50" style="width:110px" aria-label="How many codes">
            <button class="btn btn-primary" id="gen-codes">Generate codes</button>
            <button class="btn" id="dl-codes" disabled>Download CSV</button>
          </div>
          <div id="codes-box"><div class="muted">Loading codes…</div></div>
        </section>` : ''}
      </div>`;

    // Status
    $$('[data-status]', panel).forEach((b) => b.addEventListener('click', () => changeStatus(b.dataset.status, b)));

    // Sharing
    const msg = $('#share-msg');
    const updateShare = () => {
      $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg.value);
    };
    updateShare();
    msg.addEventListener('input', () => { store.set(MSG_KEY, msg.value); updateShare(); });
    $('#reset-msg').addEventListener('click', () => { msg.value = defaultMessage(); store.remove(MSG_KEY); updateShare(); });
    $('#copy-link').addEventListener('click', async () => {
      toast((await copyText(voterLink())) ? 'Link copied' : 'Could not copy — select the link and copy it manually.', 'success');
    });
    const ns = $('#native-share');
    if (ns) ns.addEventListener('click', () => navigator.share({ title: s.electionTitle, text: msg.value }).catch(() => {}));
    drawQr($('#qr'), voterLink());
    $('#dl-qr').addEventListener('click', () => {
      const big = document.createElement('canvas');
      drawQr(big, voterLink(), 1024).then((ok) => {
        if (!ok) return toast('The QR code could not be created (no internet?).', 'error');
        const a = document.createElement('a');
        a.href = big.toDataURL('image/png');
        a.download = 'voting-link-qr.png';
        a.click();
      });
    });

    // Settings form
    $$('input[name="mode"]', panel).forEach((r) => r.addEventListener('change', () => {
      $$('.mode-option', panel).forEach((l) => l.classList.toggle('is-selected', $('input', l).checked));
    }));
    $('#clear-close').addEventListener('click', () => { $('#s-close').value = ''; });
    $('#settings-form').addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });

    if (s.voterCheckMode === 'code') loadCodes();
  }

  async function changeStatus(status, btn) {
    const s = S.server.settings;
    if (status === s.status) return;
    if (status === 'open' && S.dirty) {
      toast('Save your ballot changes first (Nominees tab).', 'error', 4500);
      return;
    }
    const copy = {
      draft: { title: 'Move back to draft?', body: 'Voters will see “Voting hasn’t opened yet”. Votes already cast are kept.', confirmText: 'Move to draft' },
      open: {
        title: 'Open voting now?',
        body: `Anyone with the link can vote from now on${s.closesAt ? `, until ${esc(formatDateTime(s.closesAt))}` : ''}. Tip: use <b>Preview ballot</b> on the Nominees tab to double-check names first.`,
        confirmText: 'Open voting',
      },
      closed: { title: 'Close voting?', body: 'No more votes will be accepted. The results will be emailed to you.', confirmText: 'Close voting', danger: true },
    }[status];
    if (!(await confirmDialog(copy))) return;
    busy(btn, true, '…');
    try {
      applyState(await adminCall('setStatus', { status }));
      toast({ draft: 'Moved to draft', open: 'Voting is open! 🎉', closed: 'Voting closed — results are on their way to your inbox.' }[status], 'success', 4500);
      renderSettings();
    } catch (e) {
      busy(btn, false);
      if (e.code !== 'BAD_PASSCODE') toast(e.message, 'error', 5000);
    }
  }

  async function saveSettings(force) {
    const btn = $('#save-settings');
    const closeVal = $('#s-close').value;
    const payload = {
      electionTitle: $('#s-title').value.trim(),
      closesAt: closeVal ? new Date(closeVal).toISOString() : '',
      resultsVisibleToVoters: $('#s-results').checked,
      voterCheckMode: ($('input[name="mode"]:checked') || {}).value,
    };
    if (!payload.electionTitle) return toast('Please give the election a title.', 'error');
    busy(btn, true);
    try {
      applyState(await adminCall('saveSettings', { settings: payload, force: !!force }));
      toast('Settings saved', 'success');
      renderSettings();
    } catch (e) {
      busy(btn, false);
      if (e.code === 'VOTES_EXIST' && !force) {
        const ok = await confirmDialog({ title: 'People have already voted', body: esc(e.message) + ' Continue anyway?', confirmText: 'Change it anyway', danger: true });
        if (ok) return saveSettings(true);
        return;
      }
      if (e.code !== 'BAD_PASSCODE') toast(e.message, 'error', 5000);
    }
  }

  let qrLib = null;
  function ensureQrLib() {
    if (window.qrcode) return Promise.resolve(true);
    if (!qrLib) {
      qrLib = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
        s.onload = () => resolve(!!window.qrcode);
        s.onerror = () => { qrLib = null; resolve(false); };
        document.head.appendChild(s);
      });
    }
    return qrLib;
  }

  async function drawQr(canvas, text, px) {
    if (!(await ensureQrLib())) {
      if (canvas.isConnected) canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'QR code unavailable offline.' }));
      return false;
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const margin = 3;
    const scale = Math.max(2, Math.floor((px || 480) / (n + margin * 2)));
    const size = (n + margin * 2) * scale;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#241d2e';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
    return true;
  }

  async function loadCodes() {
    const box = $('#codes-box');
    try {
      S.codes = (await adminCall('codes')).codes;
      renderCodes();
    } catch (e) {
      if (box) box.innerHTML = `<p class="field-error">${esc(e.message)}</p>`;
    }
    $('#gen-codes').addEventListener('click', async (e) => {
      const count = Number($('#code-count').value);
      if (!(count >= 1 && count <= 500)) return toast('Choose between 1 and 500 codes.', 'error');
      busy(e.currentTarget, true, 'Generating…');
      const btn = e.currentTarget;
      try {
        S.codes = (await adminCall('generateCodes', { count })).codes;
        toast(`${count} new code${count === 1 ? '' : 's'} created`, 'success');
        renderCodes();
      } catch (err) {
        if (err.code !== 'BAD_PASSCODE') toast(err.message, 'error');
      } finally {
        busy(btn, false);
      }
    });
    $('#dl-codes').addEventListener('click', () => {
      const lines = ['Code,Used'].concat(S.codes.map((c) => [csvCell(c.code), c.used ? 'yes' : 'no'].join(',')));
      downloadFile('voter-codes.csv', lines.join('\n'), 'text/csv;charset=utf-8');
    });
  }

  function renderCodes() {
    const box = $('#codes-box');
    if (!box) return;
    const used = S.codes.filter((c) => c.used).length;
    $('#dl-codes').disabled = !S.codes.length;
    box.innerHTML = S.codes.length
      ? `<p><b>${S.codes.length}</b> codes · <b>${used}</b> used</p>
         <div class="codes-list">${S.codes.slice(0, 120).map((c) => `<span class="${c.used ? 'used' : ''}">${esc(c.code)}</span>`).join('')}</div>
         ${S.codes.length > 120 ? `<p class="hint" style="margin-top:8px">Showing 120 of ${S.codes.length}. Download the CSV for all codes.</p>` : ''}`
      : '<p class="muted">No codes yet.</p>';
  }

  // ───────────── Live results tab ─────────────

  function renderResults() {
    const panel = $('#panel');
    if (S.results) paintResults();
    else panel.innerHTML = '<div class="loading"><span class="spinner"></span>Counting votes…</div>';
    loadResults();
    S.resultsTimer = setInterval(() => {
      if (document.visibilityState === 'visible') loadResults(true);
    }, 15000);
    S.tickTimer = setInterval(() => {
      const el = $('#updated');
      if (el && S.results) el.textContent = 'Updated ' + timeAgo(S.results.generatedAt);
    }, 5000);
  }

  async function loadResults(silent) {
    try {
      S.results = await adminCall('results');
      if (S.server) {
        S.server.stats.voters = S.results.turnout;
        if (S.server.settings.status !== S.results.status) {
          S.server.settings.status = S.results.status;
        }
        renderHeader();
      }
      if (S.tab === 'results') paintResults();
    } catch (e) {
      if (!silent && e.code !== 'BAD_PASSCODE') {
        const panel = $('#panel');
        if (S.tab === 'results' && !S.results) panel.innerHTML = `<div class="notice notice-danger">${ICONS.alert}<span>${esc(e.message)}</span></div>`;
        else toast(e.message, 'error');
      }
    }
  }

  function paintResults() {
    const r = S.results;
    const panel = $('#panel');
    const y = window.scrollY;
    const closed = r.status === 'closed';
    const openVoters = $('#voters-details') && $('#voters-details').open;
    panel.innerHTML = `
      <div class="stats">
        <div class="card stat"><div class="k">People voted</div><div class="v">${r.turnout}</div></div>
        <div class="card stat"><div class="k">Status</div><div class="v small">${statusPill(r.status)}</div></div>
        <div class="card stat"><div class="k">${closed ? 'Closed' : 'Closes'}</div><div class="v small">${r.closesAt ? esc(formatDateTime(r.closesAt)) : (closed ? 'Closed manually' : 'No closing time')}</div></div>
        <div class="card stat"><div class="k">Live</div><div class="v small"><span class="live"><span class="dot"></span><span id="updated">Updated ${esc(timeAgo(r.generatedAt))}</span></span></div></div>
      </div>
      <div class="toolbar">
        <button class="btn" id="refresh-results">Refresh now</button>
        <button class="btn" id="export-csv">Export CSV</button>
        <a class="btn" href="${esc(r.spreadsheetUrl)}" target="_blank" rel="noopener">Open spreadsheet ${SVG.external}</a>
        <button class="btn" id="email-results">Email me the results</button>
      </div>
      ${r.positions.length ? r.positions.map((p) => positionResult(p, closed)).join('') : '<div class="card empty"><p class="muted">No positions on the ballot yet.</p></div>'}
      ${r.voters && r.voters.some((v) => v.name) ? `
        <details class="card" id="voters-details" ${openVoters ? 'open' : ''}>
          <summary>Who has voted (${r.voters.length})</summary>
          <p class="hint" style="margin-top:8px">Names only — nobody can see who voted for whom.</p>
          <ul class="voters-list">${r.voters.slice().reverse().map((v) => `<li><span>${esc(v.name || 'Anonymous')}</span><span class="muted">${esc(formatDateTime(v.votedAt))}</span></li>`).join('')}</ul>
        </details>` : ''}`;
    window.scrollTo(0, y);
    $('#refresh-results').addEventListener('click', (e) => { busy(e.currentTarget, true, 'Refreshing…'); loadResults(); });
    $('#export-csv').addEventListener('click', exportCsv);
    $('#email-results').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Sending…');
      try {
        const res = await adminCall('emailResults');
        toast('Sent to ' + res.sentTo, 'success');
      } catch (err) {
        if (err.code !== 'BAD_PASSCODE') toast(err.message, 'error');
      } finally {
        busy(btn, false);
      }
    });
  }

  function positionResult(p, closed) {
    const total = Math.max(1, p.ballots);
    const pct = (v) => Math.round((v / total) * 100) + '%';
    const visible = p.candidates.filter((c) => c.votes > 0 || c.active !== false);
    return `
      <section class="card result-card">
        <div class="result-head">
          <h3>${esc(p.name)}</h3>
          ${p.tie ? '<span class="badge badge-warning">Tie</span>' : ''}
          <span class="result-meta">${p.ballots} ballot${p.ballots === 1 ? '' : 's'} · ${p.abstain} skipped${p.maxSelections > 1 ? ` · up to ${p.maxSelections} elected` : ''}</span>
        </div>
        ${p.tie ? `<div class="notice notice-warning" style="margin-bottom:12px">${ICONS.alert}<span>It's a tie at the top. ${closed ? 'You’ll need to agree how to decide — for example a quick run-off between the tied nominees.' : 'This may change as more votes come in.'}</span></div>` : ''}
        <div class="bars">
          ${visible.map((c) => {
            const lead = p.leaders.indexOf(c.id) >= 0;
            const label = lead ? (p.tie ? '<span class="badge badge-warning">Tied</span>' : `<span class="badge badge-primary">${ICONS.trophy} ${closed ? 'Winner' : 'Leading'}</span>`) : '';
            return `
              <div class="bar-row ${lead ? 'leader' : ''} ${lead && p.tie ? 'tied' : ''}">
                <div class="bar-label">${avatar(c.name, '', 'sm')}<span class="name">${esc(c.name)}</span>${label}<span class="num">${c.votes}</span><span class="pct">${pct(c.votes)}</span></div>
                <div class="bar"><span style="width:${(c.votes / total) * 100}%"></span></div>
              </div>`;
          }).join('')}
          <div class="bar-row abstain">
            <div class="bar-label"><span class="avatar avatar-sm avatar-skip">–</span><span class="name">Skipped</span><span class="num">${p.abstain}</span><span class="pct">${pct(p.abstain)}</span></div>
            <div class="bar"><span style="width:${(p.abstain / total) * 100}%"></span></div>
          </div>
        </div>
      </section>`;
  }

  function exportCsv() {
    const r = S.results;
    const lines = [
      [csvCell(S.server.settings.electionTitle)].join(','),
      ['People voted', r.turnout].join(','),
      ['Exported', new Date().toLocaleString()].map(csvCell).join(','),
      '',
      ['Position', 'Nominee', 'Votes', '% of ballots', 'Result'].join(','),
    ];
    r.positions.forEach((p) => {
      const total = Math.max(1, p.ballots);
      p.candidates.forEach((c) => {
        const lead = p.leaders.indexOf(c.id) >= 0;
        lines.push([p.name, c.name, c.votes, Math.round((c.votes / total) * 1000) / 10 + '%',
          lead ? (p.tie ? 'Tied' : (r.status === 'closed' ? 'Winner' : 'Leading')) : ''].map(csvCell).join(','));
      });
      lines.push([p.name, 'Skipped', p.abstain, Math.round((p.abstain / total) * 1000) / 10 + '%', ''].map(csvCell).join(','));
    });
    downloadFile('election-results.csv', '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }

  // ───────────── Danger zone ─────────────

  function renderDanger() {
    const panel = $('#panel');
    const voters = S.server.stats.voters;
    panel.innerHTML = `
      <div class="grid-2">
        <section class="card" style="border-color:var(--danger)">
          <h3>Reset all votes</h3>
          <p class="muted">Deletes every vote and the list of who voted, so you can start fresh — for example after a test run. Nominees and settings are kept. Voter codes become unused again.</p>
          <p><b>${voters}</b> ${voters === 1 ? 'person has' : 'people have'} voted so far.</p>
          <div class="field">
            <label for="reset-confirm">Type <b>RESET</b> to confirm</label>
            <input id="reset-confirm" autocomplete="off" autocapitalize="characters" spellcheck="false">
          </div>
          <button class="btn btn-danger" id="reset-btn" disabled>Delete all votes</button>
        </section>
        <section class="card">
          <h3>Sign out</h3>
          <p class="muted">Signs this browser out of the admin page.</p>
          <button class="btn" id="signout">Sign out</button>
          ${Api.isMock ? `
            <h3 style="margin-top:22px">Demo data</h3>
            <p class="muted">Start the demo again with the sample nominations.</p>
            <button class="btn" id="reset-demo">Reset demo</button>` : ''}
        </section>
      </div>`;
    const input = $('#reset-confirm');
    const btn = $('#reset-btn');
    input.addEventListener('input', () => { btn.disabled = input.value.trim() !== 'RESET'; });
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Delete all votes?', body: 'This cannot be undone.', confirmText: 'Delete all votes', danger: true });
      if (!ok) return;
      busy(btn, true, 'Deleting…');
      try {
        applyState(await adminCall('resetVotes', { confirm: 'RESET' }));
        S.results = null;
        toast('All votes deleted. You can start again.', 'success');
        renderDanger();
      } catch (e) {
        busy(btn, false);
        if (e.code !== 'BAD_PASSCODE') toast(e.message, 'error');
      }
    });
    $('#signout').addEventListener('click', () => logout());
    const demo = $('#reset-demo');
    if (demo) demo.addEventListener('click', () => { Api.resetMock(); S.dirty = false; location.reload(); });
  }

  // ───────────── Start ─────────────

  async function init() {
    if (!S.pass) return renderLogin();
    try {
      applyState(await Api.call('admin.state', { passcode: S.pass }), { replaceEdits: true });
      renderShell();
    } catch (e) {
      if (e.code === 'BAD_PASSCODE' || e.code === 'LOCKED_OUT') return logout(e.message);
      renderLogin(e.message);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.server && !S.dirty && S.tab !== 'results') {
      refreshState().then(() => { if (S.tab === 'danger') renderDanger(); }).catch(() => {});
    }
  });

  init();
})();
