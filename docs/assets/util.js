/* Small helpers shared by the voter page and the admin page. */
(function (root) {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
  };

  function uid(prefix) {
    const rand = (root.crypto && root.crypto.getRandomValues)
      ? Array.from(root.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, '0')).join('')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return (prefix || '') + rand.slice(0, 14);
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || '');
    return (first + last).toUpperCase();
  }

  function hue(name) {
    const hues = [262, 330, 18, 38, 152, 190, 214, 290];
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return hues[h % hues.length];
  }

  /** Google Drive "share" links don't display as images; turn them into a direct image link. */
  function photoSrc(url) {
    const u = String(url || '').trim();
    if (!/^https:\/\//i.test(u)) return '';
    const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/);
    return m ? 'https://lh3.googleusercontent.com/d/' + m[1] : u;
  }

  function avatar(name, photoUrl, size) {
    const cls = 'avatar' + (size ? ' avatar-' + size : '');
    const src = photoSrc(photoUrl);
    const img = src
      ? `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
      : '';
    return `<span class="${cls}" style="--h:${hue(name)}" aria-hidden="true">${img || esc(initials(name))}</span>`;
  }

  /** Mirrors normalizePhone_ in Code.gs, so voters get instant feedback. */
  function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (d.length === 10 && d[0] === '0') d = '254' + d.slice(1);
    else if (d.length === 9 && /^[17]/.test(d)) d = '254' + d;
    if (d.indexOf('254') === 0) return /^254[17]\d{8}$/.test(d) ? d : '';
    return d.length >= 8 && d.length <= 15 ? d : '';
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function formatCountdown(ms) {
    if (ms <= 0) return null;
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, '0')}s`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }

  function timeAgo(iso) {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    return formatDateTime(iso);
  }

  function toast(message, type, ms) {
    let box = $('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast-' + type : '');
    t.textContent = message;
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), ms || 3200);
  }

  const reducedMotion = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function confetti() {
    if (reducedMotion()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const W = (canvas.width = innerWidth * dpr);
    const H = (canvas.height = innerHeight * dpr);
    const colors = ['#5a3fc0', '#e9a23b', '#e5527a', '#2bb3a3', '#7d9cff', '#f5d04c'];
    const pieces = Array.from({ length: 130 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 16 * dpr,
      vy: (-Math.random() * 14 - 6) * dpr,
      size: (Math.random() * 6 + 5) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
    }));
    const start = performance.now();
    (function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      pieces.forEach((p) => {
        p.vy += 0.42 * dpr;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t / 2800);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      });
      if (t < 2800) requestAnimationFrame(frame);
      else canvas.remove();
    })(start);
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }

  function downloadFile(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /** Native <dialog> confirm. Resolves true/false. */
  function confirmDialog({ title, body, confirmText, danger, cancelText }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.innerHTML = `
        <form method="dialog">
          <div class="dialog-body"><h2>${esc(title)}</h2><div class="muted">${body || ''}</div></div>
          <div class="dialog-actions">
            <button class="btn" value="cancel">${esc(cancelText || 'Cancel')}</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok">${esc(confirmText || 'OK')}</button>
          </div>
        </form>`;
      document.body.appendChild(d);
      d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
      d.showModal();
      $('.btn-primary, .btn-danger', d).focus();
    });
  }

  const ICONS = {
    ballot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M8 13V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v9"/><path d="m10 8 1.5 1.5L14.5 6.5"/><path d="M2 13h20"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7.5"/></svg>',
    arrowRight: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    arrowLeft: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    alert: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
    wifiOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.1-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5M12 20h.01"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    trophy: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
  };

  root.U = {
    $, $$, esc, store, uid, initials, hue, avatar, photoSrc, normalizePhone,
    formatDateTime, formatCountdown, timeAgo, toast, confetti, reducedMotion,
    csvCell, downloadFile, copyText, confirmDialog, ICONS,
  };
})(window);
