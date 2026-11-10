// The sealed July list.
// Two halves open it: the part of the link after the #, and a number code typed
// once. Neither is sent anywhere. After the first opening this browser keeps the
// key. The colour of a house and any house added here stay on this phone.

const app = document.querySelector('#app');
const ITER = 600000;
const KEEP = '10xbnb-july-key';
const COLOUR = '10xbnb-july-status';
const ADDED = '10xbnb-july-added';
const ORDER = ['NEW', 'CONTACTED', 'PITCHED', 'SIGNED', 'NO'];
const NAME = { NEW: 'NEW', CONTACTED: 'CALLED', PITCHED: 'PITCHED', SIGNED: 'SIGNED', NO: 'NO' };

const state = {
  rows: [], query: '', filter: '', open: '', adding: false,
  colour: read(COLOUR, {}), added: read(ADDED, []),
};

// ---- small things

function read(name, empty) {
  try {
    const value = JSON.parse(localStorage.getItem(name));
    return value && typeof value === 'object' ? value : empty;
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

function safeHttp(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* not a link */ }
  return '';
}

// ---- the lock

function fromB64url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
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
    try { localStorage.setItem(KEEP, btoa(String.fromCharCode(...rawKey))); } catch { /* private window */ }
    paint();
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
  if (row.mine) acts.append(button('', 'SEND', () => send(row)));
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
      state.colour[key] = ORDER[(ORDER.indexOf(status) + 1) % ORDER.length];
      write(COLOUR, state.colour);
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

function addForm() {
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
      id: `added:${Date.now()}`,
      mine: true,
      status: 'NEW',
      listing_title: got.address || got.listing_url,
      listing_url: url,
      address: got.address,
      owner_name: got.owner_name,
      owner_phone: got.owner_phone,
      notes: [got.note, url ? '' : got.listing_url].filter(Boolean),
    };
    state.added.unshift(row);
    write(ADDED, state.added);
    state.adding = false;
    paint();
    send(row);
  };
  const acts = el('div', 'acts');
  acts.append(button('', 'SEND', save), button('quiet', 'BACK', () => { state.adding = false; paint(); }));
  const box = el('div', 'add');
  box.append(...fields, acts);
  return box;
}

function paint() {
  const head = el('h1', '', '10XBNB');
  if (state.adding) {
    app.replaceChildren(head, addForm());
    return;
  }
  const left = el('div');
  left.append(head, button('', 'ADD', () => { state.adding = true; paint(); }));
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
  top.append(left, key);
  const search = el('input', 'search');
  Object.assign(search, { type: 'search', placeholder: 'search', autocomplete: 'off', value: state.query });
  search.addEventListener('input', () => {
    state.query = search.value;
    paintList();
  });
  const list = el('div');
  list.id = 'list';
  app.replaceChildren(top, search, list);
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
    const kept = Uint8Array.from(atob(localStorage.getItem(KEEP) || ''), (c) => c.charCodeAt(0));
    state.rows = await openWith(kept, buf);
    paint();
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
