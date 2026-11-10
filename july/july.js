// The sealed July list.
// Two halves open it: the part of the link after the #, and a number code typed
// once. Neither is sent anywhere. After the first opening this browser keeps the
// key. A colour changed or a house added here is sealed with that same key and
// appended to the shared ledger, so every phone that holds the key sees it.

import { LEDGER_URL, LEDGER_KEY } from './config.js';

const app = document.querySelector('#app');
const ITER = 600000;
const KEEP = '10xbnb-july-key';
const COLOUR = '10xbnb-july-status';
const ADDED = '10xbnb-july-added';
const OUTBOX = '10xbnb-july-outbox';
const SEEN = '10xbnb-july-seen';
const JOINED = '10xbnb-july-joined';
const ORDER = ['NEW', 'CONTACTED', 'PITCHED', 'SIGNED', 'NO'];
const NAME = { NEW: 'NEW', CONTACTED: 'CALLED', PITCHED: 'PITCHED', SIGNED: 'SIGNED', NO: 'NO' };

const state = {
  rows: [], query: '', filter: '', open: '',
  colour: read(COLOUR, {}), added: read(ADDED, []), outbox: read(OUTBOX, []), seen: read(SEEN, 0),
};

// ---- small things

function read(name, empty) {
  try {
    const value = JSON.parse(localStorage.getItem(name));
    return value === null || typeof value !== typeof empty ? empty : value;
  } catch { return empty; }
}

function write(name, value) {
  try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* private window */ }
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls, text, act) {
  const node = el('button', cls, text);
  node.addEventListener('click', act);
  return node;
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

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function unb64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function safeHttp(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* not a link */ }
  return '';
}

// ---- the lock

function fromB64url(text) {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  return unb64(plain + '='.repeat((4 - (plain.length % 4)) % 4));
}

// File: salt 16, iv 12, then the sealed list.
async function openWith(rawKey, buf) {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(16, 28) }, key, buf.slice(28));
  return JSON.parse(new TextDecoder().decode(plain)).rows || [];
}

async function keyFrom(code, half, buf) {
  const mix = new Uint8Array(48);
  mix.set(half, 0);
  mix.set(buf.slice(0, 16), 32);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: mix, iterations: ITER }, base, 256);
  return new Uint8Array(bits);
}

function pad(half, buf) {
  let typed = '';
  let busy = false;
  const dots = el('p', 'dots', '-');
  const show = (text) => { dots.textContent = text || (typed ? '*'.repeat(typed.length) : '-'); };
  const tryOpen = async () => {
    if (busy || typed.length < 4) return;
    busy = true;
    show('...');
    let rawKey;
    try {
      rawKey = await keyFrom(typed, half, buf);
      state.rows = await openWith(rawKey, buf);
    } catch {
      typed = '';
      busy = false;
      show('NO');
      return;
    }
    try { localStorage.setItem(KEEP, b64(rawKey)); } catch { /* private window */ }
    paint();
    join(rawKey);
  };
  const grid = el('div', 'pad');
  for (const name of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DEL', '0', 'OPEN']) {
    grid.append(button(name === 'OPEN' ? 'go' : '', name, () => {
      if (busy) return;
      if (name === 'OPEN') { tryOpen(); return; }
      if (name === 'DEL') typed = typed.slice(0, -1);
      else if (typed.length < 24) typed += name;
      show();
    }));
  }
  app.replaceChildren(el('h1', '', '10XBNB'), dots, grid);
}

// ---- the shared ledger
// Every change is one sealed line appended to a room only the key can name.
// The shelf holds noise. Nothing there is ever edited or erased.

const shared = Boolean(LEDGER_URL && LEDGER_KEY);
let aes = null;
let room = '';
let syncing = false;
let again = false;

function apply(event) {
  if (event.t === 'colour' && ORDER.includes(event.v)) state.colour[event.k] = event.v;
  if (event.t === 'add' && event.row && !state.added.some((row) => row.id === event.row.id)) {
    state.added.unshift(event.row);
  }
}

function persist() {
  write(COLOUR, state.colour);
  write(ADDED, state.added);
  write(OUTBOX, state.outbox);
  write(SEEN, state.seen);
}

// Every change made on this phone goes through here.
function record(event) {
  apply(event);
  if (shared) state.outbox.push(event);
  persist();
  sync();
}

async function rpc(name, args) {
  const res = await fetch(`${LEDGER_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: LEDGER_KEY, Authorization: `Bearer ${LEDGER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(name);
  return res.json();
}

async function sealLine(event) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const text = new TextEncoder().encode(JSON.stringify(event));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, text));
  return b64([...iv, ...body]);
}

async function openLine(text) {
  const buf = unb64(text);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, aes, buf.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

// Send what this phone changed, then take what the others changed.
async function sync() {
  if (!aes) return;
  if (syncing) { again = true; return; }
  syncing = true;
  try {
    while (state.outbox.length) {
      await rpc('ledger_write', { p_room: room, p_body: await sealLine(state.outbox[0]) });
      state.outbox.shift();
      write(OUTBOX, state.outbox);
    }
    const lines = await rpc('ledger_read', { p_room: room, p_after: state.seen });
    for (const line of lines) {
      try { apply(await openLine(line.body)); } catch { /* not sealed by this key */ }
      state.seen = Math.max(state.seen, line.id);
    }
    if (lines.length) {
      persist();
      if (document.querySelector('#list')) paintList();
    }
  } catch { /* no signal: the outbox keeps it for next time */ }
  syncing = false;
  if (again) { again = false; sync(); }
}

async function join(rawKey) {
  if (!shared) return;
  aes = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const named = new Uint8Array([...new TextEncoder().encode('10xbnb-july-room'), ...rawKey]);
  room = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', named)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (!read(JOINED, false)) {
    // What this phone already held before the ledger existed goes up once.
    for (const [k, v] of Object.entries(state.colour)) state.outbox.push({ t: 'colour', k, v });
    for (const row of [...state.added].reverse()) state.outbox.push({ t: 'add', row });
    write(JOINED, true);
    persist();
  }
  sync();
  setInterval(sync, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
}

// ---- the list

function allRows() {
  return [...state.added, ...state.rows];
}

function keyOf(row) {
  return row.id || row.listing_url;
}

function statusOf(row) {
  return state.colour[keyOf(row)] || row.status || 'NEW';
}

function titleOf(row) {
  return [row.address, row.city, row.state].filter(Boolean).join(', ') || row.listing_title || 'LISTING';
}

function matches(row) {
  if (state.filter && statusOf(row) !== state.filter) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return [row.listing_title, row.owner_name, row.owner_phone, titleOf(row), row.zip, ...(row.notes || [])]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

function send(row) {
  const text = ['10XBNB ADD', row.listing_url, row.address, row.owner_name, row.owner_phone, ...(row.notes || [])]
    .filter(Boolean).join('\n');
  if (navigator.share) return navigator.share({ text }).catch(() => {});
  location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

function fold(row) {
  const box = el('div', 'fold');
  const who = [row.owner_name, row.owner_phone].filter(Boolean).join(' · ');
  if (who) box.append(el('p', '', who));
  const acts = el('div', 'acts');
  const digits = (row.owner_phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length === 10) acts.append(link('CALL', `tel:+1${digits}`), link('TEXT', `sms:+1${digits}`));
  const listing = safeHttp(row.listing_url);
  if (listing) acts.append(link('LISTING', listing));
  const analyzer = safeHttp(row.report_url || '');
  if (analyzer) acts.append(link('ANALYZER', analyzer));
  if (row.mine && !shared) acts.append(button('', 'SEND', () => send(row)));
  if (acts.children.length) box.append(acts);
  for (const line of [row.last_contacted, ...(row.notes || [])]) {
    if (line) box.append(el('p', 'note', line));
  }
  return box;
}

function paintList() {
  const nodes = [];
  for (const row of allRows().filter(matches)) {
    const key = keyOf(row);
    const status = statusOf(row);
    const wrap = el('div', 'row');
    const line = el('div', 'line');
    const box = button('box', '', () => {
      record({ t: 'colour', k: key, v: ORDER[(ORDER.indexOf(status) + 1) % ORDER.length] });
      paintList();
    });
    box.append(el('span', `sq ${status}`));
    box.setAttribute('aria-label', NAME[status]);
    const title = el('div', 'title', `${row.starred ? '* ' : ''}${titleOf(row)}`);
    title.addEventListener('click', () => {
      state.open = state.open === key ? '' : key;
      paintList();
    });
    line.append(box, title);
    wrap.append(line);
    if (state.open === key) wrap.append(fold(row));
    nodes.push(wrap);
  }
  document.querySelector('#list').replaceChildren(...nodes);
  for (const node of document.querySelectorAll('.key button')) {
    node.classList.toggle('on', node.dataset.status === state.filter);
  }
}

function addForm(close) {
  const fields = [
    ['listing_url', 'listing link', 'url'],
    ['address', 'address, city, state', 'text'],
    ['owner_name', 'owner', 'text'],
    ['owner_phone', 'phone', 'tel'],
    ['note', 'note', 'text'],
  ].map(([name, placeholder, type]) => {
    const input = el('input');
    Object.assign(input, { type, placeholder, autocomplete: 'off' });
    input.dataset.name = name;
    return input;
  });
  const save = () => {
    const got = Object.fromEntries(fields.map((input) => [input.dataset.name, input.value.trim()]));
    if (!got.listing_url && !got.address) return;
    const url = safeHttp(got.listing_url);
    const row = {
      id: `added:${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      mine: true,
      status: 'NEW',
      listing_title: got.address || got.listing_url,
      listing_url: url,
      address: got.address,
      owner_name: got.owner_name,
      owner_phone: got.owner_phone,
      notes: [got.note, url ? '' : got.listing_url].filter(Boolean),
    };
    record({ t: 'add', row });
    close();
    paintList();
    if (!shared) send(row);
  };
  const acts = el('div', 'acts');
  acts.append(button('', shared ? 'SAVE' : 'SEND', save), button('quiet', 'BACK', close));
  const box = el('div', 'add');
  box.append(...fields, acts);
  return box;
}

// The plus opens the form over the list, dimmed and blurred behind it.
function openAdd() {
  const veil = el('div', 'veil');
  const close = () => veil.remove();
  veil.addEventListener('click', (event) => { if (event.target === veil) close(); });
  veil.append(addForm(close));
  app.append(veil);
  veil.querySelector('input').focus();
}

function paint() {
  const key = el('div', 'key');
  for (const status of ORDER) {
    const node = button('', NAME[status], () => {
      state.filter = state.filter === status ? '' : status;
      paintList();
    });
    node.dataset.status = status;
    node.append(el('span', `sq ${status}`));
    key.append(node);
  }
  const top = el('div', 'top');
  top.append(el('h1', '', '10XBNB'), key);
  const search = el('input', 'search');
  Object.assign(search, { type: 'search', placeholder: 'search', autocomplete: 'off', value: state.query });
  search.addEventListener('input', () => {
    state.query = search.value;
    paintList();
  });
  const list = el('div');
  list.id = 'list';
  app.replaceChildren(top, search, list, button('plus', '+', openAdd));
  paintList();
}

// ---- the door

function shut(text) {
  app.replaceChildren(el('h1', '', '10XBNB'), el('p', '', text));
}

async function start() {
  let buf;
  try {
    const res = await fetch('./july.sealed', { cache: 'no-cache' });
    if (!res.ok) throw new Error('file');
    buf = new Uint8Array(await res.arrayBuffer());
  } catch {
    shut('No signal.');
    return;
  }
  try {
    const kept = unb64(localStorage.getItem(KEEP) || '');
    state.rows = await openWith(kept, buf);
    paint();
    join(kept);
    return;
  } catch { /* not opened here yet */ }
  let half = null;
  try { half = fromB64url(location.hash.slice(1)); } catch { half = null; }
  if (!half || half.length !== 32) {
    shut('Open it from the link.');
    return;
  }
  pad(half, buf);
}

// A house marked called under the first version keeps its mark.
for (const key of Object.keys(read('10xbnb-july-called', {}))) {
  if (!state.colour[key]) state.colour[key] = 'CONTACTED';
}

window.addEventListener('hashchange', start);
start();
