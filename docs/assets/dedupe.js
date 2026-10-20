/**
 * Groups the free-text names typed into the nomination form.
 *
 *  - Same name typed differently (case, spaces)     → one group automatically
 *  - Spelling variants ("Millicent" / "Milicent")   → merged as a suggestion
 *  - Short form of one longer name ("Jeff" →
 *    "Jeff Kimani" → "Jeff Kinyanjui Kimani")        → merged as a suggestion
 *  - Short form that fits several people ("Ivy" with
 *    both "Ivy Wangari" and "Ivy Maina")              → flagged, never merged
 *
 * Everything is a suggestion; the admin confirms each group in the import wizard.
 */
(function (root) {
  'use strict';

  const JUNK = new Set(['', 'na', 'n a', 'none', 'nil', 'no one', 'nobody', 'nothing', 'no']);

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function tokens(s) {
    return clean(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z\s'-]/g, ' ')
      .split(/[\s-]+/)
      .map((t) => t.replace(/^'+|'+$/g, ''))
      .filter(Boolean);
  }

  /** "mary WACHERA" → "Mary Wachera", but leaves deliberate capitals ("McDonald") alone. */
  function displayName(raw) {
    const c = clean(raw);
    const mixed = c !== c.toLowerCase() && c !== c.toUpperCase();
    const words = c.split(' ').map((w) => {
      if (mixed && w !== w.toLowerCase() && w !== w.toUpperCase()) return w;
      return w.toLowerCase().replace(/(^|['-])(\p{L})/gu, (m, p, ch) => p + ch.toUpperCase());
    });
    return words.join(' ');
  }

  function lev(a, b) {
    if (a === b) return 0;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  function tokenEq(a, b) {
    if (a === b) return true;
    const n = Math.min(a.length, b.length);
    const d = lev(a, b);
    return (n >= 5 && d <= 1) || (n >= 8 && d <= 2);
  }

  function sameSpelling(A, B) {
    return A.length === B.length && A.every((t, i) => tokenEq(t, B[i]));
  }

  /** Every token of A appears (fuzzily) in B, and B is longer. */
  function isSubset(A, B) {
    if (A.length >= B.length) return false;
    const used = new Set();
    return A.every((t) => {
      const i = B.findIndex((u, j) => !used.has(j) && tokenEq(t, u));
      if (i < 0) return false;
      used.add(i);
      return true;
    });
  }

  /** Like isSubset, but a token may also be the start of a longer one ("Sam" → "Samuel"). */
  function isLooseSubset(A, B) {
    if (A.length > B.length || sameSpelling(A, B)) return false;
    const used = new Set();
    return A.every((t) => {
      const i = B.findIndex((u, j) => !used.has(j) &&
        (tokenEq(t, u) || (t.length >= 3 && u.length > t.length && u.indexOf(t) === 0)));
      if (i < 0) return false;
      used.add(i);
      return true;
    });
  }

  function related(A, B) {
    return sameSpelling(A, B) || isSubset(A, B) || isSubset(B, A);
  }

  /**
   * @param {string[]} names       raw names typed for one position
   * @param {{name:string, position:string}[]} otherNames  names typed anywhere on the form (for hints)
   * @returns {{id, name, count, variants:{text,count}[], ambiguous:null|{options:string[]}, hints:{name,position}[]}[]}
   */
  function groupNames(names, otherNames) {
    // 1. Exact matches (ignoring case, accents, punctuation and spacing).
    const byKey = new Map();
    names.forEach((raw) => {
      const t = tokens(raw);
      const key = t.join(' ');
      if (JUNK.has(key)) return;
      if (!byKey.has(key)) byKey.set(key, { key, tokens: t, count: 0, variants: new Map() });
      const c = byKey.get(key);
      const text = clean(raw);
      c.count++;
      c.variants.set(text, (c.variants.get(text) || 0) + 1);
    });
    const clusters = Array.from(byKey.values());

    // 2. Union-find over clusters.
    const parent = clusters.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b) => { parent[find(a)] = find(b); };

    clusters.forEach((a, i) => clusters.forEach((b, j) => {
      if (j > i && sameSpelling(a.tokens, b.tokens)) union(i, j);
    }));

    // 3. Shorter names attach to longer ones, longest first so chains collapse.
    const ambiguous = new Map(); // cluster index → option cluster indexes
    const order = clusters.map((_, i) => i).sort((x, y) => clusters[y].tokens.length - clusters[x].tokens.length);
    order.forEach((i) => {
      const A = clusters[i].tokens;
      const strong = [];
      const weak = [];
      clusters.forEach((b, j) => {
        if (j === i || find(j) === find(i)) return;
        if (isSubset(A, b.tokens)) (tokenEq(A[0], b.tokens[0]) ? strong : weak).push(j);
        else if (isLooseSubset(A, b.tokens)) weak.push(j);
      });
      if (strong.length) {
        const roots = Array.from(new Set(strong.map(find)));
        const reps = roots.map((r) => longestIn(r));
        const chain = reps.every((p, x) => reps.every((q, y) => x === y || related(clusters[p].tokens, clusters[q].tokens)));
        if (chain) {
          strong.forEach((j) => union(i, j));
        } else {
          ambiguous.set(i, reps);
        }
      } else if (weak.length) {
        // e.g. a surname on its own ("Wachera" → "Mary Wachera") or a short form ("Sam" → "Samuel …"): possible, but ask.
        ambiguous.set(i, Array.from(new Set(weak.map(find))).map((r) => longestIn(r)));
      }
    });

    function longestIn(root) {
      let best = -1;
      clusters.forEach((c, j) => {
        if (find(j) !== root) return;
        if (best < 0 || c.tokens.length > clusters[best].tokens.length ||
          (c.tokens.length === clusters[best].tokens.length && c.count > clusters[best].count)) best = j;
      });
      return best;
    }

    // 4. Build the groups.
    const groupsByRoot = new Map();
    clusters.forEach((c, i) => {
      const r = find(i);
      if (!groupsByRoot.has(r)) groupsByRoot.set(r, []);
      groupsByRoot.get(r).push(i);
    });

    const groups = [];
    groupsByRoot.forEach((members) => {
      const best = members.reduce((b, j) => {
        const c = clusters[j];
        const bc = clusters[b];
        if (c.tokens.length !== bc.tokens.length) return c.tokens.length > bc.tokens.length ? j : b;
        return c.count > bc.count ? j : b;
      }, members[0]);
      const bestVariant = Array.from(clusters[best].variants.entries()).sort((a, b) => b[1] - a[1])[0][0];
      const variants = [];
      members.forEach((j) => clusters[j].variants.forEach((count, text) => variants.push({ text, count })));
      variants.sort((a, b) => b.count - a.count || b.text.length - a.text.length);

      const amb = members.map((j) => ambiguous.get(j)).filter(Boolean)[0];
      groups.push({
        name: displayName(bestVariant),
        tokens: clusters[best].tokens,
        count: members.reduce((n, j) => n + clusters[j].count, 0),
        variants,
        ambiguousOptions: amb ? amb.map((j) => displayName(Array.from(clusters[j].variants.keys())[0])) : null,
      });
    });

    groups.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return groups.map((g, i) => ({
      id: 'g' + i,
      name: g.name,
      count: g.count,
      variants: g.variants,
      ambiguous: g.ambiguousOptions ? { options: g.ambiguousOptions } : null,
      hints: g.tokens.length === 1 && !g.ambiguousOptions ? hintsFor(g, otherNames || []) : [],
    }));
  }

  /** For a first-name-only group, fuller names typed elsewhere on the form that might be the same person. */
  function hintsFor(group, otherNames) {
    const t = group.tokens[0];
    const own = new Set(group.variants.map((v) => tokens(v.text).join(' ')));
    const seen = new Set();
    const out = [];
    otherNames.forEach(({ name, position }) => {
      const T = tokens(name);
      const key = T.join(' ');
      if (T.length < 2 || own.has(key) || seen.has(key)) return;
      const match = T.some((u) => tokenEq(t, u) || (t.length >= 3 && u.length > t.length && u.indexOf(t) === 0));
      if (!match) return;
      seen.add(key);
      out.push({ name: displayName(name), position });
    });
    return out.slice(0, 5);
  }

  const api = { groupNames, tokens, displayName, lev, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Dedupe = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
