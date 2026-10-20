/**
 * Communications Committee Election — backend
 * -------------------------------------------
 * Paste this whole file into the spreadsheet's Extensions → Apps Script editor
 * (replacing anything already there), then follow SETUP.md.
 *
 * The spreadsheet is the database:
 *   Form responses 1  raw nominations from the Google Form (never modified)
 *   Positions         the positions on the ballot
 *   Nominees          the candidates for each position
 *   Settings          election title, status, closing time, voter check mode…
 *   Voters            who has voted (phone numbers / codes are stored only as hashes)
 *   Votes             one row per position per ballot, with NO voter identity
 *   Codes             one-time voter codes (only used in "code" mode)
 *   Results           a live summary, rewritten after every vote
 *
 * Script Properties (Project Settings → Script Properties):
 *   ADMIN_PASSCODE    the passcode for admin.html (you set this)
 *   VOTER_SALT        secret used to hash voter identities (created by setup())
 */

const SHEETS = {
  responses: 'Form responses 1',
  positions: 'Positions',
  nominees: 'Nominees',
  settings: 'Settings',
  voters: 'Voters',
  votes: 'Votes',
  codes: 'Codes',
  results: 'Results',
};

const HEADERS = {
  Positions: ['id', 'name', 'order', 'maxSelections'],
  Nominees: ['id', 'positionId', 'displayName', 'bio', 'photoUrl', 'order', 'active'],
  Settings: ['key', 'value'],
  Voters: ['voterKey', 'name', 'votedAt', 'submissionKey'],
  Votes: ['ballotId', 'positionId', 'positionName', 'nomineeId', 'nomineeName'],
  Codes: ['code', 'used', 'createdAt'],
};

const DEFAULT_SETTINGS = {
  electionTitle: 'Communications Committee Elections',
  status: 'draft',
  closesAt: '',
  voterCheckMode: 'namePhone',
  resultsVisibleToVoters: 'false',
  round: '1',
  closedEmailRound: '',
};

const STATUSES = ['draft', 'open', 'closed'];
const VOTER_CHECK_MODES = ['namePhone', 'code', 'open'];
const ABSTAIN = 'ABSTAIN'; // no longer offered to voters; kept so older ballots still tally
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

// ───────────────────────────── Entry points ─────────────────────────────

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!params.action) {
    return json_({ ok: true, service: 'election-api', message: 'The election backend is running.' });
  }
  return handle_(params);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_REQUEST', message: 'Invalid request.' });
  }
  return handle_(body);
}

/** Run once from the Apps Script editor (select "setup" → Run). Safe to run again. */
function setup() {
  Object.keys(HEADERS).forEach(sheet_);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('VOTER_SALT')) {
    props.setProperty('VOTER_SALT', Utilities.getUuid() + Utilities.getUuid());
  }
  if (!readTable_(SHEETS.settings).length) saveSettings_({});
  writeResultsSheet_();

  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'autoCloseCheck'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('autoCloseCheck').timeBased().everyMinutes(15).create();

  const hasPasscode = !!props.getProperty('ADMIN_PASSCODE');
  Logger.log('Setup complete. Tabs are ready.');
  Logger.log(hasPasscode
    ? 'Admin passcode is set.'
    : 'Next: add ADMIN_PASSCODE in Project Settings → Script Properties (see SETUP.md).');
}

/** Runs every 15 minutes (installed by setup) so a closing time takes effect and the results email is sent. */
function autoCloseCheck() {
  settings_();
}

const PUBLIC_ACTIONS = {
  ballot: apiBallot_,
  checkVoter: apiCheckVoter_,
  vote: apiVote_,
};

const ADMIN_ACTIONS = {
  'admin.login': function () { return {}; },
  'admin.state': apiAdminState_,
  'admin.nominations': apiNominations_,
  'admin.saveBallot': apiSaveBallot_,
  'admin.saveSettings': apiSaveSettings_,
  'admin.setStatus': apiSetStatus_,
  'admin.results': apiResults_,
  'admin.codes': apiCodes_,
  'admin.generateCodes': apiGenerateCodes_,
  'admin.resetVotes': apiResetVotes_,
  'admin.emailResults': apiEmailResults_,
};

function handle_(req) {
  try {
    const action = String(req.action || '');
    let fn = PUBLIC_ACTIONS[action];
    if (!fn && ADMIN_ACTIONS[action]) {
      checkPasscode_(req.passcode);
      fn = ADMIN_ACTIONS[action];
    }
    if (!fn) throw err_('UNKNOWN_ACTION', 'Unknown action.');
    return json_(Object.assign({ ok: true }, fn(req)));
  } catch (e) {
    if (e && e.code) return json_({ ok: false, error: e.code, message: e.message });
    console.error(e && e.stack ? e.stack : e);
    return json_({ ok: false, error: 'SERVER_ERROR', message: 'Something went wrong on the server. Please try again.' });
  }
}

// ───────────────────────────── Public API ─────────────────────────────

function apiBallot_() {
  const s = settings_();
  const out = { election: publicElection_(s) };
  if (s.status === 'open') out.positions = ballotPositions_(false);
  if (s.status === 'closed' && s.resultsVisibleToVoters) {
    const r = computeResults_();
    out.results = { turnout: r.turnout, positions: r.positions };
  }
  return out;
}

function apiCheckVoter_(req) {
  const s = settings_();
  assertOpen_(s);
  const who = identityKey_(s.voterCheckMode, req.identity);
  if (s.voterCheckMode === 'code') {
    const code = findCode_(who.code);
    if (!code) throw err_('INVALID_CODE', "That code wasn't recognised. Please check it and try again.");
    if (code.used) return { voted: true };
  }
  const voted = readTable_(SHEETS.voters).some(function (v) { return v.voterKey === who.key; });
  return { voted: voted };
}

function apiVote_(req) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw err_('BUSY', 'Lots of people are voting right now. Please tap "Try again" in a moment.');
  }
  try {
    const s = settings_();
    assertOpen_(s);
    const who = identityKey_(s.voterCheckMode, req.identity);
    const submissionKey = req.submissionId ? hash_('submission:' + String(req.submissionId).slice(0, 100)) : '';

    const existing = readTable_(SHEETS.voters).filter(function (v) { return v.voterKey === who.key; })[0];
    if (existing) {
      // The same submission arriving twice (e.g. a retry after a dropped connection) is not an error.
      if (submissionKey && existing.submissionKey === submissionKey) return { recorded: true, duplicate: true };
      throw err_('ALREADY_VOTED', "You've already voted. Thank you!");
    }

    let code = null;
    if (s.voterCheckMode === 'code') {
      code = findCode_(who.code);
      if (!code) throw err_('INVALID_CODE', "That code wasn't recognised. Please check it and try again.");
      if (code.used) throw err_('ALREADY_VOTED', 'This code has already been used to vote.');
    }

    const rows = validateChoices_(req.choices);
    insertBallot_(Utilities.getUuid(), rows);
    appendRows_(SHEETS.voters, [{
      voterKey: who.key,
      name: who.name,
      votedAt: new Date().toISOString(),
      submissionKey: submissionKey,
    }]);
    if (code) markCodeUsed_(code.code);
    writeResultsSheet_();
    return { recorded: true };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── Admin API ─────────────────────────────

function apiAdminState_() {
  const s = settings_();
  const codes = readTable_(SHEETS.codes);
  const votesByNominee = {};
  readTable_(SHEETS.votes).forEach(function (v) {
    votesByNominee[v.nomineeId] = (votesByNominee[v.nomineeId] || 0) + 1;
  });
  return {
    settings: s,
    positions: ballotPositions_(true),
    stats: {
      voters: readTable_(SHEETS.voters).length,
      codesTotal: codes.length,
      codesUsed: codes.filter(function (c) { return toBool_(c.used); }).length,
      votesByNominee: votesByNominee,
    },
    spreadsheetUrl: ss_().getUrl(),
  };
}

function apiNominations_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.responses);
  if (!sh) {
    sh = ss.getSheets().filter(function (x) { return /^form responses/i.test(x.getName()); })[0];
  }
  if (!sh || sh.getLastRow() < 1) {
    throw err_('NO_RESPONSES', 'Could not find the "Form responses 1" tab with the nominations.');
  }
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(function (h) { return String(h || '').trim(); });
  const rows = values.slice(1).filter(function (r) {
    return r.some(function (c) { return String(c).trim() !== ''; });
  });

  const isMeta = function (h) { return !h || /timestamp|e-?mail|comment|note|remark/i.test(h); };
  let columns = [];
  headers.forEach(function (h, i) {
    const m = h.match(/^\s*(?:nominees?|nominations?|candidates?)\s*(?:for)?\s*[:\-–]?\s*(.+)$/i);
    if (m) columns.push({ index: i, header: h, positionName: m[1].trim() });
  });
  if (!columns.length) {
    columns = headers
      .map(function (h, i) { return { index: i, header: h, positionName: h }; })
      .filter(function (c) { return !isMeta(c.header); });
  }
  const commentIndex = headers.findIndex(function (h) { return /comment|note|remark/i.test(h); });

  return {
    sheetName: sh.getName(),
    responseCount: rows.length,
    positions: columns.map(function (c) {
      return {
        header: c.header,
        positionName: c.positionName,
        names: rows.map(function (r) { return String(r[c.index] || '').trim(); }).filter(String),
      };
    }),
    comments: commentIndex < 0 ? [] : rows
      .map(function (r) { return String(r[commentIndex] || '').trim(); })
      .filter(String),
  };
}

function apiSaveBallot_(req) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('BUSY', 'The server is busy. Please try again.');
  try {
    if (readTable_(SHEETS.voters).length && !req.force) {
      throw err_('VOTES_EXIST', 'People have already voted. Changing the ballot now can affect the results.');
    }
    const seen = {};
    const positions = (req.positions || []).map(function (p, i) {
      const id = cleanId_(p.id);
      if (seen[id]) throw err_('BAD_REQUEST', 'Duplicate position id.');
      seen[id] = true;
      const name = cleanText_(p.name, 80);
      if (!name) throw err_('BAD_REQUEST', 'Every position needs a name.');
      return {
        id: id,
        name: name,
        order: i + 1,
        maxSelections: Math.min(10, Math.max(1, parseInt(p.maxSelections, 10) || 1)),
      };
    });
    const orderInPosition = {};
    const nominees = (req.nominees || [])
      .filter(function (n) { return seen[String(n.positionId)]; })
      .map(function (n) {
        const id = cleanId_(n.id);
        if (seen[id]) throw err_('BAD_REQUEST', 'Duplicate nominee id.');
        seen[id] = true;
        const name = cleanText_(n.displayName, 80);
        if (!name) throw err_('BAD_REQUEST', 'Every nominee needs a name.');
        const pid = String(n.positionId);
        orderInPosition[pid] = (orderInPosition[pid] || 0) + 1;
        return {
          id: id,
          positionId: pid,
          displayName: name,
          bio: cleanText_(n.bio, 240),
          photoUrl: /^https:\/\/\S+$/i.test(String(n.photoUrl || '').trim()) ? String(n.photoUrl).trim().slice(0, 500) : '',
          order: orderInPosition[pid],
          active: n.active === false || n.active === 'false' ? 'false' : 'true',
        };
      });
    writeTable_(SHEETS.positions, positions);
    writeTable_(SHEETS.nominees, nominees);
    writeResultsSheet_();
    return apiAdminState_();
  } finally {
    lock.releaseLock();
  }
}

function apiSaveSettings_(req) {
  const input = req.settings || {};
  const current = settings_();
  const patch = {};
  if ('electionTitle' in input) patch.electionTitle = cleanText_(input.electionTitle, 120) || DEFAULT_SETTINGS.electionTitle;
  if ('closesAt' in input) {
    const raw = String(input.closesAt || '').trim();
    if (raw && isNaN(new Date(raw).getTime())) throw err_('BAD_REQUEST', 'That closing time is not a valid date.');
    patch.closesAt = raw ? new Date(raw).toISOString() : '';
    if (patch.closesAt && current.status === 'open' && new Date(patch.closesAt).getTime() <= Date.now()) {
      throw err_('BAD_REQUEST', 'The closing time is in the past. Choose a later time, or close voting with the status buttons.');
    }
  }
  if ('resultsVisibleToVoters' in input) patch.resultsVisibleToVoters = toBool_(input.resultsVisibleToVoters) ? 'true' : 'false';
  if ('voterCheckMode' in input) {
    if (VOTER_CHECK_MODES.indexOf(input.voterCheckMode) < 0) throw err_('BAD_REQUEST', 'Unknown voter check mode.');
    if (input.voterCheckMode !== current.voterCheckMode && readTable_(SHEETS.voters).length && !req.force) {
      throw err_('VOTES_EXIST', 'People have already voted. Changing how voters are checked now could let someone vote twice.');
    }
    patch.voterCheckMode = input.voterCheckMode;
  }
  saveSettings_(patch);
  return apiAdminState_();
}

function apiSetStatus_(req) {
  const status = String(req.status || '');
  if (STATUSES.indexOf(status) < 0) throw err_('BAD_REQUEST', 'Unknown status.');
  const s = settings_();
  if (status === 'open') {
    if (!ballotPositions_(false).length) throw err_('NO_BALLOT', 'Add at least one nominee before opening voting.');
    if (s.closesAt && new Date(s.closesAt).getTime() <= Date.now()) {
      throw err_('BAD_REQUEST', 'The closing time has already passed. Change or clear it in Settings first.');
    }
  }
  saveSettings_({ status: status });
  if (status === 'closed' && s.status !== 'closed') onClosed_();
  return apiAdminState_();
}

function apiResults_() {
  const s = settings_();
  const r = computeResults_();
  r.status = s.status;
  r.closesAt = s.closesAt;
  r.voterCheckMode = s.voterCheckMode;
  r.voters = readTable_(SHEETS.voters).map(function (v) {
    return { name: String(v.name || ''), votedAt: String(v.votedAt || '') };
  });
  r.generatedAt = new Date().toISOString();
  r.spreadsheetUrl = ss_().getUrl();
  return r;
}

function apiCodes_() {
  return {
    codes: readTable_(SHEETS.codes).map(function (c) {
      return { code: String(c.code), used: toBool_(c.used), createdAt: String(c.createdAt || '') };
    }),
  };
}

function apiGenerateCodes_(req) {
  const count = parseInt(req.count, 10);
  if (!(count >= 1 && count <= 500)) throw err_('BAD_REQUEST', 'Choose between 1 and 500 codes.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('BUSY', 'The server is busy. Please try again.');
  try {
    const existing = {};
    readTable_(SHEETS.codes).forEach(function (c) { existing[normalizeCode_(c.code)] = true; });
    const now = new Date().toISOString();
    const rows = [];
    while (rows.length < count) {
      let raw = '';
      for (let i = 0; i < 8; i++) raw += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
      if (existing[raw]) continue;
      existing[raw] = true;
      rows.push({ code: raw.slice(0, 4) + '-' + raw.slice(4), used: 'false', createdAt: now });
    }
    appendRows_(SHEETS.codes, rows);
  } finally {
    lock.releaseLock();
  }
  return apiCodes_();
}

function apiResetVotes_(req) {
  if (req.confirm !== 'RESET') throw err_('BAD_REQUEST', 'Type RESET to confirm.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('BUSY', 'The server is busy. Please try again.');
  try {
    writeTable_(SHEETS.votes, []);
    writeTable_(SHEETS.voters, []);
    writeTable_(SHEETS.codes, readTable_(SHEETS.codes).map(function (c) {
      return { code: c.code, used: 'false', createdAt: c.createdAt };
    }));
    const s = settings_();
    saveSettings_({ round: String(s.round + 1) });
    writeResultsSheet_();
  } finally {
    lock.releaseLock();
  }
  return apiAdminState_();
}

function apiEmailResults_() {
  const to = sendResultsEmail_();
  return { sentTo: to };
}

// ───────────────────────────── Ballot & votes ─────────────────────────────

function ballotPositions_(includeInactive) {
  const positions = readTable_(SHEETS.positions)
    .map(function (p) {
      return {
        id: String(p.id),
        name: String(p.name),
        order: Number(p.order) || 0,
        maxSelections: Math.max(1, parseInt(p.maxSelections, 10) || 1),
      };
    })
    .sort(function (a, b) { return a.order - b.order; });
  const nominees = readTable_(SHEETS.nominees)
    .map(function (n) {
      return {
        id: String(n.id),
        positionId: String(n.positionId),
        displayName: String(n.displayName),
        bio: String(n.bio || ''),
        photoUrl: String(n.photoUrl || ''),
        order: Number(n.order) || 0,
        active: n.active === '' ? true : toBool_(n.active),
      };
    })
    .filter(function (n) { return includeInactive || n.active; })
    .sort(function (a, b) { return a.order - b.order; });

  return positions
    .map(function (p) {
      return Object.assign({}, p, {
        nominees: nominees
          .filter(function (n) { return n.positionId === p.id; })
          .map(function (n) {
            const out = { id: n.id, displayName: n.displayName, bio: n.bio, photoUrl: n.photoUrl };
            if (includeInactive) out.active = n.active;
            return out;
          }),
      });
    })
    .filter(function (p) { return includeInactive || p.nominees.length; });
}

function validateChoices_(choices) {
  choices = choices || {};
  const positions = ballotPositions_(false);
  if (!positions.length) throw err_('NO_BALLOT', 'The ballot is empty.');
  const rows = [];
  positions.forEach(function (p) {
    let picked = choices[p.id];
    if (picked === undefined || picked === null || picked === '') {
      throw err_('INCOMPLETE', 'Please choose someone for ' + p.name + '.');
    }
    if (!Array.isArray(picked)) picked = [picked];
    picked = picked.map(String).filter(function (id, i, arr) { return arr.indexOf(id) === i; });
    if (!picked.length || picked.length > p.maxSelections) {
      throw err_('INVALID_CHOICE', 'Please choose up to ' + p.maxSelections + ' for ' + p.name + '.');
    }
    picked.forEach(function (id) {
      const n = p.nominees.filter(function (x) { return x.id === id; })[0];
      if (!n) {
        throw err_('INVALID_CHOICE', 'One of your choices for ' + p.name + ' is no longer on the ballot. Please check your choices again.');
      }
      rows.push([p.id, p.name, n.id, n.displayName]);
    });
  });
  return rows;
}

/**
 * Votes are kept sorted by a random ballot id rather than in arrival order, and carry no
 * timestamp, so the row order in "Votes" can't be matched up with the order in "Voters".
 */
function insertBallot_(ballotId, rows) {
  const sh = sheet_(SHEETS.votes);
  const width = HEADERS.Votes.length;
  const last = sh.getLastRow();
  let insertAt = last + 1;
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) > ballotId) { insertAt = i + 2; break; }
    }
  }
  if (insertAt <= last) {
    sh.insertRowsBefore(insertAt, rows.length);
  } else {
    ensureRows_(sh, last + rows.length);
  }
  const range = sh.getRange(insertAt, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setValues(rows.map(function (r) { return [ballotId].concat(r).map(cell_); }));
}

function computeResults_() {
  const positions = ballotPositions_(true);
  const votes = readTable_(SHEETS.votes);
  const ballots = {};
  votes.forEach(function (v) { ballots[v.ballotId] = true; });

  return {
    turnout: readTable_(SHEETS.voters).length,
    ballots: Object.keys(ballots).length,
    positions: positions.map(function (p) {
      const counts = {};
      const removedNames = {};
      const ballotsHere = {};
      let abstain = 0;
      votes.forEach(function (v) {
        if (String(v.positionId) !== p.id) return;
        ballotsHere[v.ballotId] = true;
        if (v.nomineeId === ABSTAIN) { abstain++; return; }
        counts[v.nomineeId] = (counts[v.nomineeId] || 0) + 1;
        removedNames[v.nomineeId] = String(v.nomineeName);
      });
      const rows = p.nominees.map(function (n) {
        return { id: n.id, name: n.displayName, votes: counts[n.id] || 0, active: n.active };
      });
      Object.keys(counts).forEach(function (id) {
        if (!p.nominees.some(function (n) { return n.id === id; })) {
          rows.push({ id: id, name: removedNames[id] + ' (removed)', votes: counts[id], active: false });
        }
      });
      rows.sort(function (a, b) { return b.votes - a.votes || a.name.localeCompare(b.name); });

      const k = p.maxSelections;
      const cutoff = rows.length >= k ? rows[k - 1].votes : (rows.length ? rows[rows.length - 1].votes : 0);
      const leaders = cutoff > 0
        ? rows.filter(function (r) { return r.votes >= cutoff; }).map(function (r) { return r.id; })
        : [];
      return {
        id: p.id,
        name: p.name,
        maxSelections: k,
        ballots: Object.keys(ballotsHere).length,
        abstain: abstain,
        candidates: rows,
        leaders: leaders,
        tie: leaders.length > k,
      };
    }),
  };
}

function writeResultsSheet_() {
  const sh = sheet_(SHEETS.results);
  const s = settings_(true);
  const r = computeResults_();
  const tz = Session.getScriptTimeZone() || 'Africa/Nairobi';
  const out = [
    [s.electionTitle + ' — Results', '', '', '', ''],
    ['Updated ' + Utilities.formatDate(new Date(), tz, 'd MMM yyyy, HH:mm'), 'Status: ' + s.status, 'People voted: ' + r.turnout, '', ''],
    ['', '', '', '', ''],
  ];
  r.positions.forEach(function (p) {
    out.push([p.name, 'Votes', '% of ballots', p.tie ? 'TIE' : '', '']);
    p.candidates.forEach(function (c) {
      const leading = p.leaders.indexOf(c.id) >= 0;
      out.push([
        c.name,
        c.votes,
        p.ballots ? Math.round((c.votes / p.ballots) * 1000) / 10 + '%' : '0%',
        leading ? (p.tie ? 'Tied' : (s.status === 'closed' ? 'Winner' : 'Leading')) : '',
        '',
      ]);
    });
    if (p.abstain) out.push(['Abstained', p.abstain, '', '', '']);
    out.push(['', '', '', '', '']);
  });
  sh.clear();
  ensureRows_(sh, out.length);
  sh.getRange(1, 1, out.length, 5).setValues(out.map(function (row) { return row.map(cell_); }));
  sh.getRange(1, 1, 1, 5).setFontWeight('bold').setFontSize(14);
}

// ───────────────────────────── Voters ─────────────────────────────

function identityKey_(mode, identity) {
  identity = identity || {};
  if (mode === 'namePhone') {
    const name = cleanText_(identity.name, 80);
    if (name.length < 2) throw err_('INVALID_NAME', 'Please enter your full name.');
    const phone = normalizePhone_(identity.phone);
    if (!phone) throw err_('INVALID_PHONE', 'Please enter a valid phone number, e.g. 0712 345 678.');
    return { key: hash_('phone:' + phone), name: name };
  }
  if (mode === 'code') {
    const code = normalizeCode_(identity.code);
    if (code.length < 6) throw err_('INVALID_CODE', 'Please enter your voter code.');
    return { key: hash_('code:' + code), code: code, name: '' };
  }
  const device = String(identity.deviceId || '').slice(0, 100);
  if (device.length < 8) throw err_('BAD_REQUEST', 'Missing device id.');
  return { key: hash_('device:' + device), name: cleanText_(identity.name, 80) };
}

/** Kenyan numbers in any common format (07…, 01…, +2547…, 2547…, 7…) become 2547…/2541…; other countries are kept as digits. */
function normalizePhone_(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('00') === 0) d = d.slice(2);
  if (d.length === 10 && d.charAt(0) === '0') d = '254' + d.slice(1);
  else if (d.length === 9 && /^[17]/.test(d)) d = '254' + d;
  if (d.indexOf('254') === 0) return /^254[17]\d{8}$/.test(d) ? d : '';
  return d.length >= 8 && d.length <= 15 ? d : '';
}

function normalizeCode_(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findCode_(normalized) {
  const c = readTable_(SHEETS.codes).filter(function (x) { return normalizeCode_(x.code) === normalized; })[0];
  return c ? { code: String(c.code), used: toBool_(c.used) } : null;
}

function markCodeUsed_(code) {
  writeTable_(SHEETS.codes, readTable_(SHEETS.codes).map(function (c) {
    return String(c.code) === code ? { code: c.code, used: 'true', createdAt: c.createdAt } : c;
  }));
}

function hash_(s) {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('VOTER_SALT');
  if (!salt) {
    salt = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('VOTER_SALT', salt);
  }
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// ───────────────────────────── Settings & closing ─────────────────────────────

/** Reads settings. Applies the closing time unless `noAutoClose` (used while already closing). */
function settings_(noAutoClose) {
  const raw = Object.assign({}, DEFAULT_SETTINGS);
  readTable_(SHEETS.settings).forEach(function (r) {
    if (r.key) raw[String(r.key)] = String(r.value);
  });
  const s = {
    electionTitle: raw.electionTitle || DEFAULT_SETTINGS.electionTitle,
    status: STATUSES.indexOf(raw.status) >= 0 ? raw.status : 'draft',
    closesAt: raw.closesAt || '',
    voterCheckMode: VOTER_CHECK_MODES.indexOf(raw.voterCheckMode) >= 0 ? raw.voterCheckMode : 'namePhone',
    resultsVisibleToVoters: toBool_(raw.resultsVisibleToVoters),
    round: parseInt(raw.round, 10) || 1,
    closedEmailRound: raw.closedEmailRound || '',
  };
  if (!noAutoClose && s.status === 'open' && s.closesAt && new Date(s.closesAt).getTime() <= Date.now()) {
    saveSettings_({ status: 'closed' });
    s.status = 'closed';
    onClosed_();
  }
  return s;
}

function saveSettings_(patch) {
  const current = Object.assign({}, DEFAULT_SETTINGS);
  readTable_(SHEETS.settings).forEach(function (r) {
    if (r.key) current[String(r.key)] = String(r.value);
  });
  Object.keys(patch).forEach(function (k) { current[k] = String(patch[k]); });
  writeTable_(SHEETS.settings, Object.keys(current).map(function (k) { return { key: k, value: current[k] }; }));
}

function onClosed_() {
  const s = settings_(true);
  if (s.closedEmailRound === String(s.round)) return; // already emailed for this round
  saveSettings_({ closedEmailRound: String(s.round) });
  try {
    writeResultsSheet_();
    sendResultsEmail_();
  } catch (e) {
    console.error('Could not send results email: ' + e);
  }
}

function sendResultsEmail_() {
  const s = settings_(true);
  const r = computeResults_();
  const to = Session.getEffectiveUser().getEmail();
  if (!to) throw err_('NO_EMAIL', 'Could not find an email address to send the results to.');
  const esc = function (t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };
  let html = '<div style="font-family:Arial,sans-serif;max-width:560px;color:#2a2233">'
    + '<h2 style="margin:0 0 4px">' + esc(s.electionTitle) + '</h2>'
    + '<p style="margin:0 0 16px;color:#6d6476">Status: <b>' + esc(s.status) + '</b> · ' + r.turnout + ' people voted</p>';
  r.positions.forEach(function (p) {
    html += '<h3 style="margin:20px 0 6px">' + esc(p.name)
      + (p.tie ? ' <span style="background:#fff4dc;color:#8a5a00;padding:2px 8px;border-radius:10px;font-size:12px">TIE</span>' : '')
      + '</h3><table style="border-collapse:collapse;width:100%">';
    p.candidates.forEach(function (c) {
      const lead = p.leaders.indexOf(c.id) >= 0;
      html += '<tr><td style="padding:4px 0;' + (lead ? 'font-weight:bold' : '') + '">' + (lead ? '★ ' : '') + esc(c.name)
        + '</td><td style="padding:4px 0;text-align:right">' + c.votes + '</td></tr>';
    });
    if (p.abstain) {
      html += '<tr><td style="padding:4px 0;color:#6d6476">Abstained</td><td style="padding:4px 0;text-align:right;color:#6d6476">'
        + p.abstain + '</td></tr>';
    }
    html += '</table>';
  });
  html += '<p style="margin-top:24px"><a href="' + esc(ss_().getUrl()) + '">Open the spreadsheet</a></p></div>';
  MailApp.sendEmail({ to: to, subject: 'Results: ' + s.electionTitle, htmlBody: html, name: 'Election app' });
  return to;
}

function publicElection_(s) {
  return {
    title: s.electionTitle,
    status: s.status,
    closesAt: s.closesAt,
    voterCheckMode: s.voterCheckMode,
    round: s.round,
    serverTime: new Date().toISOString(),
  };
}

function assertOpen_(s) {
  if (s.status === 'closed') throw err_('CLOSED', 'Voting has closed. Thank you!');
  if (s.status !== 'open') throw err_('NOT_OPEN', "Voting hasn't opened yet.");
}

function checkPasscode_(given) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSCODE');
  if (!expected) {
    throw err_('NOT_CONFIGURED', 'The admin passcode has not been set yet. See SETUP.md (Script Properties).');
  }
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('adminFails') || 0);
  if (fails >= 10) throw err_('LOCKED_OUT', 'Too many wrong passcodes. Please wait 15 minutes and try again.');
  if (String(given || '') !== expected) {
    cache.put('adminFails', String(fails + 1), 900);
    throw err_('BAD_PASSCODE', 'That passcode is not correct.');
  }
}

// ───────────────────────────── Sheet helpers ─────────────────────────────

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const headers = HEADERS[name];
    if (headers) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function readTable_(name) {
  const sh = sheet_(name);
  const headers = HEADERS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, headers.length).getValues()
    .filter(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); })
    .map(function (r) {
      const o = {};
      headers.forEach(function (h, i) { o[h] = r[i] instanceof Date ? r[i].toISOString() : String(r[i]); });
      return o;
    });
}

function writeTable_(name, rows) {
  const sh = sheet_(name);
  const headers = HEADERS[name];
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (!rows.length) return;
  ensureRows_(sh, rows.length + 1);
  const range = sh.getRange(2, 1, rows.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(rows.map(function (o) { return headers.map(function (h) { return cell_(o[h]); }); }));
}

function appendRows_(name, rows) {
  if (!rows.length) return;
  const sh = sheet_(name);
  const headers = HEADERS[name];
  const start = sh.getLastRow() + 1;
  ensureRows_(sh, start + rows.length - 1);
  const range = sh.getRange(start, 1, rows.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(rows.map(function (o) { return headers.map(function (h) { return cell_(o[h]); }); }));
}

function ensureRows_(sh, needed) {
  const max = sh.getMaxRows();
  if (needed > max) sh.insertRowsAfter(max, needed - max);
}

/** Text typed by voters must never become a spreadsheet formula. */
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function cleanText_(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanId_(v) {
  const id = String(v || '');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw err_('BAD_REQUEST', 'Invalid id.');
  return id;
}

function toBool_(v) {
  return v === true || String(v).toLowerCase() === 'true';
}

function err_(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
