// Runs the real apps-script/Code.gs against the fake Apps Script services.
// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FakeGas = require('../dev/fake-gas.js');
const { SAMPLE_RESPONSES } = require('../dev/sample-data.js');

const CODE = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const PASS = 'test-pass';

function boot() {
  const gas = FakeGas.create(FakeGas.storeWithResponses(SAMPLE_RESPONSES, { ADMIN_PASSCODE: PASS }));
  const backend = FakeGas.loadBackend(CODE, gas);
  backend.setup();
  const call = (body) => JSON.parse(backend.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const admin = (action, body) => call(Object.assign({ action: 'admin.' + action, passcode: PASS }, body || {}));
  return { gas, backend, call, admin };
}

function seedBallot(admin) {
  const res = admin('saveBallot', {
    positions: [
      { id: 'chair', name: 'Chairperson' },
      { id: 'sec', name: 'Secretary' },
      { id: 'team', name: 'Media team', maxSelections: 2 },
    ],
    nominees: [
      { id: 'n1', positionId: 'chair', displayName: 'Peter Mwangi' },
      { id: 'n2', positionId: 'chair', displayName: 'Grace Njeri' },
      { id: 'n3', positionId: 'sec', displayName: 'Faith Wairimu' },
      { id: 'n4', positionId: 'sec', displayName: 'Hidden Person', active: false },
      { id: 'n5', positionId: 'team', displayName: 'Tom' },
      { id: 'n6', positionId: 'team', displayName: 'Lucy' },
      { id: 'n7', positionId: 'team', displayName: 'Rose' },
    ],
  });
  assert.equal(res.ok, true, res.message);
  return res;
}

test('setup creates the tabs and a salt, and leaves the responses alone', () => {
  const { gas } = boot();
  for (const name of ['Positions', 'Nominees', 'Settings', 'Voters', 'Votes', 'Codes', 'Results']) {
    assert.ok(gas.store.sheets[name], name + ' tab missing');
  }
  assert.ok(gas.store.props.VOTER_SALT.length > 30);
  assert.deepEqual(gas.store.sheets['Form responses 1'].data, SAMPLE_RESPONSES);
  assert.equal(gas.store.triggers.length, 1);
});

test('admin endpoints need the passcode, and repeated failures lock out', () => {
  const { call } = boot();
  assert.equal(call({ action: 'admin.state' }).error, 'BAD_PASSCODE');
  assert.equal(call({ action: 'admin.state', passcode: PASS }).ok, true);
  for (let i = 0; i < 9; i++) call({ action: 'admin.state', passcode: 'nope' });
  assert.equal(call({ action: 'admin.state', passcode: PASS }).error, 'LOCKED_OUT');
});

test('nominations are read from the form tab', () => {
  const { admin } = boot();
  const n = admin('nominations');
  assert.equal(n.responseCount, 12);
  assert.deepEqual(n.positions.map((p) => p.positionName), ['Chairperson', 'Vice Chairperson', 'Secretary', 'Vice Secretary', 'Treasurer']);
  assert.equal(n.positions[0].names.length, 12);
  assert.equal(n.comments.length, 4);
});

test('ballot is hidden until open; inactive nominees and empty positions are left out', () => {
  const { call, admin } = boot();
  seedBallot(admin);
  let b = call({ action: 'ballot' });
  assert.equal(b.election.status, 'draft');
  assert.equal(b.positions, undefined);
  assert.equal(call({ action: 'vote', identity: {}, choices: {} }).error, 'NOT_OPEN');

  assert.equal(admin('setStatus', { status: 'open' }).ok, true);
  b = call({ action: 'ballot' });
  assert.equal(b.election.status, 'open');
  assert.deepEqual(b.positions.map((p) => p.id), ['chair', 'sec', 'team']);
  assert.deepEqual(b.positions[1].nominees.map((n) => n.id), ['n3']);
});

test('name + phone: one vote per phone number in any format, with secret ballots', () => {
  const { gas, call, admin } = boot();
  seedBallot(admin);
  admin('setStatus', { status: 'open' });
  const choices = { chair: 'n1', sec: 'n3', team: ['n5', 'n6'] };

  assert.equal(call({ action: 'vote', identity: { name: 'A', phone: '0712345678' }, choices }).error, 'INVALID_NAME');
  assert.equal(call({ action: 'vote', identity: { name: 'Alice W', phone: '12345' }, choices }).error, 'INVALID_PHONE');

  assert.equal(call({ action: 'checkVoter', identity: { name: 'Alice W', phone: '0712 345 678' } }).voted, false);
  const r = call({ action: 'vote', identity: { name: 'Alice W', phone: '0712 345 678' }, choices, submissionId: 'sub-1' });
  assert.equal(r.ok, true, r.message);

  for (const phone of ['+254712345678', '254 712 345 678', '712345678', '00254712345678']) {
    assert.equal(call({ action: 'checkVoter', identity: { name: 'Alice W', phone } }).voted, true, phone);
    assert.equal(call({ action: 'vote', identity: { name: 'Someone', phone }, choices }).error, 'ALREADY_VOTED', phone);
  }
  // A retry of the same submission (lost response) succeeds quietly.
  const retry = call({ action: 'vote', identity: { name: 'Alice W', phone: '0712345678' }, choices, submissionId: 'sub-1' });
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);

  call({ action: 'vote', identity: { name: 'Bob K', phone: '0722000111' }, choices: { chair: 'n2', sec: 'n3', team: 'n6' } });

  const voters = gas.store.sheets.Voters.data;
  assert.equal(voters.length, 3); // header + 2
  assert.ok(!JSON.stringify(voters).includes('712345678'), 'raw phone number must not be stored');
  const votes = gas.store.sheets.Votes.data;
  assert.deepEqual(votes[0], ['ballotId', 'positionId', 'positionName', 'nomineeId', 'nomineeName']);
  assert.ok(!JSON.stringify(votes).includes('Alice'), 'votes must not contain voter identity');
  const ids = votes.slice(1).map((r) => r[0]);
  assert.deepEqual(ids, ids.slice().sort(), 'votes are ordered by random ballot id');

  const res = admin('results');
  assert.equal(res.turnout, 2);
  const [chair, sec, team] = res.positions;
  assert.equal(chair.tie, true);
  assert.deepEqual(chair.leaders.sort(), ['n1', 'n2']);
  assert.equal(sec.abstain, 0);
  assert.equal(sec.candidates.find((c) => c.id === 'n3').votes, 2);
  assert.deepEqual(sec.leaders, ['n3']);
  assert.equal(team.candidates.find((c) => c.id === 'n6').votes, 2);
  assert.deepEqual(res.voters.map((v) => v.name), ['Alice W', 'Bob K']);

  const sheetText = JSON.stringify(gas.store.sheets.Results.data);
  assert.ok(sheetText.includes('People voted: 2'));
});

test('ballot validation rejects bad or incomplete choices', () => {
  const { call, admin } = boot();
  seedBallot(admin);
  admin('setStatus', { status: 'open' });
  const id = { name: 'Carol N', phone: '0733000222' };
  assert.equal(call({ action: 'vote', identity: id, choices: { chair: 'n1', sec: 'n3' } }).error, 'INCOMPLETE');
  assert.equal(call({ action: 'vote', identity: id, choices: { chair: 'n3', sec: 'n3', team: 'n5' } }).error, 'INVALID_CHOICE');
  assert.equal(call({ action: 'vote', identity: id, choices: { chair: 'n1', sec: 'n4', team: 'n5' } }).error, 'INVALID_CHOICE');
  assert.equal(call({ action: 'vote', identity: id, choices: { chair: 'n1', sec: 'n3', team: ['n5', 'n6', 'n7'] } }).error, 'INVALID_CHOICE');
  assert.equal(call({ action: 'vote', identity: id, choices: { chair: ['n1', 'ABSTAIN'], sec: 'n3', team: 'n5' } }).error, 'INVALID_CHOICE');
  assert.equal(call({ action: 'vote', identity: id, choices: { chair: 'ABSTAIN', sec: 'n3', team: 'n5' } }).error, 'INVALID_CHOICE', 'skipping is not allowed');
  assert.equal(admin('results').turnout, 0);
});

test('voter codes work once each', () => {
  const { call, admin } = boot();
  seedBallot(admin);
  admin('saveSettings', { settings: { voterCheckMode: 'code' } });
  admin('setStatus', { status: 'open' });
  const { codes } = admin('generateCodes', { count: 3 });
  assert.equal(codes.length, 3);
  assert.match(codes[0].code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const choices = { chair: 'n1', sec: 'n3', team: 'n5' };

  assert.equal(call({ action: 'checkVoter', identity: { code: 'ZZZZ-ZZZZ' } }).error, 'INVALID_CODE');
  const typed = codes[0].code.toLowerCase().replace('-', ' ');
  assert.equal(call({ action: 'checkVoter', identity: { code: typed } }).voted, false);
  assert.equal(call({ action: 'vote', identity: { code: typed }, choices }).ok, true);
  assert.equal(call({ action: 'vote', identity: { code: codes[0].code }, choices }).error, 'ALREADY_VOTED');
  assert.equal(admin('codes').codes.filter((c) => c.used).length, 1);
});

test('ballot and voter-mode changes need confirmation once votes exist', () => {
  const { call, admin } = boot();
  const state = seedBallot(admin);
  admin('setStatus', { status: 'open' });
  call({ action: 'vote', identity: { name: 'Dee M', phone: '0744000333' }, choices: { chair: 'n1', sec: 'n3', team: 'n5' } });

  const positions = state.positions.map((p) => ({ id: p.id, name: p.name, maxSelections: p.maxSelections }));
  const nominees = state.positions.flatMap((p) => p.nominees.map((n) => Object.assign({ positionId: p.id }, n)))
    .filter((n) => n.id !== 'n1');
  assert.equal(admin('saveBallot', { positions, nominees }).error, 'VOTES_EXIST');
  assert.equal(admin('saveBallot', { positions, nominees, force: true }).ok, true);
  const chair = admin('results').positions[0];
  assert.ok(chair.candidates.some((c) => c.name === 'Peter Mwangi (removed)' && c.votes === 1));

  assert.equal(admin('saveSettings', { settings: { voterCheckMode: 'open' } }).error, 'VOTES_EXIST');
});

test('closing sends one results email; reset clears votes and starts a new round', () => {
  const { gas, call, admin } = boot();
  seedBallot(admin);
  admin('setStatus', { status: 'open' });
  call({ action: 'vote', identity: { name: 'Eve O', phone: '0755000444' }, choices: { chair: 'n2', sec: 'n3', team: 'n7' } });
  admin('setStatus', { status: 'closed' });
  admin('setStatus', { status: 'closed' });
  assert.equal(gas.store.mail.length, 1);
  assert.match(gas.store.mail[0].htmlBody, /Grace Njeri/);
  assert.equal(call({ action: 'vote', identity: { name: 'Fay', phone: '0766000555' }, choices: {} }).error, 'CLOSED');

  let b = call({ action: 'ballot' });
  assert.equal(b.results, undefined);
  admin('saveSettings', { settings: { resultsVisibleToVoters: true } });
  b = call({ action: 'ballot' });
  assert.equal(b.results.turnout, 1);

  const before = admin('state').settings.round;
  assert.equal(admin('resetVotes', { confirm: 'nope' }).error, 'BAD_REQUEST');
  const after = admin('resetVotes', { confirm: 'RESET' });
  assert.equal(after.stats.voters, 0);
  assert.equal(after.settings.round, before + 1);
});

test('a closing time in the past closes voting automatically', () => {
  const { gas, call, admin } = boot();
  seedBallot(admin);
  admin('saveSettings', { settings: { closesAt: new Date(Date.now() + 60000).toISOString() } });
  admin('setStatus', { status: 'open' });
  assert.equal(call({ action: 'ballot' }).election.status, 'open');
  // Pretend the time passed by editing the stored value directly.
  const rows = gas.store.sheets.Settings.data;
  rows.find((r) => r[0] === 'closesAt')[1] = new Date(Date.now() - 1000).toISOString();
  assert.equal(call({ action: 'ballot' }).election.status, 'closed');
  assert.equal(gas.store.mail.length, 1);
});

test('text typed by voters cannot become a formula', () => {
  const { gas, call, admin } = boot();
  seedBallot(admin);
  admin('setStatus', { status: 'open' });
  const r = call({ action: 'vote', identity: { name: '=IMPORTXML("http://x")', phone: '0777000666' }, choices: { chair: 'n1', sec: 'n3', team: 'n5' } });
  assert.equal(r.ok, true);
  // The fake strips the leading apostrophe exactly like Sheets does, so the stored value is plain text.
  assert.equal(gas.store.sheets.Voters.data[1][1], '=IMPORTXML("http://x")');
});

test('GET without an action is a health check', () => {
  const { backend } = boot();
  const out = JSON.parse(backend.doGet({ parameter: {} }).getContent());
  assert.equal(out.ok, true);
  assert.equal(out.service, 'election-api');
});
