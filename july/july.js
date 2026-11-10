// The sealed July list. Two halves open it: the part of the link after the #,
// and a number code typed once. Neither is sent to any server. After the first
// opening this browser keeps the key and does not ask again.
// Marks made here stay on this phone only.

const app = document.querySelector('#app');
const MARKS = '10xbnb-july-called';
const ADDED = '10xbnb-july-added';
const state = {
  rows: [], made: '', query: '', filter: 'ALL', open: -1,
  marks: loadMarks(), added: loadAdded(), adding: false,
};

// Houses added on this phone. They live here until they are sent and sealed in.
function loadAdded() {
  try {
    const list = JSON.parse(localStorage.getItem(ADDED) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function saveAdded() {
  try { localStorage.setItem(ADDED, JSON.stringify(state.added)); } catch { /* private window */ }
}

function everyRow() {
  return [...state.added, ...state.rows];
}

function keyOf(row) {
  return row.listing_url || row.id || '';
}

async function send(row) {
  const text = ['10XBNB ADD', row.listing_url, row.address, row.owner_name, row.owner_phone, ...(row.notes || [])]
    .filter(Boolean).join('\n');
  if (navigator.share) {
    try { await navigator.share({ text }); } catch { /* he closed the sheet */ }
    return;
  }
  location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

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
  if (state.filter === 'CALLED' && !state.marks[keyOf(row)]) return false;
  if (state.filter === 'TO CALL' && (state.marks[keyOf(row)] || !row.owner_phone)) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [row.listing_title, row.owner_name, row.owner_phone, place(row), row.zip, ...(row.notes || [])]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function fold(row) {
  const box = el('div', 'fold');
  if (row.mine) {
    box.append(el('p', 'meta', `added on this phone ${row.added || ''}. Send it so it joins the shared list.`));
    const out = el('button', 'mark on', 'SEND TO LEVI');
    out.addEventListener('click', () => send(row));
    box.append(out);
  }
  if (row.owner_phone) {
    const digits = row.owner_phone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      box.append(link(`CALL ${row.owner_phone}`, `tel:+1${digits}`));
      box.append(link('TEXT', `sms:+1${digits}`));
    }
  }
  const listing = safeHttp(row.listing_url);
  if (listing) box.append(link('LISTING', listing));
  const report = safeHttp(row.report_url || '');
  if (report) box.append(link('REPORT', report));
  const called = Boolean(state.marks[keyOf(row)]);
  const mark = el('button', called ? 'mark on' : 'mark', called ? '[X] CALLED' : '[ ] CALLED');
  mark.addEventListener('click', () => {
    if (called) delete state.marks[keyOf(row)];
    else state.marks[keyOf(row)] = new Date().toISOString().slice(0, 10);
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
  const rows = everyRow();
  const shown = rows.map((row, i) => [row, i]).filter(([row]) => matches(row));
  count.textContent = `${shown.length} of ${rows.length}`;
  const nodes = [];
  for (const [row, i] of shown) {
    const wrap = el('div', state.marks[keyOf(row)] ? 'row done' : 'row');
    const hit = el('div', 'hit');
    const title = el('div', 'title');
    title.append(el('span', `sq ${row.status || 'NEW'}`));
    if (row.starred) title.append(el('span', 'star', '* '));
    if (row.mine) title.append(el('span', 'star', '+ '));
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

function field(name, placeholder, kind) {
  const input = el('input', 'search');
  input.type = kind || 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.dataset.name = name;
  return input;
}

function addForm() {
  const box = el('div', 'add');
  const fields = [
    field('listing_url', 'listing link', 'url'),
    field('address', 'address, city, state'),
    field('owner_name', 'owner name'),
    field('owner_phone', 'phone', 'tel'),
    field('note', 'note'),
  ];
  const say = el('p', 'meta', '');
  const save = el('button', 'mark on', 'SAVE AND SEND');
  save.addEventListener('click', async () => {
    const got = {};
    for (const input of fields) got[input.dataset.name] = input.value.trim();
    if (!got.listing_url && !got.address) {
      say.textContent = 'It needs a link or an address.';
      return;
    }
    const row = {
      id: `added:${Date.now()}`,
      mine: true,
      added: new Date().toLocaleDateString('en-CA'),
      status: 'NEW',
      listing_title: got.address || got.listing_url,
      listing_url: safeHttp(got.listing_url),
      address: got.address,
      owner_name: got.owner_name,
      owner_phone: got.owner_phone,
      notes: got.note ? [got.note] : [],
    };
    if (!row.listing_url && got.listing_url) row.notes.push(got.listing_url);
    state.added.unshift(row);
    saveAdded();
    state.adding = false;
    paint();
    await send(row);
  });
  const cancel = el('button', 'mark', 'CANCEL');
  cancel.addEventListener('click', () => { state.adding = false; paint(); });
  box.append(...fields, say, save, cancel);
  return box;
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
  const plus = el('button', 'mark', '+ ADD A HOUSE');
  plus.addEventListener('click', () => { state.adding = true; paint(); });
  if (state.adding) {
    app.replaceChildren(top, el('p', 'sub', 'A new house. It saves on this phone and opens a message to send.'), addForm());
    return;
  }
  app.replaceChildren(top, sub, plus, search, counts, count, list);
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
