import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as L from './logic.js';

const app = document.querySelector('#app');
const state = {
  rows: [],
  notes: {},
  filter: '',
  query: '',
  openId: '',
  making: false,
  more: false,
  form: {},
  drafts: {},
  editing: '',
  banner: '',
  kind: '',
  importer: null,
  updated: false,
  outOpen: false,
  me: '',
};

let client = null;
let channel = null;
let paintQueued = false;
let bannerTimer = 0;

function phoneBrowser() {
  const phone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
  const standalone = navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  return phone && !standalone;
}

function online() {
  return navigator.onLine;
}

function setBanner(text, kind) {
  state.banner = text;
  state.kind = kind || '';
  const node = document.querySelector('#banner');
  if (!node) return;
  node.textContent = text;
  node.dataset.kind = kind || '';
  clearTimeout(bannerTimer);
  if (kind === 'saved') bannerTimer = setTimeout(() => setBanner('', ''), 2000);
}

function safeHttp(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* not a link */ }
  return '';
}

function safeMail(email) {
  const value = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '';
  return `mailto:${value}`;
}

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('10xbnb', 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv');
      if (!database.objectStoreNames.contains('queue')) {
        database.createObjectStore('queue', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key, value) {
  const database = await db();
  await new Promise((resolve, reject) => {
    const tx = database.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  database.close();
}

async function kvGet(key) {
  const database = await db();
  const value = await new Promise((resolve, reject) => {
    const tx = database.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  database.close();
  return value;
}

async function queueAdd(item) {
  const database = await db();
  await new Promise((resolve, reject) => {
    const tx = database.transaction('queue', 'readwrite');
    tx.objectStore('queue').put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  database.close();
}

async function queueAll() {
  const database = await db();
  const rows = await new Promise((resolve, reject) => {
    const tx = database.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  database.close();
  return rows;
}

async function queueDrop(id) {
  const database = await db();
  await new Promise((resolve, reject) => {
    const tx = database.transaction('queue', 'readwrite');
    tx.objectStore('queue').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  database.close();
}

function wipeLocal() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('10xbnb');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function groupNotes(list) {
  const notes = {};
  for (const note of list || []) {
    if (!notes[note.property_id]) notes[note.property_id] = [];
    notes[note.property_id].push(note);
  }
  for (const id of Object.keys(notes)) {
    notes[id].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }
  return notes;
}

async function remember() {
  try {
    await kvSet('board', { rows: state.rows, notes: state.notes });
  } catch { /* a private browser may refuse the cache */ }
}

async function restore() {
  try {
    const saved = await kvGet('board');
    if (!saved) return false;
    state.rows = saved.rows || [];
    state.notes = saved.notes || {};
    return true;
  } catch {
    return false;
  }
}

function renderPhone() {
  app.innerHTML = `<h1>10XBNB</h1><p class="title">SHARE</p><p class="title">ADD TO HOME SCREEN</p><p class="title">OPEN THE ICON</p>`;
}

function renderLock(message) {
  app.innerHTML = `
    <h1>10XBNB</h1>
    <p id="banner" class="banner">${L.esc(message || '')}</p>
    <p class="title">EMAIL</p>
    <input id="email" type="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false">
    <p class="title">PASSWORD</p>
    <input id="password" type="password" autocomplete="current-password">
    <button class="wide" id="open" type="button">OPEN</button>`;
  document.querySelector('#open').addEventListener('click', signIn);
  document.querySelector('#password').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') signIn();
  });
}

function shell() {
  app.innerHTML = `
    <div class="top">
      <h1>10XBNB</h1>
      <button type="button" data-act="export">EXPORT</button>
    </div>
    <p id="banner" class="banner"></p>
    <input id="q" class="search" autocomplete="off" placeholder="SEARCH">
    <div id="counts" class="counts"></div>
    <div id="list"></div>
    <div id="extra"></div>`;
  document.querySelector('#q').addEventListener('input', (event) => {
    state.query = event.target.value;
    paintList();
  });
  app.addEventListener('click', onClick);
  app.addEventListener('focusout', onBlur);
  app.addEventListener('input', onInput);
  app.addEventListener('keydown', onKey);
  setBanner(state.banner, state.kind);
}

function paint() {
  paintCounts();
  paintList();
  paintExtra();
}

function paintCounts() {
  const node = document.querySelector('#counts');
  if (!node) return;
  const today = L.denverToday();
  const counts = L.countsOf(state.rows, today);
  const order = ['DUE', 'NEW', 'CONTACTED', 'PITCHED', 'SIGNED', 'NO'];
  node.innerHTML = order.map((name) => {
    const on = state.filter === name ? ' on' : '';
    return `<button type="button" class="${on}" data-act="filter" data-status="${name}">${counts[name]} ${name}</button>`;
  }).join('');
}

function visibleRows() {
  const today = L.denverToday();
  const rows = state.rows.filter((row) => {
    if (state.filter === 'DUE' && !L.isDue(row, today)) return false;
    if (state.filter && state.filter !== 'DUE' && row.status !== state.filter) return false;
    return L.matchesQuery(row, state.notes[row.id], state.query);
  });
  return L.sortRows(rows, today);
}

function sameOwners(row) {
  const phone = L.last10(row.owner_phone);
  if (!phone) return [];
  return state.rows.filter((other) => other.id !== row.id && L.last10(other.owner_phone) === phone);
}

function fieldLine(row, field, label, value) {
  const key = `${row.id}:${field}`;
  if (state.editing === key) {
    return `<p class="label">${label}</p><input data-edit="${L.esc(key)}" value="${L.esc(value || '')}">`;
  }
  const shown = value ? L.esc(value) : label;
  const cls = value ? 'title' : 'label';
  return `<p class="${cls}" data-act="edit" data-id="${row.id}" data-field="${field}">${shown}</p>`;
}

function rowHtml(row) {
  const today = L.denverToday();
  const due = L.isDue(row, today);
  const bits = [row.status];
  if (row.next_followup) bits.push(L.showDate(row.next_followup, today));
  if (row.starred) bits.push('GOOD');
  if (due) bits.push('DUE');
  const owner = row.owner_name ? ` — ${row.owner_name}` : '';
  let html = `<div class="row">
    <div class="hit" data-act="open" data-id="${row.id}">
      <div class="title"><span class="sq ${L.esc(row.status)}"></span>${L.esc(row.listing_title || '')}${L.esc(owner)}</div>
      <div class="meta">${L.esc(bits.join(' · '))}</div>
    </div>`;
  if (state.openId !== row.id) return `${html}</div>`;
  const notes = state.notes[row.id] || [];
  const link = safeHttp(row.listing_url || row.report_url);
  const mail = safeMail(row.owner_email);
  const tel = L.last10(row.owner_phone);
  const actions = [];
  if (tel) actions.push(`<a class="wide" href="tel:+1${tel}">CALL</a>`);
  if (mail) actions.push(`<a class="wide" href="${L.esc(mail)}">EMAIL</a>`);
  if (link) actions.push(`<a class="wide" href="${L.esc(link)}" target="_blank" rel="noopener">OPEN LISTING</a>`);
  const statuses = L.STATUSES.filter((status) => status !== row.status);
  const owners = sameOwners(row).map((other) =>
    `<button type="button" data-act="open" data-id="${other.id}">SAME OWNER · ${L.esc(other.listing_title || '')}</button>`);
  const noteHtml = notes.map((note) => {
    const who = note.waiting ? 'WAITING' : String(note.author_name || '').toUpperCase();
    const when = L.showDate(String(note.created_at || '').slice(0, 10), today);
    return `<div class="note"><p>${L.esc(note.body || '')}</p><p class="who">${L.esc(who)}${when ? ` · ${L.esc(when)}` : ''}</p></div>`;
  }).join('');
  html += `<div class="fold">
    ${fieldLine(row, 'listing_title', 'TITLE', row.listing_title)}
    ${fieldLine(row, 'address', 'ADDRESS', row.address)}
    ${fieldLine(row, 'owner_name', 'NAME', row.owner_name)}
    ${fieldLine(row, 'owner_phone', 'PHONE', row.owner_phone)}
    ${fieldLine(row, 'owner_email', 'EMAIL', row.owner_email)}
    ${fieldLine(row, 'listing_url', 'LISTING', row.listing_url)}
    ${actions.join('')}
    ${owners.join('')}
    <button type="button" data-act="star" data-id="${row.id}">${row.starred ? 'GOOD' : 'MARK GOOD'}</button>
    ${statuses.map((status) => `<button type="button" class="wide${status === 'NO' ? ' dimbtn' : ''}" data-act="status" data-id="${row.id}" data-status="${status}">${status}</button>`).join('')}
    <p class="label">DATE</p>
    <input data-date="${row.id}" value="${L.esc(row.next_followup ? L.showDate(row.next_followup, today) : '')}">
    ${noteHtml}
    <textarea data-note="${row.id}" placeholder="WRITE">${L.esc(state.drafts[row.id] || '')}</textarea>
    <button type="button" data-act="note" data-id="${row.id}">ADD NOTE</button>
  </div></div>`;
  return html;
}

function makerHtml() {
  if (!state.making) return `<button type="button" class="wide" data-act="make">+ NEW PROPERTY</button>`;
  const f = state.form;
  const more = state.more ? `
    <p class="label">ADDRESS</p><input data-form="address" value="${L.esc(f.address || '')}">
    <p class="label">LISTING</p><input data-form="url" value="${L.esc(f.url || '')}">
    <p class="label">BEDS</p><input data-form="beds" value="${L.esc(f.beds || '')}">
    <p class="label">BATHS</p><input data-form="baths" value="${L.esc(f.baths || '')}">` : '';
  return `<div class="fold">
    <p class="label">TITLE</p><input data-form="title" value="${L.esc(f.title || '')}">
    <p class="label">NAME</p><input data-form="name" value="${L.esc(f.name || '')}">
    <p class="label">PHONE</p><input data-form="phone" value="${L.esc(f.phone || '')}">
    <p class="label">EMAIL</p><input data-form="email" value="${L.esc(f.email || '')}">
    <button type="button" data-act="more">${state.more ? 'LESS' : 'MORE'}</button>
    ${more}
    <button type="button" class="wide" data-act="save">SAVE</button>
  </div>`;
}

function paintList() {
  const list = document.querySelector('#list');
  if (!list) return;
  if (list.contains(document.activeElement)) {
    paintQueued = true;
    return;
  }
  paintQueued = false;
  const rows = visibleRows().map(rowHtml).join('');
  list.innerHTML = `${makerHtml()}${rows}`;
  const edit = list.querySelector('[data-edit]');
  if (edit) edit.focus();
}

function paintExtra() {
  const node = document.querySelector('#extra');
  if (!node || node.contains(document.activeElement)) return;
  let importHtml = `<button type="button" class="wide" data-act="pick">IMPORT CSV</button>
    <input class="file" id="file" type="file" accept=".csv,text/csv">`;
  if (state.importer) {
    const { parsed, mapping, plan } = state.importer;
    const maps = parsed.headers.map((header) =>
      `<button type="button" data-act="cycle" data-header="${L.esc(header)}">${L.esc(header)} · ${(mapping[header] || 'ignore').toUpperCase()}</button>`).join('');
    const c = plan.counts;
    importHtml += `${maps}
      <p class="meta">${c.new} NEW · ${c.update} UPDATE · ${c.skip} SKIP · ${c.fix} FIX</p>
      <button type="button" class="wide" data-act="commit">IMPORT</button>`;
  }
  const out = state.outOpen
    ? `<button type="button" class="dimbtn" data-act="out">SIGN OUT</button>`
    : `<button type="button" class="dimbtn" data-act="out-open">MORE</button>`;
  node.innerHTML = `${importHtml}${out}`;
  const file = document.querySelector('#file');
  if (file) file.addEventListener('change', onFile);
}

async function signIn() {
  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password');
  if (!client) {
    renderLock('NOT SAVED — TRY AGAIN');
    return;
  }
  const { error } = await client.auth.signInWithPassword({ email, password: password.value });
  if (error) {
    password.value = '';
    const network = !online() || error.name === 'AuthRetryableFetchError';
    renderLock(network ? 'NOT SAVED — TRY AGAIN' : 'WRONG PASSWORD — TRY AGAIN');
    return;
  }
  await enter();
}

async function enter() {
  shell();
  if (!online()) {
    await restore();
    setBanner('OFFLINE — CAN\'T SAVE', 'offline');
    paint();
    return;
  }
  await load(true);
  listen();
  await flush();
}

async function load(paintNow) {
  if (!client || !online()) return;
  const props = await client.from('properties').select('*');
  const notes = await client.from('notes').select('*');
  if (props.error || notes.error) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    if (!state.rows.length) await restore();
    if (paintNow) paint();
    return;
  }
  state.rows = props.data || [];
  state.notes = groupNotes(notes.data || []);
  const waiting = await queueAll();
  for (const item of waiting) {
    if (!state.notes[item.property_id]) state.notes[item.property_id] = [];
    state.notes[item.property_id].unshift(item);
  }
  await remember();
  if (state.kind === 'offline') setBanner('', '');
  if (paintNow) paint();
  else paint();
}

function listen() {
  if (!client || channel) return;
  channel = client.channel('board')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, schedule)
    .subscribe();
}

let scheduleTimer = 0;
function schedule() {
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => { load(false); }, 300);
}

async function savePatch(row, patch) {
  if (!online()) {
    setBanner('OFFLINE — CAN\'T SAVE', 'offline');
    return false;
  }
  const { data, error } = await client
    .from('properties')
    .update(patch)
    .eq('id', row.id)
    .eq('updated_at', row.updated_at)
    .select();
  if (error) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    return false;
  }
  if (!data || !data.length) {
    setBanner('CHANGED — TAP TO RELOAD', 'changed');
    return false;
  }
  const index = state.rows.findIndex((item) => item.id === row.id);
  if (index >= 0) state.rows[index] = data[0];
  await remember();
  setBanner('SAVED', 'saved');
  return true;
}

async function onClick(event) {
  const node = event.target.closest('[data-act]');
  if (!node) {
    if (event.target.id === 'banner' && state.kind === 'changed') load(true);
    if (event.target.id === 'banner' && state.kind === 'updated') {
      const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (worker) worker.postMessage('reload');
      else location.reload();
    }
    return;
  }
  const act = node.dataset.act;
  const id = node.dataset.id;
  if (act === 'export') return exportCsv();
  if (act === 'filter') {
    state.filter = state.filter === node.dataset.status ? '' : node.dataset.status;
    paintCounts();
    paintList();
    return;
  }
  if (act === 'open') {
    state.openId = state.openId === id ? '' : id;
    state.editing = '';
    paintList();
    return;
  }
  if (act === 'make') {
    state.making = true;
    state.form = {};
    paintList();
    return;
  }
  if (act === 'more') {
    state.more = !state.more;
    paintList();
    return;
  }
  if (act === 'save') return saveNew();
  if (act === 'edit') {
    state.editing = `${id}:${node.dataset.field}`;
    paintList();
    return;
  }
  if (act === 'star') {
    const row = state.rows.find((item) => item.id === id);
    if (row && await savePatch(row, { starred: !row.starred })) paint();
    return;
  }
  if (act === 'status') {
    const row = state.rows.find((item) => item.id === id);
    if (!row) return;
    const today = L.denverToday();
    const patch = { status: node.dataset.status };
    if (patch.status === 'CONTACTED' || patch.status === 'PITCHED') {
      if (!row.next_followup) patch.next_followup = L.addDays(today, 3);
      patch.last_contacted = today;
    }
    if (patch.status === 'SIGNED') {
      patch.last_contacted = today;
      patch.next_followup = null;
    }
    if (patch.status === 'NO' || patch.status === 'NEW') patch.next_followup = null;
    if (await savePatch(row, patch)) paint();
    return;
  }
  if (act === 'note') return addNote(id);
  if (act === 'pick') {
    document.querySelector('#file').click();
    return;
  }
  if (act === 'cycle') return cycle(node.dataset.header);
  if (act === 'commit') return commitImport();
  if (act === 'out-open') {
    state.outOpen = true;
    paintExtra();
    return;
  }
  if (act === 'out') return signOut();
  if (act === 'reload') {
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (worker) worker.postMessage('reload');
    else location.reload();
  }
}

function onInput(event) {
  const form = event.target.dataset.form;
  if (form) state.form[form] = event.target.value;
  const note = event.target.dataset.note;
  if (note) state.drafts[note] = event.target.value;
}

async function onBlur(event) {
  const edit = event.target.dataset.edit;
  if (edit) {
    const [id, field] = edit.split(':');
    const row = state.rows.find((item) => item.id === id);
    state.editing = '';
    if (row && event.target.value !== (row[field] || '')) {
      const value = event.target.value.trim();
      await savePatch(row, { [field]: value || null });
    }
    paint();
    return;
  }
  const dateId = event.target.dataset.date;
  if (dateId) {
    const row = state.rows.find((item) => item.id === dateId);
    if (!row) return;
    const parsed = L.parseDate(event.target.value, L.denverToday());
    if (parsed === null) {
      setBanner('NOT SAVED — TRY AGAIN', 'error');
      return;
    }
    const next = parsed || null;
    if ((row.next_followup || null) !== next) {
      if (await savePatch(row, { next_followup: next })) paint();
    }
  }
  const next = event.relatedTarget;
  const list = document.querySelector('#list');
  if (paintQueued && (!next || !list || !list.contains(next))) paintList();
}

function onKey(event) {
  if (event.key === 'Escape' && state.editing) {
    state.editing = '';
    paintList();
  }
  if (event.key === 'Enter' && event.target.dataset && event.target.dataset.edit) {
    event.target.blur();
  }
}

async function saveNew() {
  document.querySelectorAll('[data-form]').forEach((el) => {
    state.form[el.dataset.form] = el.value;
  });
  const title = (state.form.title || '').trim();
  if (!title) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    return;
  }
  if (!online()) {
    setBanner('OFFLINE — CAN\'T SAVE', 'offline');
    return;
  }
  const payload = {
    listing_title: title.slice(0, 500),
    owner_name: (state.form.name || '').trim() || null,
    owner_phone: (state.form.phone || '').trim() || null,
    owner_email: (state.form.email || '').trim().toLowerCase() || null,
    address: (state.form.address || '').trim() || null,
    listing_url: (state.form.url || '').trim() || null,
    source: 'manual',
  };
  if (state.form.beds) payload.beds = Math.round(Number(state.form.beds));
  if (state.form.baths) payload.baths = Math.round(Number(state.form.baths) * 10) / 10;
  if (payload.listing_url) payload.source_key = L.sourceKey(payload.listing_url);
  const { data, error } = await client.from('properties').insert(payload).select();
  if (error || !data || !data.length) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    return;
  }
  state.rows.push(data[0]);
  state.making = false;
  state.form = {};
  state.openId = data[0].id;
  await remember();
  setBanner('SAVED', 'saved');
  paint();
}

async function addNote(id) {
  const body = (state.drafts[id] || '').trim();
  if (!body) return;
  if (body.length > 2000) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    return;
  }
  const local = {
    id: `local-${crypto.randomUUID()}`,
    property_id: id,
    body,
    waiting: true,
    created_at: new Date().toISOString(),
  };
  if (!online()) {
    await queueAdd(local);
    if (!state.notes[id]) state.notes[id] = [];
    state.notes[id].unshift(local);
    state.drafts[id] = '';
    setBanner('OFFLINE — CAN\'T SAVE', 'offline');
    paint();
    return;
  }
  const { data, error } = await client.from('notes').insert({ property_id: id, body }).select();
  if (error || !data || !data.length) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    return;
  }
  if (!state.notes[id]) state.notes[id] = [];
  state.notes[id].unshift(data[0]);
  state.drafts[id] = '';
  await remember();
  setBanner('SAVED', 'saved');
  paint();
}

async function flush() {
  if (!online() || !client) return;
  const queued = await queueAll();
  for (const item of queued) {
    const { error } = await client.from('notes').insert({
      property_id: item.property_id,
      body: item.body,
    }).select();
    if (error) {
      setBanner('NOT SAVED — TRY AGAIN', 'error');
      return;
    }
    await queueDrop(item.id);
  }
  if (queued.length) await load(true);
}

function exportCsv() {
  const csv = L.toCsv(L.sortRows(state.rows, L.denverToday()), state.notes);
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = '10xbnb.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function onFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && file.type && !/csv|text/.test(file.type)) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    return;
  }
  const parsed = L.parseCsv(await file.text());
  if (parsed.error) {
    setBanner('NOT SAVED — TRY AGAIN', 'error');
    return;
  }
  const mapping = {};
  for (const header of parsed.headers) mapping[header] = L.suggestMap(header);
  const plan = L.planImport(rowsForPlan(), parsed, mapping, L.denverToday());
  state.importer = { parsed, mapping, plan };
  paintExtra();
}

function rowsForPlan() {
  return state.rows.map((row) => ({
    ...row,
    notes: (state.notes[row.id] || []).map((note) => note.body),
  }));
}

function cycle(header) {
  if (!state.importer) return;
  const current = state.importer.mapping[header] || 'ignore';
  const index = L.CYCLE.indexOf(current);
  state.importer.mapping[header] = L.CYCLE[(index + 1) % L.CYCLE.length];
  state.importer.plan = L.planImport(
    rowsForPlan(),
    state.importer.parsed,
    state.importer.mapping,
    L.denverToday(),
  );
  paintExtra();
}

async function commitImport() {
  const view = state.importer;
  if (!view) return;
  if (!online()) {
    setBanner('OFFLINE — CAN\'T SAVE', 'offline');
    return;
  }
  const plan = view.plan;
  if (!plan.write) {
    const c = plan.counts;
    setBanner(`IMPORTED ${c.new} · UPDATED ${c.update} · SKIPPED ${c.skip} · ${c.fix} FIX`, 'saved');
    return;
  }
  const batch = crypto.randomUUID();
  let imported = 0;
  let updated = 0;
  let failed = false;
  for (const item of plan.items) {
    if (item.action === 'new') {
      const payload = { ...item.patch, import_batch_id: batch, source: item.patch.source || 'csv' };
      const { data, error } = await client.from('properties').insert(payload).select();
      if (error || !data || !data.length) { failed = true; break; }
      imported += 1;
      for (const body of item.notes || []) {
        const note = await client.from('notes').insert({ property_id: data[0].id, body }).select();
        if (note.error) { failed = true; break; }
      }
    } else if (item.action === 'update') {
      const row = state.rows.find((entry) => entry.id === item.id);
      if (!row) { failed = true; break; }
      if (Object.keys(item.patch).length) {
        const { data, error } = await client.from('properties')
          .update(item.patch).eq('id', row.id).eq('updated_at', row.updated_at).select();
        if (error || !data || !data.length) { failed = true; break; }
        const index = state.rows.findIndex((entry) => entry.id === row.id);
        if (index >= 0) state.rows[index] = data[0];
      }
      updated += 1;
      for (const body of item.notes || []) {
        const note = await client.from('notes').insert({ property_id: item.id, body }).select();
        if (note.error) { failed = true; break; }
      }
    }
    if (failed) break;
  }
  state.importer = null;
  await load(true);
  const c = plan.counts;
  const line = `IMPORTED ${imported} · UPDATED ${updated} · SKIPPED ${c.skip} · ${c.fix} FIX`;
  setBanner(failed ? 'NOT SAVED — TRY AGAIN' : line, failed ? 'error' : 'saved');
  if (!failed) paintExtra();
}

async function signOut() {
  if (channel && client) await client.removeChannel(channel);
  channel = null;
  if (client) await client.auth.signOut();
  await wipeLocal();
  state.rows = [];
  state.notes = {};
  state.openId = '';
  state.importer = null;
  if (phoneBrowser()) renderPhone();
  else renderLock();
}

function watchUpdate() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          state.updated = true;
          setBanner('UPDATED — TAP TO RELOAD', 'updated');
        }
      });
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  navigator.serviceWorker.addEventListener('message', () => {});
}

window.addEventListener('online', () => { flush(); });
window.addEventListener('offline', () => setBanner('OFFLINE — CAN\'T SAVE', 'offline'));

async function boot() {
  watchUpdate();
  if (phoneBrowser()) {
    renderPhone();
    return;
  }
  if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase) {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  renderLock();
  if (!client) return;
  const { data } = await client.auth.getSession();
  if (data.session) await enter();
}

boot();
