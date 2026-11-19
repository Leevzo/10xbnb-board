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
const NEEDS = '10xbnb-july-needs';
const DID = '10xbnb-july-did';
const NOTES = '10xbnb-july-notes';
try { localStorage.removeItem('10xbnb-july-undo'); } catch { /* the old capped list */ }
const EDITS = '10xbnb-july-edits';
const GONE = '10xbnb-july-gone';
const ORDERS = '10xbnb-july-orders';
const UNDO = '10xbnb-july-undo';
const ORDER = ['NEW', 'CONTACTED', 'PITCHED', 'SIGNED', 'NO'];
const NAME = { NEW: 'NEW', CONTACTED: 'CALLED', PITCHED: 'PITCHED', SIGNED: 'SIGNED', NO: 'NO' };

const state = {
  rows: [], query: '', filter: '', open: '', pick: '', needsOpen: false,
  colour: read(COLOUR, {}), added: read(ADDED, []), outbox: read(OUTBOX, []), seen: read(SEEN, 0),
  needs: read(NEEDS, []), did: read(DID, {}),
  notes: read(NOTES, {}), edits: read(EDITS, {}), gone: read(GONE, {}), orders: read(ORDERS, {}),
  editing: '', armed: '', undo: (() => {
    // UNDO goes back without limit for as long as the app stays open, through
    // the page's own reloads; a fresh open starts clean.
    try { const v = JSON.parse(sessionStorage.getItem(UNDO)); return Array.isArray(v) ? v : []; } catch { return []; }
  })(),
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
    takeSteps();
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
  if (event.t === 'need' && event.text && !state.needs.some((need) => need.id === event.id)) {
    state.needs.push({ id: event.id, text: String(event.text).slice(0, 300) });
  }
  if (event.t === 'did') state.did[event.id] = Boolean(event.v);
  if (event.t === 'note' && event.k && event.id && event.text) {
    const list = state.notes[event.k] || (state.notes[event.k] = []);
    if (!list.some((note) => note.id === event.id)) list.push({ id: event.id, text: String(event.text).slice(0, 600) });
  }
  if (event.t === 'edit' && event.id && event.text) state.edits[event.id] = String(event.text).slice(0, 600);
  if (event.t === 'gone' && event.id) state.gone[event.id] = event.v !== false;
  if (event.t === 'order' && event.list && Array.isArray(event.ids)) {
    state.orders[event.list] = event.ids.slice(0, 500).map(String);
  }
}

function persist() {
  write(COLOUR, state.colour);
  write(ADDED, state.added);
  write(OUTBOX, state.outbox);
  write(SEEN, state.seen);
  write(NEEDS, state.needs);
  write(DID, state.did);
  write(NOTES, state.notes);
  write(EDITS, state.edits);
  write(GONE, state.gone);
  write(ORDERS, state.orders);
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
      // A line being typed or dragged is left alone; it repaints when the hand lets go.
      const held = document.activeElement?.dataset?.hold || document.querySelector('.lift');
      if (document.querySelector('#list') && !held) { paintNext(); paintList(); }
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

// The title is the one phrase that names the house. The town sits beside it.
function titleOf(row) {
  return row.address || row.listing_title || 'LISTING';
}

function townOf(row) {
  return [row.city, row.state].filter(Boolean).join(', ');
}

function matches(row) {
  if (state.filter && statusOf(row) !== state.filter) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return [row.listing_title, row.owner_name, row.owner_phone, row.address, townOf(row), row.zip, ...notesOf(row).map((note) => note.text)]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

// ---- lines a hand can change
// A step or a note can be reworded, lifted out, or moved. Each change is one
// more sealed line on the shelf; every earlier line is still there.

// A change to a line is recorded with the change that puts it back. UNDO plays
// the last one. Putting a line back is itself one more sealed line.
function act(event, back) {
  record(event);
  state.undo.push(back);
  keepUndo();
  paintUndo();
}

function keepUndo() {
  try { sessionStorage.setItem(UNDO, JSON.stringify(state.undo)); } catch { /* private window */ }
}

function undo() {
  const back = state.undo.pop();
  keepUndo();
  if (!back) return;
  state.armed = '';
  state.editing = '';
  record(back);
  paintNext();
  paintList();
  paintUndo();
}

function paintUndo() {
  const node = document.querySelector('.undo');
  if (node) node.hidden = !state.undo.length;
}

function hash(text) {
  let sum = 5381;
  for (const ch of text) sum = (sum * 33 + ch.codePointAt(0)) >>> 0;
  return sum.toString(36);
}

function fresh(kind) {
  return `${kind}:${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

// What stands in a list now: lifted lines out, reworded lines in their new
// words, in the order last set. A line the order never met goes to the end.
function arrange(list, items) {
  const want = state.orders[list] || [];
  const place = (id) => { const at = want.indexOf(id); return at < 0 ? want.length : at; };
  return items
    .filter((item) => !state.gone[item.id])
    .map((item, at) => ({ id: item.id, text: state.edits[item.id] || item.text, at }))
    .sort((a, b) => place(a.id) - place(b.id) || a.at - b.at);
}

function needsNow() {
  return arrange('needs', state.needs);
}

function notesOf(row) {
  const key = keyOf(row);
  const seen = new Set();
  const sealed = [];
  for (const text of row.notes || []) {
    if (!text || seen.has(text)) continue;
    seen.add(text);
    sealed.push({ id: `s:${key}:${hash(text)}`, text });
  }
  return arrange(`notes:${key}`, [...sealed, ...(state.notes[key] || [])]);
}

// The grip on the left: hold it and move the line up or down.
function grab(grip, line, list, repaint, kind = 'item', settle = (ids) => ids) {
  grip.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const host = line.parentElement;
    const lines = () => [...host.children].filter((node) => node.classList.contains(kind));
    const was = lines().map((node) => node.dataset.id);
    const before = was.join('|');
    line.classList.add('lift');
    state.armed = '';
    const move = (ev) => {
      const others = lines().filter((node) => node !== line);
      const below = others.find((node) => {
        const box = node.getBoundingClientRect();
        return ev.clientY < box.top + box.height / 2;
      });
      if (below) host.insertBefore(line, below);
      else if (others.length) others[others.length - 1].after(line);
    };
    const drop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      line.classList.remove('lift');
      const ids = lines().map((node) => node.dataset.id);
      if (ids.join('|') !== before) {
        const back = state.orders[list] ? [...state.orders[list]] : was;
        act({ t: 'order', list, ids: settle(ids) }, { t: 'order', list, ids: back });
      }
      repaint();
    };
    // Moving the line moves the grip, which loses any hold on the pointer, so
    // the page itself listens for the move and the letting go.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
  });
}

// One line: the grip and the lift-out tab on the left, then anything the list
// puts before the words, then the words. A tap on the words opens them.
function itemLine(list, item, repaint, { lead = [], cls = '' } = {}) {
  const line = el('div', `line item ${cls}`.trim());
  line.dataset.id = item.id;
  const grip = el('span', 'grip', '=');
  grip.setAttribute('aria-label', 'hold and move this line');
  grab(grip, line, list, repaint);
  const armed = state.armed === item.id;
  const cut = button(armed ? 'cut armed' : 'cut', armed ? 'DEL?' : 'x', (event) => {
    event.stopPropagation();
    if (!armed) {
      state.armed = item.id;
      state.editing = '';
      repaint();
      return;
    }
    state.armed = '';
    act({ t: 'gone', id: item.id, v: true }, { t: 'gone', id: item.id, v: false });
    repaint();
  });
  cut.setAttribute('aria-label', armed ? 'tap again to take this line out' : 'take this line out');
  line.append(grip, cut, ...lead);
  if (state.editing === item.id) {
    const input = el('input', 'edit');
    Object.assign(input, { type: 'text', value: item.text, autocomplete: 'off', enterKeyHint: 'done' });
    input.dataset.hold = '1';
    let closed = false;
    const close = (keep) => {
      if (closed) return;
      closed = true;
      const text = input.value.trim();
      state.editing = '';
      if (keep && text && text !== item.text) act({ t: 'edit', id: item.id, text }, { t: 'edit', id: item.id, text: item.text });
      repaint();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') close(true);
      if (event.key === 'Escape') close(false);
    });
    input.addEventListener('blur', () => close(true));
    line.append(input);
  } else {
    const words = el('div', 'words', item.text);
    words.addEventListener('click', () => {
      state.editing = item.id;
      state.armed = '';
      repaint();
      const input = document.querySelector('input.edit');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    line.append(words);
  }
  return line;
}

// A note is a field: tap it and change the words. Leaving it keeps the change.
// Emptying it takes the note out. A house with no note shows one empty field.
function noteField(key, note) {
  const field = el('textarea', 'notefield');
  Object.assign(field, { value: note ? note.text : '', placeholder: 'note', rows: 1, autocomplete: 'off', enterKeyHint: 'done' });
  field.dataset.hold = '1';
  const fit = () => { field.style.height = 'auto'; field.style.height = `${field.scrollHeight}px`; };
  requestAnimationFrame(fit);
  field.addEventListener('input', fit);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); field.blur(); }
  });
  field.addEventListener('blur', () => {
    const text = field.value.trim();
    if (!note) {
      if (!text) return;
      const id = fresh('note');
      act({ t: 'note', k: key, id, text }, { t: 'gone', id, v: true });
      note = { id, text };
      return;
    }
    if (text === note.text) return;
    if (!text) act({ t: 'gone', id: note.id, v: true }, { t: 'gone', id: note.id, v: false });
    else act({ t: 'edit', id: note.id, text }, { t: 'edit', id: note.id, text: note.text });
    note = { id: note.id, text };
  });
  return field;
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
  if (row.last_contacted) box.append(el('p', 'note', row.last_contacted));
  const key = keyOf(row);
  const notes = el('div', 'notes');
  const list = notesOf(row);
  for (const note of list) notes.append(noteField(key, note));
  if (!list.length) notes.append(noteField(key, null));
  box.append(notes);
  return box;
}

// ---- the orb
// Each colour is a round 12 by 12 sprite with its own pixel pattern, so a state
// reads by shape as well as by hue.

const HUE = { NEW: '--dim', CONTACTED: '--mind', PITCHED: '--play', SIGNED: '--will', NO: '--heart' };
const ROUND = [4, 8, 10, 10, 12, 12, 12, 12, 10, 10, 8, 4];
const WEAVE = {
  NEW: (x, y) => (x + y) % 2 === 0,
  CONTACTED: (x, y) => y % 3 === 0,
  PITCHED: (x, y) => (x + y) % 4 < 2,
  SIGNED: (x, y) => x % 3 === 1 && y % 3 === 1,
  NO: (x, y) => Math.abs(x - y) < 2 || Math.abs(x + y - 11) < 2,
};

function blend(hex, toward, share) {
  const from = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${from.map((part) => Math.round(part + (toward - part) * share)).join(',')})`;
}

function draw(canvas, status) {
  const hue = getComputedStyle(document.documentElement).getPropertyValue(HUE[status]).trim();
  const tones = [hue, blend(hue, 0, 0.45), blend(hue, 255, 0.6)];
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 12, 12);
  for (let y = 0; y < 12; y += 1) {
    const from = (12 - ROUND[y]) / 2;
    for (let x = from; x < from + ROUND[y]; x += 1) {
      const shine = (x === 3 || x === 4) && (y === 2 || y === 3);
      const light = status === 'SIGNED' ? 2 : 1;
      ctx.fillStyle = tones[shine ? 2 : (WEAVE[status](x, y) ? light : 0)];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  canvas.dataset.status = status;
}

function orb(status) {
  const canvas = el('canvas', 'orb');
  canvas.width = 12;
  canvas.height = 12;
  draw(canvas, status);
  return canvas;
}

// Hold a house and the other colours open beneath it, each with its name.
function picker(key, status) {
  const box = el('div', 'pick');
  for (const next of ORDER.filter((name) => name !== status)) {
    const node = button('', '', () => {
      state.pick = '';
      record({ t: 'colour', k: key, v: next });
      paintList();
    });
    node.append(orb(next), NAME[next]);
    box.append(node);
  }
  return box;
}

// Three ways to touch a house. A tap opens it. A press held still opens its
// colours. A drag left moves its colour on, right moves it back, once per stretch.
function swipe(line, key, status) {
  let fromX = 0;
  let held = false;
  let steps = 0;
  let timer = 0;
  const canvas = line.querySelector('.orb');
  const tag = line.querySelector('.tag');
  const at = () => ORDER[(((ORDER.indexOf(status) + steps) % 5) + 5) % 5];
  line.addEventListener('pointerdown', (event) => {
    fromX = event.clientX;
    held = true;
    steps = 0;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!held || steps) return;
      held = false;
      state.pick = key;
      paintList();
    }, 380);
  });
  line.addEventListener('contextmenu', (event) => event.preventDefault());
  line.addEventListener('pointermove', (event) => {
    if (!held) return;
    const dx = event.clientX - fromX;
    const far = Math.abs(dx);
    const now = far < 16 ? 0 : (1 + Math.floor((far - 16) / 36)) * (dx < 0 ? 1 : -1);
    if (now === steps) return;
    if (!steps) line.setPointerCapture(event.pointerId);
    steps = now;
    draw(canvas, at());
    tag.textContent = steps ? NAME[at()] : '';
  });
  line.addEventListener('pointerup', () => {
    clearTimeout(timer);
    if (!held) return;
    held = false;
    if (steps) {
      record({ t: 'colour', k: key, v: at() });
    } else if (state.pick === key) {
      state.pick = '';
    } else {
      state.pick = '';
      state.open = state.open === key ? '' : key;
    }
    paintList();
  });
  line.addEventListener('pointercancel', () => {
    clearTimeout(timer);
    held = false;
    steps = 0;
    draw(canvas, status);
    tag.textContent = '';
  });
}

// Houses stand in the order last set by a grip. A house the order never met
// (a new one) stands at the top.
function housesNow() {
  const want = state.orders.houses || [];
  const place = (key) => want.indexOf(key);
  return allRows()
    .filter((row) => !state.gone[`house:${keyOf(row)}`])
    .map((row, at) => ({ row, at, place: place(keyOf(row)) }))
    .sort((a, b) => a.place - b.place || a.at - b.at)
    .map((item) => item.row);
}

// While the list is filtered or searched, a move reorders only the houses in
// sight; every hidden house keeps its own place.
function settleHouses(shown) {
  const all = housesNow().map(keyOf);
  const seen = new Set(shown);
  let next = 0;
  return all.map((key) => (seen.has(key) ? shown[next++] : key));
}

function paintList() {
  const nodes = [];
  for (const row of housesNow().filter(matches)) {
    const key = keyOf(row);
    const status = statusOf(row);
    const wrap = el('div', 'row');
    wrap.dataset.id = key;
    const line = el('div', 'line');
    const grip = el('span', 'grip', '=');
    grip.setAttribute('aria-label', 'hold and move this house');
    grab(grip, wrap, 'houses', paintList, 'row', settleHouses);
    const box = el('div', 'box');
    box.append(orb(status));
    const title = el('div', 'title');
    title.append(el('span', 'name', titleOf(row)), el('span', 'town', townOf(row)));
    const armed = state.armed === `house:${key}`;
    const cut = button(armed ? 'cut armed' : 'cut', armed ? 'DEL?' : 'x', () => {
      if (!armed) { state.armed = `house:${key}`; paintList(); return; }
      state.armed = '';
      act({ t: 'gone', id: `house:${key}`, v: true }, { t: 'gone', id: `house:${key}`, v: false });
      paintList();
    });
    cut.setAttribute('aria-label', armed ? 'tap again to take this house out' : 'take this house out');
    cut.addEventListener('pointerdown', (event) => event.stopPropagation());
    line.append(grip, box, title, el('span', 'tag'), cut);
    swipe(line, key, status);
    wrap.append(line);
    if (state.pick === key) wrap.append(picker(key, status));
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

// ---- the next step
// The business needs, in order. The top line is the first one not yet done.

function paintNext() {
  const host = document.querySelector('#next');
  const needs = needsNow();
  const todo = needs.find((need) => !state.did[need.id]);
  const head = button('next', 'NEXT', () => {
    state.needsOpen = !state.needsOpen;
    paintNext();
  });
  if (todo) head.append(el('span', '', todo.text));
  const nodes = [head];
  if (state.needsOpen) {
    for (const need of needs) {
      const done = Boolean(state.did[need.id]);
      const box = button('box', '', () => {
        record({ t: 'did', id: need.id, v: !done });
        paintNext();
      });
      box.append(orb(done ? 'SIGNED' : 'NEW'));
      nodes.push(itemLine('needs', need, paintNext, { lead: [box], cls: done ? 'done' : '' }));
    }
    const input = el('input', 'addstep');
    Object.assign(input, { type: 'text', placeholder: 'add a step', autocomplete: 'off', enterKeyHint: 'done' });
    input.dataset.hold = '1';
    input.addEventListener('keydown', (event) => {
      const text = input.value.trim();
      if (event.key !== 'Enter' || !text) return;
      const id = fresh('need');
      act({ t: 'need', id, text }, { t: 'gone', id, v: true });
      paintNext();
      document.querySelector('#next .addstep').focus();
    });
    nodes.push(input);
  }
  host.replaceChildren(...nodes);
}

// A link can carry steps after a ~ in its tail. They are added once, sealed like
// any other change, and the tail is cleaned. The tail never leaves the phone.
function takeSteps() {
  const [half, extra] = location.hash.slice(1).split('~');
  if (!extra) return;
  history.replaceState(null, '', `${location.pathname}${half ? `#${half}` : ''}`);
  let steps = [];
  try { steps = JSON.parse(new TextDecoder().decode(fromB64url(extra))); } catch { return; }
  if (!Array.isArray(steps)) return;
  for (const step of steps.slice(0, 24)) {
    const text = typeof step === 'string' ? step.trim() : '';
    let sum = 5381;
    for (const ch of text) sum = (sum * 33 + ch.codePointAt(0)) >>> 0;
    const id = `need:${sum.toString(36)}`;
    if (text && !state.needs.some((need) => need.id === id)) record({ t: 'need', id, text });
  }
  paintNext();
}

function paint() {
  const key = el('div', 'key');
  for (const status of ORDER) {
    const node = button('', NAME[status], () => {
      state.filter = state.filter === status ? '' : status;
      paintList();
    });
    node.dataset.status = status;
    node.append(orb(status));
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
  const next = el('div');
  next.id = 'next';
  const back = button('undo', 'UNDO', undo);
  back.hidden = !state.undo.length;
  app.replaceChildren(top, next, search, list, back, button('plus', '+', openAdd));
  paintNext();
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
    takeSteps();
    return;
  } catch { /* not opened here yet */ }
  let half = null;
  try { half = fromB64url(location.hash.slice(1).split('~')[0]); } catch { half = null; }
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

// The page renews itself when a newer one is on the shelf, so the link and the
// home screen icon never need replacing.
let built = '';
async function renew() {
  try {
    const tags = await Promise.all(['./july.js', './july.css'].map(async (file) => {
      const res = await fetch(file, { method: 'HEAD', cache: 'no-cache' });
      return res.headers.get('etag') || res.headers.get('last-modified') || '';
    }));
    const now = tags.join('|');
    const busy = document.querySelector('.veil') || document.activeElement?.tagName === 'INPUT';
    if (built && now !== built && !busy) location.reload();
    if (!built) built = now;
  } catch { /* no signal */ }
}
renew();
setInterval(renew, 600000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) renew(); });

window.addEventListener('hashchange', start);
start();
