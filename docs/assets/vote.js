/* The voter page: welcome → who are you → one screen per position → review → thank you. */
(function () {
  'use strict';
  const { $, $$, esc, store, uid, avatar, normalizePhone, formatDateTime, formatCountdown, toast, confetti, ICONS } = U;

  const PREVIEW = new URLSearchParams(location.search).has('preview');
  const app = $('#app');
  const brand = $('#brand-name');
  const ABSTAIN = 'ABSTAIN';

  const state = {
    election: null,
    positions: [],
    results: null,
    step: 'loading',
    index: 0,
    choices: {},
    identity: { name: '', phone: '', code: '' },
    fromReview: false,
    submissionId: null,
    submitError: null,
    notice: null,
    votedName: '',
  };
  let clockOffset = 0;
  let countdownTimer = null;

  const now = () => Date.now() + clockOffset;
  const round = () => (state.election ? state.election.round : 0);
  const draftKey = () => 'ccv:draft:' + round();
  const votedKey = () => 'ccv:voted:' + round();
  const mode = () => (state.election ? state.election.voterCheckMode : 'namePhone');
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

  function deviceId() {
    let id = store.get('ccv:device');
    if (!id) { id = uid('d') + uid(''); store.set('ccv:device', id); }
    return id;
  }

  function saveDraft() {
    if (PREVIEW) return;
    const identity = Object.assign({}, state.identity);
    store.set(draftKey(), { choices: state.choices, identity, submissionId: state.submissionId });
  }

  // ───────────── Loading ─────────────

  async function load() {
    renderLoading();
    if (PREVIEW) return waitForPreview();
    try {
      applyBallot(await Api.call('ballot'));
    } catch (e) {
      if (e.code === 'NOT_CONFIGURED') return go('notConfigured');
      showError(e, load);
    }
  }

  function applyBallot(data, keepStep) {
    state.election = data.election;
    state.positions = data.positions || [];
    state.results = data.results || null;
    if (data.election.serverTime) clockOffset = Date.parse(data.election.serverTime) - Date.now();
    document.title = state.election.title;
    brand.textContent = state.election.title;

    if (state.election.status === 'closed') return go('closed');
    if (state.election.status !== 'open') return go('notOpen');
    if (!state.positions.length) return go('notOpen');

    const voted = !PREVIEW && store.get(votedKey());
    if (voted) { state.votedName = voted.name || ''; return go('voted'); }

    const draft = PREVIEW ? null : store.get(draftKey());
    if (draft) {
      state.identity = Object.assign(state.identity, draft.identity || {});
      state.submissionId = draft.submissionId || null;
      state.choices = cleanChoices(Object.assign({}, draft.choices || {}, state.choices));
    } else {
      state.choices = cleanChoices(state.choices);
    }
    if (!keepStep) go('welcome');
  }

  /** Drop choices for nominees or positions that are no longer on the ballot. */
  function cleanChoices(choices) {
    const out = {};
    state.positions.forEach((p) => {
      const ids = new Set(p.nominees.map((n) => n.id).concat(ABSTAIN));
      let c = choices[p.id];
      if (c == null) return;
      if (Array.isArray(c)) {
        c = c.filter((id) => ids.has(id));
        if (c.indexOf(ABSTAIN) >= 0) c = [ABSTAIN];
        c = c.slice(0, p.maxSelections);
        if (c.length) out[p.id] = c;
      } else if (ids.has(c)) {
        out[p.id] = c;
      }
    });
    return out;
  }

  function waitForPreview() {
    document.body.insertAdjacentHTML('afterbegin', '<div class="preview-banner">Preview — this is what voters see. Nothing is recorded.</div>');
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'preview-ballot') return;
      state.choices = {};
      state.index = 0;
      applyBallot({
        election: Object.assign({}, e.data.election, { status: 'open', serverTime: new Date().toISOString() }),
        positions: e.data.positions,
      });
    });
    if (window.parent !== window) window.parent.postMessage({ type: 'preview-ready' }, location.origin);
  }

  // ───────────── Navigation ─────────────

  function go(step, opts) {
    const prevIndex = state.index;
    const prevStep = state.step;
    state.step = step;
    if (opts && typeof opts.index === 'number') state.index = opts.index;
    const back = (opts && opts.back) || (step === 'position' && prevStep === 'position' && state.index < prevIndex);
    render(back ? 'from-left' : (['position', 'review', 'identify'].indexOf(step) >= 0 ? '' : 'fade'));
  }

  function needsIdentity() {
    return mode() === 'namePhone' || mode() === 'code';
  }

  function start() {
    if (needsIdentity()) go('identify');
    else go('position', { index: firstUnanswered() });
  }

  function firstUnanswered() {
    const i = state.positions.findIndex((p) => !hasChoice(p));
    return i < 0 ? 0 : i;
  }

  function hasChoice(p) {
    const c = state.choices[p.id];
    return Array.isArray(c) ? c.length > 0 : !!c;
  }

  function next() {
    const p = state.positions[state.index];
    if (!hasChoice(p)) return;
    if (state.fromReview || state.index === state.positions.length - 1) {
      state.fromReview = false;
      go('review');
    } else {
      go('position', { index: state.index + 1 });
    }
  }

  function back() {
    if (state.step === 'position') {
      if (state.fromReview) { state.fromReview = false; return go('review', { back: true }); }
      if (state.index > 0) return go('position', { index: state.index - 1, back: true });
      return needsIdentity() ? go('identify', { back: true }) : go('welcome', { back: true });
    }
    if (state.step === 'review') return go('position', { index: state.positions.length - 1, back: true });
    if (state.step === 'identify') return go('welcome', { back: true });
  }

  // ───────────── Rendering ─────────────

  function render(anim) {
    clearInterval(countdownTimer);
    document.body.classList.toggle('on-welcome', state.step === 'welcome');
    const html = (SCREENS[state.step] || SCREENS.error)();
    app.innerHTML = `<section class="screen ${anim || ''}">${html}</section>`;
    const bind = BINDERS[state.step];
    if (bind) bind();
    const h = $('h1, h2', app);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }

  function renderLoading(text) {
    app.innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span>${esc(text || 'Loading the ballot…')}</div>`;
  }

  function actionbar(inner) {
    return `<div class="actionbar"><div class="actionbar-inner">${inner}</div></div>`;
  }

  function stateScreen({ icon, tone, title, body, actions }) {
    return `
      <div class="state">
        <div class="state-icon ${tone || ''}">${icon}</div>
        <h2>${title}</h2>
        ${body || ''}
      </div>
      ${actions ? actionbar(actions) : ''}`;
  }

  const minutes = () => Math.max(1, Math.round((state.positions.length * 15) / 60));

  const SCREENS = {
    welcome() {
      const e = state.election;
      const n = state.positions.length;
      const started = Object.keys(state.choices).length > 0;
      return `
        <div class="hero">
          <div class="hero-mark">${ICONS.ballot}</div>
          <p class="eyebrow">You're invited to vote</p>
          <h1>${esc(e.title)}</h1>
          <span class="pill pill-open"><span class="dot"></span>Voting is open</span>
          <p class="lead">${n} position${n === 1 ? '' : 's'} · takes about ${minutes()} minute${minutes() === 1 ? '' : 's'}</p>
          ${e.closesAt ? `<div class="countdown" id="countdown" aria-live="off"></div>` : ''}
        </div>
        <ol class="how">
          ${needsIdentity() ? `<li><span class="num">1</span><span>${mode() === 'code' ? 'Enter your voter code' : 'Tell us your name and phone number'}</span></li>` : ''}
          <li><span class="num">${needsIdentity() ? 2 : 1}</span><span>Pick one person for each position — or skip</span></li>
          <li><span class="num">${needsIdentity() ? 3 : 2}</span><span>Check your choices and submit</span></li>
        </ol>
        <p class="fineprint">${ICONS.lock} Your vote is secret — only the totals are counted.</p>
        ${actionbar(`<button class="btn btn-primary btn-lg" id="start">${started ? 'Continue voting' : 'Start voting'} ${ICONS.arrowRight}</button>`)}`;
    },

    identify() {
      const id = state.identity;
      const fields = mode() === 'code'
        ? `<div class="field">
             <label for="code">Voter code</label>
             <input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="e.g. ABCD-2345" value="${esc(id.code)}" required aria-describedby="code-hint code-err">
             <p class="hint" id="code-hint">You'll find it on the slip or message you were given.</p>
             <p class="field-error" id="code-err"></p>
           </div>`
        : `<div class="field">
             <label for="name">Full name</label>
             <input id="name" name="name" autocomplete="name" autocapitalize="words" placeholder="e.g. Mary Wanjiku" value="${esc(id.name)}" required aria-describedby="name-err">
             <p class="field-error" id="name-err"></p>
           </div>
           <div class="field">
             <label for="phone">Phone number</label>
             <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" value="${esc(id.phone)}" required aria-describedby="phone-hint phone-err">
             <p class="hint" id="phone-hint">Only used to make sure everyone votes once. It's never shown next to your vote.</p>
             <p class="field-error" id="phone-err"></p>
           </div>`;
      return `
        <h2>${mode() === 'code' ? 'Enter your voter code' : 'First, tell us who you are'}</h2>
        <p class="muted">This keeps the election fair — one person, one vote.</p>
        <form id="idform" novalidate>
          ${fields}
          <p class="field-error" id="form-err" role="alert"></p>
          <button type="submit" class="sr-only" tabindex="-1">Continue</button>
        </form>
        ${actionbar(`
          <button class="btn btn-lg" id="back" aria-label="Back">${ICONS.arrowLeft}</button>
          <button class="btn btn-primary btn-lg" id="continue">Continue ${ICONS.arrowRight}</button>`)}`;
    },

    position() {
      const p = state.positions[state.index];
      const total = state.positions.length;
      const multi = p.maxSelections > 1;
      const chosen = [].concat(state.choices[p.id] || []);
      const type = multi ? 'checkbox' : 'radio';
      const pct = Math.round((state.index / total) * 100);
      const last = state.fromReview || state.index === total - 1;
      const card = (id, name, bio, avatarHtml, extraCls) => {
        const sel = chosen.indexOf(id) >= 0;
        return `
          <label class="candidate ${multi ? 'multi' : ''} ${extraCls || ''} ${sel ? 'is-selected' : ''}">
            <input type="${type}" name="choice" value="${esc(id)}" ${sel ? 'checked' : ''}>
            ${avatarHtml}
            <span class="c-text"><span class="c-name">${esc(name)}</span>${bio ? `<span class="c-bio">${esc(bio)}</span>` : ''}</span>
            <span class="c-check" aria-hidden="true">${ICONS.check}</span>
          </label>`;
      };
      return `
        <div class="progress-wrap">
          <div class="progress-label"><span>Position ${state.index + 1} of ${total}</span><span>${pct}% done</span></div>
          <div class="progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${state.index}"><span style="width:${pct}%"></span></div>
        </div>
        <h2>Who should be <span class="hl">${esc(p.name)}</span>?</h2>
        <p class="muted" id="pos-hint">${multi ? `Choose up to ${p.maxSelections}.` : 'Choose one.'} Tap a name to select it.</p>
        <fieldset class="candidates" aria-describedby="pos-hint">
          <legend class="sr-only">${esc(p.name)}</legend>
          ${p.nominees.map((n) => card(n.id, n.displayName, n.bio, avatar(n.displayName, n.photoUrl))).join('')}
          ${card(ABSTAIN, 'Skip this position', `I'd rather not vote for ${p.name}`, '<span class="avatar avatar-skip" aria-hidden="true">–</span>', 'candidate-abstain')}
        </fieldset>
        ${actionbar(`
          <button class="btn btn-lg" id="back" aria-label="Back">${ICONS.arrowLeft}</button>
          <button class="btn btn-primary btn-lg" id="next" ${hasChoice(p) ? '' : 'disabled'}>${last ? 'Review my choices' : 'Next'} ${ICONS.arrowRight}</button>`)}`;
    },

    review() {
      const who = mode() === 'namePhone' && state.identity.name
        ? `<p class="voting-as">${avatar(state.identity.name, '', 'sm')} Voting as <b>${esc(state.identity.name)}</b></p>` : '';
      const rows = state.positions.map((p, i) => {
        const c = [].concat(state.choices[p.id] || []);
        const names = c.indexOf(ABSTAIN) >= 0 || !c.length
          ? '<span class="r-skip">Skipped</span>'
          : c.map((id) => {
            const n = p.nominees.find((x) => x.id === id);
            return n ? `<span>${avatar(n.displayName, n.photoUrl, 'sm')}${esc(n.displayName)}</span>` : '';
          }).join('');
        return `
          <li><button class="review-row" data-i="${i}">
            <span class="r-main"><span class="r-pos">${esc(p.name)}</span><span class="r-choice">${names}</span></span>
            <span class="r-edit">Change</span>
          </button></li>`;
      }).join('');
      const err = state.submitError;
      return `
        <h2>Check your choices</h2>
        <p class="muted">Tap any row to change it. When you're happy, submit your vote.</p>
        ${who}
        ${state.notice ? `<div class="notice notice-warning" role="alert">${ICONS.alert}<span>${esc(state.notice)}</span></div>` : ''}
        <ul class="review-list">${rows}</ul>
        ${err
          ? `<div class="notice notice-danger" role="alert">${ICONS.alert}<span>${esc(err)} Your choices are saved — just tap <b>Try again</b>.</span></div>`
          : `<div class="notice">${ICONS.lock}<span>Once you submit, your vote can't be changed.</span></div>`}
        ${actionbar(`
          <button class="btn btn-lg" id="back" aria-label="Back">${ICONS.arrowLeft}</button>
          <button class="btn btn-primary btn-lg" id="submit">${err ? 'Try again' : 'Submit my vote'} ${ICONS.check.replace('<svg', '<svg class="icon"')}</button>`)}`;
    },

    done() {
      const name = firstName(state.identity.name);
      return `
        <div class="done">
          <div class="done-check">${ICONS.check}</div>
          <h2>Thank you${name ? ', ' + esc(name) : ''}!</h2>
          <p class="lead">Your vote has been counted.</p>
          <p class="muted">Each person votes once, so this link won't let you vote again.${PREVIEW ? ' <b>(Preview — nothing was recorded.)</b>' : ''}</p>
        </div>`;
    },

    voted() {
      const name = firstName(state.votedName || state.identity.name);
      return stateScreen({
        icon: ICONS.heart, tone: 'primary',
        title: "You've already voted. Thank you!",
        body: `<p class="lead">${name ? esc(name) + ', your' : 'Your'} vote is safely counted.</p><p class="muted">Each person can vote only once.</p>`,
      });
    },

    closed() {
      const r = state.results;
      return stateScreen({
        icon: ICONS.flag, tone: 'danger',
        title: 'Voting has closed',
        body: r
          ? `<p class="lead">Thank you to everyone who voted. Here are the results.</p>`
          : `<p class="lead">Thank you to everyone who voted!</p><p class="muted">The results will be shared soon.</p>`,
      }) + (r ? resultsHtml(r) : '');
    },

    notOpen() {
      return stateScreen({
        icon: ICONS.clock, tone: 'primary',
        title: "Voting hasn't opened yet",
        body: '<p class="lead">Please check back soon. This page will be ready when voting starts.</p>',
        actions: '<button class="btn btn-primary btn-lg" id="refresh">Check again</button>',
      });
    },

    notConfigured() {
      return stateScreen({
        icon: ICONS.ballot,
        title: 'This voting page isn’t connected yet',
        body: '<p class="muted">If you are the organiser, paste your Apps Script web app URL into <code>config.js</code> (see SETUP.md).</p>',
      });
    },

    error() {
      return stateScreen({
        icon: ICONS.wifiOff,
        title: 'We couldn’t load the ballot',
        body: `<p class="lead">${esc(state.errorMessage || 'Something went wrong.')}</p>`,
        actions: '<button class="btn btn-primary btn-lg" id="retry">Try again</button>',
      });
    },
  };

  function resultsHtml(r) {
    return `<div style="margin-top:24px">${r.positions.map((p) => {
      const max = Math.max(1, p.ballots);
      return `
        <div class="card result-card">
          <div class="result-head"><h3>${esc(p.name)}</h3>${p.tie ? '<span class="badge badge-warning">Tie</span>' : ''}</div>
          <div class="bars">
            ${p.candidates.filter((c) => c.votes > 0 || c.active !== false).map((c) => {
              const lead = p.leaders.indexOf(c.id) >= 0;
              return `<div class="bar-row ${lead ? 'leader' : ''} ${lead && p.tie ? 'tied' : ''}">
                <div class="bar-label">${avatar(c.name, '', 'sm')}<span class="name">${esc(c.name)}</span>${lead && !p.tie ? '<span class="badge badge-primary">Elected</span>' : ''}<span class="num">${c.votes}</span></div>
                <div class="bar"><span style="width:${(c.votes / max) * 100}%"></span></div></div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  // ───────────── Behaviour ─────────────

  const BINDERS = {
    welcome() {
      $('#start').addEventListener('click', start);
      startCountdown();
    },

    identify() {
      $('#back').addEventListener('click', back);
      const form = $('#idform');
      const submit = (e) => { if (e) e.preventDefault(); checkIdentity(); };
      form.addEventListener('submit', submit);
      $('#continue').addEventListener('click', submit);
      $$('input', form).forEach((input) => input.addEventListener('input', () => {
        state.identity[input.name] = input.value;
        input.removeAttribute('aria-invalid');
        const err = $('#' + input.id + '-err');
        if (err) err.textContent = '';
        saveDraft();
      }));
      const first = $$('input', form).find((i) => !i.value) || $('input', form);
      setTimeout(() => first && first.focus(), 350);
    },

    position() {
      const p = state.positions[state.index];
      const fieldset = $('.candidates');
      fieldset.addEventListener('change', (e) => {
        const input = e.target;
        if (input.name !== 'choice') return;
        if (p.maxSelections > 1) {
          let c = [].concat(state.choices[p.id] || []).filter((id) => id !== input.value);
          if (input.checked) {
            if (input.value === ABSTAIN) c = [ABSTAIN];
            else {
              c = c.filter((id) => id !== ABSTAIN);
              if (c.length >= p.maxSelections) {
                input.checked = false;
                toast(`You can choose up to ${p.maxSelections} for ${p.name}.`);
                return;
              }
              c.push(input.value);
            }
          }
          state.choices[p.id] = c;
          $$('input', fieldset).forEach((i) => { i.checked = c.indexOf(i.value) >= 0; });
        } else {
          state.choices[p.id] = input.value;
        }
        $$('.candidate', fieldset).forEach((l) => l.classList.toggle('is-selected', $('input', l).checked));
        $('#next').disabled = !hasChoice(p);
        saveDraft();
      });
      $('#back').addEventListener('click', back);
      $('#next').addEventListener('click', next);
    },

    review() {
      $('#back').addEventListener('click', back);
      $$('.review-row').forEach((b) => b.addEventListener('click', () => {
        state.fromReview = true;
        state.notice = null;
        go('position', { index: Number(b.dataset.i) });
      }));
      $('#submit').addEventListener('click', submitVote);
    },

    closed() {},
    notOpen() { $('#refresh').addEventListener('click', load); },
    error() { $('#retry').addEventListener('click', () => (state.retry || load)()); },
    done() { confetti(); },
  };

  function startCountdown() {
    const el = $('#countdown');
    if (!el) return;
    const end = Date.parse(state.election.closesAt);
    const tick = () => {
      const left = formatCountdown(end - now());
      if (!left) { clearInterval(countdownTimer); load(); return; }
      el.innerHTML = `Closes in <b>${left}</b> <span class="muted">· ${esc(formatDateTime(state.election.closesAt))}</span>`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.innerHTML;
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(label)}`;
      btn.disabled = true;
    } else if (btn.dataset.label) {
      btn.innerHTML = btn.dataset.label;
      btn.disabled = false;
    }
  }

  function fieldError(id, message) {
    const input = $('#' + id);
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    const el = $('#' + id + '-err');
    if (el) el.textContent = message;
  }

  async function checkIdentity() {
    const id = state.identity;
    $('#form-err').textContent = '';
    if (mode() === 'code') {
      if (String(id.code || '').replace(/[^a-z0-9]/gi, '').length < 6) return fieldError('code', 'Please enter the code you were given.');
    } else {
      const nameOk = String(id.name || '').trim().replace(/\s+/g, ' ').length >= 2;
      const phoneOk = !!normalizePhone(id.phone);
      if (!nameOk) return fieldError('name', 'Please enter your full name.');
      if (!phoneOk) return fieldError('phone', 'That doesn’t look like a phone number. Try e.g. 0712 345 678.');
    }
    if (PREVIEW) return go('position', { index: firstUnanswered() });

    const btn = $('#continue');
    setBusy(btn, true, 'Checking…');
    try {
      const res = await Api.call('checkVoter', { identity: identityPayload() });
      if (res.voted) {
        store.set(votedKey(), { name: id.name || '', at: new Date().toISOString() });
        state.votedName = id.name;
        return go('voted');
      }
      go('position', { index: firstUnanswered() });
    } catch (e) {
      setBusy(btn, false);
      if (e.code === 'INVALID_CODE') return fieldError('code', e.message);
      if (e.code === 'INVALID_NAME') return fieldError('name', e.message);
      if (e.code === 'INVALID_PHONE') return fieldError('phone', e.message);
      if (e.code === 'CLOSED' || e.code === 'NOT_OPEN') return load();
      $('#form-err').textContent = e.message;
    }
  }

  function identityPayload() {
    const id = state.identity;
    if (mode() === 'code') return { code: id.code };
    if (mode() === 'namePhone') return { name: id.name, phone: id.phone };
    return { deviceId: deviceId() };
  }

  async function submitVote() {
    const btn = $('#submit');
    if (PREVIEW) {
      setBusy(btn, true, 'Sending your vote…');
      await new Promise((r) => setTimeout(r, 700));
      return go('done');
    }
    if (!state.submissionId) { state.submissionId = uid('s'); saveDraft(); }
    setBusy(btn, true, 'Sending your vote…');
    try {
      await Api.call('vote', { identity: identityPayload(), choices: state.choices, submissionId: state.submissionId }, { timeoutMs: 45000 });
      store.set(votedKey(), { name: state.identity.name || '', at: new Date().toISOString() });
      store.remove(draftKey());
      state.submitError = null;
      go('done');
    } catch (e) {
      if (e.code === 'ALREADY_VOTED') {
        store.set(votedKey(), { name: state.identity.name || '', at: new Date().toISOString() });
        store.remove(draftKey());
        return go('voted');
      }
      if (e.code === 'CLOSED' || e.code === 'NOT_OPEN') return load();
      if (['INVALID_CHOICE', 'INCOMPLETE', 'NO_BALLOT'].indexOf(e.code) >= 0) return refreshBallot();
      if (['INVALID_CODE', 'INVALID_NAME', 'INVALID_PHONE'].indexOf(e.code) >= 0) {
        toast(e.message, 'error', 5000);
        return go('identify');
      }
      state.submitError = e.message;
      go('review');
    }
  }

  /** The ballot changed while this person was voting: reload it, keep what's still valid. */
  async function refreshBallot() {
    renderLoading('The ballot was just updated — reloading…');
    try {
      applyBallot(await Api.call('ballot'), true);
      if (state.step === 'closed' || state.step === 'notOpen') return;
      const missing = firstUnansweredIndex();
      state.notice = 'The ballot was updated while you were voting. Please check your choices.';
      if (missing >= 0) {
        toast('Please make a choice for ' + state.positions[missing].name + '.');
        go('position', { index: missing });
      } else {
        go('review');
      }
    } catch (e) {
      showError(e, refreshBallot);
    }
  }

  function firstUnansweredIndex() {
    return state.positions.findIndex((p) => !hasChoice(p));
  }

  function showError(e, retry) {
    state.errorMessage = e.message;
    state.retry = retry;
    go('error');
  }

  // Keyboard: Enter moves on from a position screen; swipes move between positions.
  document.addEventListener('keydown', (e) => {
    if (state.step !== 'position' || e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    next();
  });

  let touch = null;
  app.addEventListener('touchstart', (e) => {
    if (state.step !== 'position' || e.touches.length !== 1) return;
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  app.addEventListener('touchend', (e) => {
    if (!touch || state.step !== 'position') return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    const quick = Date.now() - touch.t < 600;
    touch = null;
    if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) {
      if (hasChoice(state.positions[state.index])) next();
      else toast('Choose someone (or skip) first.');
    } else {
      back();
    }
  }, { passive: true });

  window.addEventListener('online', () => {
    if (state.step === 'error') (state.retry || load)();
  });

  load();
})();
