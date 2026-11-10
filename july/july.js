// The sealed July list. Two halves open it: the part of the link after the #,
// and a number code typed once. Neither is sent to any server. After the first
// opening this browser keeps the key and does not ask again.
// Marks made here stay on this phone only.

const app = document.querySelector('#app');
const MARKS = '10xbnb-july-called';
const state = { rows: [], made: '', query: '', filter: 'ALL', open: -1, marks: loadMarks() };

function loadMarks() {
  try { return JSON.parse(localStorage.getItem(MARKS) || '{}') || {}; } catch { return {}; }
}

function saveMarks() {
  try { localStorage.setItem(MARKS, JSON.stringify(state.marks)); } catch { /* private window */ }
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeHttp(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* not a link */ }
  return '';
}

function link(text, href) {
  const a = el('a', '', text);
  a.href = href;
  if (href.startsWith('http')) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

function fromB64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const KEEP = '10xbnb-july-key';
const ITER = 600000;

function toB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function sealedFile() {
  const res = await fetch('./july.sealed', { cache: 'no-cache' });
  if (!res.ok) throw new Error('file');
  return new Uint8Array(await res.arrayBuffer());
}

async function openWith(rawKey, buf) {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(16, 28) }, key, buf.slice(28));
  return JSON.parse(new TextDecoder().decode(plain));
}

// The link half and the typed code together make the key.
async function keyFrom(code, half, buf) {
  const mix = new Uint8Array(48);
  mix.set(half, 0);
  mix.set(buf.slice(0, 16), 32);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: mix, iterations: ITER }, base, 256);
  return new Uint8Array(bits);
}

function kept() {
  try {
    const text = localStorage.getItem(KEEP);
    return text ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0)) : null;
  } catch { return null; }
}

function keep(rawKey) {
  try { localStorage.setItem(KEEP, toB64(rawKey)); } catch { /* private window: it will ask again */ }
}

function forget() {
  try { localStorage.removeItem(KEEP); } catch { /* nothing kept */ }
}

function pad(half, buf) {
  let typed = '';
  let busy = false;
  const dots = el('p', 'dots', '');
  const say = el('p', 'sub', 'Type the code.');
  const grid = el('div', 'pad');
  const show = () => { dots.textContent = typed ? '*'.repeat(typed.length) : '-'; };
  const tryOpen = async () => {
    if (busy || typed.length < 4) return;
    busy = true;
    say.textContent = 'Opening.';
    try {
      const rawKey = await keyFrom(typed, half, buf);
      const data = await openWith(rawKey, buf);
      keep(rawKey);
      state.rows = data.rows || [];
      state.made = data.made || '';
      paint();
    } catch {
      typed = '';
      show();
      say.textContent = 'No. Try the code again.';
      busy = false;
    }
  };
  for (const name of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DEL', '0', 'OPEN']) {
    const button = el('button', name === 'OPEN' ? 'go' : '', name);
    button.addEventListener('click', () => {
      if (busy) return;
      if (name === 'OPEN') { tryOpen(); return; }
      if (name === 'DEL') typed = typed.slice(0, -1);
      else if (typed.length < 24) typed += name;
      say.textContent = 'Type the code.';
      show();
    });
    grid.append(button);
  }
  show();
  app.replaceChildren(el('h1', '', '10XBNB'), say, dots, grid);
}

function shut(text) {
  app.replaceChildren(el('h1', '', '10XBNB'), el('p', 'sub', text));
}

function place(row) {
  return [row.address, row.city, row.state].filter(Boolean).join(', ');
}

function matches(row) {
  if (state.filter === 'STARRED' && !row.starred) return false;
  if (state.filter === 'CALLED' && !state.marks[row.listing_url]) return false;
  if (state.filter === 'TO CALL' && (state.marks[row.listing_url] || !row.owner_phone)) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [row.listing_title, row.owner_name, row.owner_phone, place(row), row.zip, ...(row.notes || [])]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function fold(row) {
  const box = el('div', 'fold');
  if (row.owner_phone) {
    const digits = row.owner_phone.replace(/\D/g, '');
    box.append(link(`CALL ${row.owner_phone}`, `tel:+1${digits}`));
    box.append(link('TEXT', `sms:+1${digits}`));
  }
  const listing = safeHttp(row.listing_url);
  if (listing) box.append(link('LISTING', listing));
  const report = safeHttp(row.report_url || '');
  if (report) box.append(link('REPORT', report));
  const called = Boolean(state.marks[row.listing_url]);
  const mark = el('button', called ? 'mark on' : 'mark', called ? '[X] CALLED' : '[ ] CALLED');
  mark.addEventListener('click', () => {
    if (called) delete state.marks[row.listing_url];
    else state.marks[row.listing_url] = new Date().toISOString().slice(0, 10);
    saveMarks();
    paintList();
  });
  box.append(mark);
  if (row.last_contacted) box.append(el('p', 'meta', `last ${row.last_contacted}`));
  for (const note of row.notes || []) box.append(el('p', 'note', note));
  return box;
}

function paintList() {
  const list = document.querySelector('#list');
  const count = document.querySelector('#count');
  const shown = state.rows.map((row, i) => [row, i]).filter(([row]) => matches(row));
  count.textContent = `${shown.length} of ${state.rows.length}`;
  const nodes = [];
  for (const [row, i] of shown) {
    const wrap = el('div', state.marks[row.listing_url] ? 'row done' : 'row');
    const hit = el('div', 'hit');
    const title = el('div', 'title');
    title.append(el('span', `sq ${row.status || 'NEW'}`));
    if (row.starred) title.append(el('span', 'star', '* '));
    title.append(place(row) || row.listing_title || 'LISTING');
    hit.append(title);
    const who = [row.owner_name, row.owner_phone].filter(Boolean).join(' · ');
    if (who) hit.append(el('div', 'who', who));
    hit.addEventListener('click', () => {
      state.open = state.open === i ? -1 : i;
      paintList();
    });
    wrap.append(hit);
    if (state.open === i) wrap.append(fold(row));
    nodes.push(wrap);
  }
  list.replaceChildren(...nodes);
  for (const button of document.querySelectorAll('.counts button')) {
    button.classList.toggle('on', button.textContent === state.filter);
  }
}

function paint() {
  const top = el('h1', '', '10XBNB');
  const sub = el('p', 'sub', `JULY · sealed ${state.made} · marks stay on this phone`);
  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = 'search';
  search.autocomplete = 'off';
  search.addEventListener('input', () => {
    state.query = search.value;
    state.open = -1;
    paintList();
  });
  const counts = el('div', 'counts');
  for (const name of ['ALL', 'STARRED', 'TO CALL', 'CALLED']) {
    const button = el('button', '', name);
    button.addEventListener('click', () => {
      state.filter = name;
      state.open = -1;
      paintList();
    });
    counts.append(button);
  }
  const count = el('p', 'meta');
  count.id = 'count';
  const list = el('div');
  list.id = 'list';
  app.replaceChildren(top, sub, search, counts, count, list);
  paintList();
}

async function start() {
  let buf;
  try {
    buf = await sealedFile();
  } catch {
    shut('The list did not load. Check the signal and open the link again.');
    return;
  }
  const mine = kept();
  if (mine) {
    try {
      const data = await openWith(mine, buf);
      state.rows = data.rows || [];
      state.made = data.made || '';
      paint();
      return;
    } catch { forget(); }
  }
  let half = null;
  try { half = fromB64url(location.hash.slice(1)); } catch { half = null; }
  if (!half || half.length !== 32) {
    shut('This door opens only from its own link.');
    return;
  }
  pad(half, buf);
}

window.addEventListener('hashchange', start);
start();
