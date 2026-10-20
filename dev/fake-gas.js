/**
 * A small in-memory imitation of the Google Apps Script services that Code.gs uses.
 * It lets the real backend run in Node (tests) and in the browser (?mock mode)
 * without a Google account. Not used in production.
 */
(function (root) {
  'use strict';

  // ── SHA-256 (synchronous, so it can stand in for Utilities.computeDigest) ──
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  function sha256(str) {
    const bytes = Array.from(new TextEncoder().encode(str));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const out = [];
    h.forEach((x) => out.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff));
    return out.map((b) => (b > 127 ? b - 256 : b)); // Apps Script returns signed bytes
  }

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function create(store) {
    store = store || {};
    store.sheets = store.sheets || {};
    store.sheetOrder = store.sheetOrder || Object.keys(store.sheets);
    store.props = store.props || {};
    store.mail = store.mail || [];
    store.triggers = store.triggers || [];
    const cache = {};

    function makeSheet(name) {
      const s = store.sheets[name];
      function lastRow() {
        for (let r = s.data.length - 1; r >= 0; r--) {
          if ((s.data[r] || []).some((c) => c !== '' && c !== null && c !== undefined)) return r + 1;
        }
        return 0;
      }
      function lastCol() {
        let m = 0;
        s.data.forEach((row) => (row || []).forEach((c, i) => { if (c !== '' && c != null) m = Math.max(m, i + 1); }));
        return m;
      }
      function range(row, col, numRows, numCols) {
        numRows = numRows || 1;
        numCols = numCols || 1;
        if (row < 1 || col < 1 || row + numRows - 1 > s.maxRows || col + numCols - 1 > s.maxCols) {
          throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
        }
        const r = {
          getValues() {
            const out = [];
            for (let i = 0; i < numRows; i++) {
              const src = s.data[row - 1 + i] || [];
              const line = [];
              for (let j = 0; j < numCols; j++) {
                const v = src[col - 1 + j];
                line.push(v === undefined || v === null ? '' : v);
              }
              out.push(line);
            }
            return out;
          },
          setValues(values) {
            if (values.length !== numRows || values.some((v) => v.length !== numCols)) {
              throw new Error('The number of rows or columns in the data does not match the range.');
            }
            for (let i = 0; i < numRows; i++) {
              const idx = row - 1 + i;
              while (s.data.length <= idx) s.data.push([]);
              for (let j = 0; j < numCols; j++) {
                let v = values[i][j];
                if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1); // text prefix
                else if (typeof v === 'string' && v.charAt(0) === '=') v = '#FORMULA ' + v; // Sheets would evaluate it
                s.data[idx][col - 1 + j] = v;
              }
            }
            return r;
          },
          clearContent() {
            for (let i = 0; i < numRows; i++) {
              const line = s.data[row - 1 + i];
              if (!line) continue;
              for (let j = 0; j < numCols; j++) line[col - 1 + j] = '';
            }
            return r;
          },
        };
        ['setNumberFormat', 'setFontWeight', 'setFontSize', 'setBackground', 'setFontColor', 'setWrap'].forEach((m) => {
          r[m] = () => r;
        });
        return r;
      }
      return {
        getName: () => name,
        getLastRow: lastRow,
        getLastColumn: lastCol,
        getMaxRows: () => s.maxRows,
        getMaxColumns: () => s.maxCols,
        getRange: range,
        getDataRange: () => range(1, 1, Math.max(lastRow(), 1), Math.max(lastCol(), 1)),
        insertRowsBefore(before, n) {
          const blanks = Array.from({ length: n }, () => []);
          while (s.data.length < before - 1) s.data.push([]);
          s.data.splice(before - 1, 0, ...blanks);
          s.maxRows += n;
        },
        insertRowsAfter(after, n) {
          if (s.data.length > after) s.data.splice(after, 0, ...Array.from({ length: n }, () => []));
          s.maxRows += n;
        },
        clear() { s.data = []; },
        setFrozenRows() {},
        autoResizeColumns() {},
      };
    }

    function ensure(name, data) {
      if (!store.sheets[name]) {
        store.sheets[name] = { data: data || [], maxRows: 1000, maxCols: 26 };
        store.sheetOrder.push(name);
      }
      return makeSheet(name);
    }

    const spreadsheet = {
      getSheetByName: (name) => (store.sheets[name] ? makeSheet(name) : null),
      insertSheet: (name) => ensure(name),
      getSheets: () => store.sheetOrder.map(makeSheet),
      getUrl: () => 'https://docs.google.com/spreadsheets/d/mock-spreadsheet/edit',
      getId: () => 'mock-spreadsheet',
      getName: () => 'Mock spreadsheet',
    };

    const globals = {
      SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
      LockService: {
        getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }),
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (k) => (k in store.props ? store.props[k] : null),
          setProperty(k, v) { store.props[k] = String(v); return this; },
          getProperties: () => Object.assign({}, store.props),
        }),
      },
      CacheService: {
        getScriptCache: () => ({
          get: (k) => (k in cache ? cache[k] : null),
          put: (k, v) => { cache[k] = String(v); },
          remove: (k) => { delete cache[k]; },
        }),
      },
      Utilities: {
        DigestAlgorithm: { SHA_256: 'SHA_256' },
        Charset: { UTF_8: 'UTF_8' },
        computeDigest: (alg, str) => sha256(String(str)),
        getUuid: uuid,
        formatDate: (date, tz) => new Date(date).toLocaleString('en-GB', { timeZone: tz }),
      },
      ContentService: {
        MimeType: { JSON: 'JSON' },
        createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
      },
      MailApp: {
        sendEmail: (msg) => { store.mail.push(Object.assign({ at: new Date().toISOString() }, msg)); },
      },
      Session: {
        getEffectiveUser: () => ({ getEmail: () => 'you@example.com' }),
        getScriptTimeZone: () => 'Africa/Nairobi',
      },
      ScriptApp: {
        getProjectTriggers: () => store.triggers.map((t) => ({ getHandlerFunction: () => t.handler, _t: t })),
        deleteTrigger: (t) => { store.triggers = store.triggers.filter((x) => x !== t._t); },
        newTrigger: (handler) => {
          const t = { handler };
          const b = {
            timeBased: () => b,
            everyMinutes: (n) => { t.everyMinutes = n; return b; },
            create: () => { store.triggers.push(t); },
          };
          return b;
        },
      },
      Logger: { log: () => {} },
      console: { log() {}, error: (...a) => (root.console || console).error(...a) },
    };

    return { globals, store, ensureSheet: ensure };
  }

  /** Evaluates Code.gs with the fake services and returns its entry points. */
  function loadBackend(code, gas) {
    const names = Object.keys(gas.globals);
    const factory = new Function(...names, code + '\n;return { doGet, doPost, setup, autoCloseCheck };');
    return factory(...names.map((n) => gas.globals[n]));
  }

  /** Builds a store containing a "Form responses 1" tab. */
  function storeWithResponses(rows, props) {
    return {
      sheets: { 'Form responses 1': { data: rows.map((r) => r.slice()), maxRows: 1000, maxCols: 26 } },
      sheetOrder: ['Form responses 1'],
      props: Object.assign({}, props || {}),
    };
  }

  const api = { create, loadBackend, storeWithResponses, sha256 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FakeGas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
