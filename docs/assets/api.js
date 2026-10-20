/*
 * Talks to the Google Apps Script backend.
 *
 * Mock mode (?mock in the URL, or automatically on localhost when config.js has no URL)
 * runs the real apps-script/Code.gs in the browser against a fake spreadsheet kept in
 * localStorage, so the whole app can be tried without a Google account.
 */
(function (root) {
  'use strict';

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const cfg = root.ELECTION_CONFIG || {};
  const apiUrl = String(cfg.apiUrl || '').trim();
  const params = new URLSearchParams(location.search);
  const isLocal = ['localhost', '127.0.0.1', ''].indexOf(location.hostname) >= 0;
  const isMock = params.has('mock') || (!apiUrl && isLocal);
  const MOCK_KEY = 'ccv:mock-store';

  let mockBackend = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function getMock() {
    if (mockBackend) return mockBackend;
    const base = new URL('../', location.href);
    await loadScript(new URL('dev/fake-gas.js', base).href);
    await loadScript(new URL('dev/sample-data.js', base).href);
    const code = await (await fetch(new URL('apps-script/Code.gs', base).href)).text();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(MOCK_KEY)); } catch (e) { saved = null; }
    const gas = root.FakeGas.create(saved || root.FakeGas.storeWithResponses(root.SAMPLE_RESPONSES, { ADMIN_PASSCODE: 'admin' }));
    const backend = root.FakeGas.loadBackend(code, gas);
    if (!saved) backend.setup();
    // Other tabs (voter ↔ admin) may change the store; reload it before each call.
    mockBackend = async (body) => {
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 350));
      try {
        const fresh = JSON.parse(localStorage.getItem(MOCK_KEY));
        if (fresh) Object.assign(gas.store, fresh);
      } catch (e) { /* ignore */ }
      const out = backend.doPost({ postData: { contents: JSON.stringify(body) } });
      try { localStorage.setItem(MOCK_KEY, JSON.stringify(gas.store)); } catch (e) { /* ignore */ }
      return JSON.parse(out.getContent());
    };
    return mockBackend;
  }

  async function call(action, payload, opts) {
    const body = Object.assign({ action }, payload || {});
    const timeoutMs = (opts && opts.timeoutMs) || 30000;
    let data;

    if (isMock) {
      data = await (await getMock())(body);
    } else {
      if (!apiUrl) throw new ApiError('NOT_CONFIGURED', 'This voting page has not been connected to its spreadsheet yet.');
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      let res;
      try {
        // text/plain avoids a CORS preflight, which Apps Script can't answer.
        res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          redirect: 'follow',
          signal: ctrl ? ctrl.signal : undefined,
        });
      } catch (e) {
        throw new ApiError('NETWORK', navigator.onLine === false
          ? "You seem to be offline. Check your internet connection and try again."
          : "We couldn't reach the voting server. Check your connection and try again.");
      } finally {
        if (timer) clearTimeout(timer);
      }
      try {
        data = await res.json();
      } catch (e) {
        throw new ApiError('NETWORK', 'The voting server sent an unexpected reply. Please try again in a moment.');
      }
    }

    if (!data || !data.ok) {
      throw new ApiError((data && data.error) || 'SERVER_ERROR', (data && data.message) || 'Something went wrong. Please try again.');
    }
    return data;
  }

  function resetMock() {
    try { localStorage.removeItem(MOCK_KEY); } catch (e) { /* ignore */ }
    mockBackend = null;
  }

  root.Api = { call, isMock, resetMock, ApiError };
})(window);
