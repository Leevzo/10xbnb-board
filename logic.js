const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export const STATUSES = ['NEW', 'CONTACTED', 'PITCHED', 'SIGNED', 'NO'];
export const ACTIVE = ['NEW', 'CONTACTED', 'PITCHED'];
export const CYCLE = [
  'ignore', 'title', 'url', 'name', 'phone', 'email', 'note', 'address',
  'status', 'starred', 'date', 'followup', 'city', 'state', 'zip',
  'beds', 'baths', 'key', 'source',
];

const FILL = [
  ['title', 'listing_title'],
  ['url', 'listing_url'],
  ['address', 'address'],
  ['city', 'city'],
  ['state', 'state'],
  ['zip', 'zip'],
  ['name', 'owner_name'],
  ['phone', 'owner_phone'],
  ['email', 'owner_email'],
  ['beds', 'beds'],
  ['baths', 'baths'],
  ['source', 'source'],
];

function rotr(n, x) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256(message) {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const pad = (64 - ((bytes.length + 1 + 8) % 64)) % 64;
  const data = new Uint8Array(bytes.length + 1 + pad + 8);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(data.length - 4, bitLen >>> 0);

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

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < data.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
      const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[t] + w[t]) >>> 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

export function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return trimmed;
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`;
}

export function normText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function sourceKey(url) {
  const n = normalizeUrl(url);
  return n ? sha256(n) : '';
}

export function titleKey(title, name) {
  return sha256(`title\n${normText(title)}\n${normText(name)}`);
}

export function last10(value) {
  const d = String(value || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function denverToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function parseDate(input, today) {
  const s = String(input || '').trim();
  if (!s) return '';
  let y = null;
  let m;
  let d;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const named = /^([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?$/i.exec(s);
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (iso) {
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  } else if (named) {
    m = MONTHS[named[1].toLowerCase()];
    d = +named[2];
    y = named[3] ? +named[3] : null;
  } else if (slash) {
    m = +slash[1]; d = +slash[2];
    y = slash[3] ? +slash[3] : null;
    if (y != null && y < 100) y += 2000;
  } else {
    return null;
  }
  if (!m || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y == null) {
    const [ty, tm, td] = today.split('-').map(Number);
    y = ty;
    if (m < tm || (m === tm && d < td)) y += 1;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const SHOW = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function showDate(iso, today) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const word = `${SHOW[m - 1]} ${d}`;
  if (today && today.slice(0, 4) !== String(y)) return `${word} ${y}`;
  return word;
}

export function sheetStatus(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('not interested')) return 'NO';
  if (s === 'no') return 'NO';
  if (s.includes('interest') || s === 'pitched') return 'PITCHED';
  if (s === 'signed') return 'SIGNED';
  if (s === 'new') return 'NEW';
  if (
    s === 'contacted'
    || s.includes('voicemail')
    || s.includes('email')
    || s.includes('conversation')
    || s.includes('called')
  ) return 'CONTACTED';
  return null;
}

export function isStarred(value) {
  const s = String(value || '').trim().toLowerCase();
  return s === '1' || s === 'y' || s === 'yes' || s === 'true' || s === 'good' || s === 'starred';
}

export function suggestMap(header) {
  const h = String(header || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!h) return 'ignore';
  if (/address|street|zip|postal|city|state|region|country/.test(h)) return 'ignore';
  if (/e-?mail/.test(h)) return 'email';
  if (/phone|mobile|\btel\b/.test(h)) return 'phone';
  if (/star|good one/.test(h)) return 'starred';
  if (/follow/.test(h)) return 'followup';
  if (/note/.test(h)) return 'note';
  if (/\bstatus\b/.test(h)) return 'status';
  if (/^date$|last contact/.test(h)) return 'date';
  if (/source_key|^key$/.test(h)) return 'key';
  if (/url|\blink\b|http/.test(h)) return 'url';
  if (/^beds?$/.test(h)) return 'beds';
  if (/^baths?$/.test(h)) return 'baths';
  if (/title|headline|listing|zillow|craigslist/.test(h)) return 'title';
  if (/^name$|owner|landlord/.test(h)) return 'name';
  if (/^source$/.test(h)) return 'source';
  return 'ignore';
}

export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const cleaned = rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  if (!cleaned.length) return { error: 'empty' };
  const headers = cleaned[0].map((h) => h.trim());
  if (headers.some((h) => !h)) return { error: 'blank header' };
  const seen = new Set();
  for (const h of headers) {
    const k = h.toLowerCase();
    if (seen.has(k)) return { error: `duplicate header ${h}` };
    seen.add(k);
  }
  const body = cleaned.slice(1).map((r) => headers.map((_, i) => String(r[i] || '').trim()));
  return { headers, rows: body };
}

function readRecord(headers, cells, mapping) {
  const rec = {};
  const notes = [];
  headers.forEach((header, i) => {
    const field = mapping[header] || 'ignore';
    const val = cells[i] || '';
    if (!val || field === 'ignore') return;
    if (field === 'note') notes.push(val);
    else if (rec[field] == null) rec[field] = field === 'email' ? val.toLowerCase() : val;
    else notes.push(val);
  });
  return { rec, notes };
}

function numberOrNull(value, baths) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return baths ? Math.round(n * 10) / 10 : Math.round(n);
}

export function planImport(existing, parsed, mapping, today) {
  const counts = { new: 0, update: 0, skip: 0, fix: 0, sameOwner: 0 };
  const items = [];
  const byKey = new Map();
  const phones = new Map();
  for (const row of existing) {
    if (row.source_key) byKey.set(row.source_key, row);
    const p = last10(row.owner_phone);
    if (p) {
      if (!phones.has(p)) phones.set(p, new Set());
      phones.get(p).add(row.source_key);
    }
  }
  const seenInFile = new Set();

  for (const cells of parsed.rows) {
    if (cells.every((c) => !c)) { counts.skip += 1; continue; }
    const { rec, notes } = readRecord(parsed.headers, cells, mapping);
    const url = rec.url ? normalizeUrl(rec.url) : '';
    let key = '';
    if (url) key = sourceKey(url);
    else if (rec.key && /^[0-9a-f]{64}$/i.test(rec.key)) key = rec.key.toLowerCase();
    else if (rec.title) key = titleKey(rec.title, rec.name || '');
    if (!key) {
      counts.fix += 1;
      items.push({ action: 'fix', notes, rec });
      continue;
    }
    const repeat = seenInFile.has(key);
    seenInFile.add(key);

    const phone = last10(rec.phone);
    const owners = phone ? phones.get(phone) : null;
    const sameOwner = !!(owners && [...owners].some((k) => k !== key));
    if (sameOwner) counts.sameOwner += 1;

    const match = byKey.get(key);
    if (repeat && match && match._item && match._item.action === 'new') {
      const item = match._item;
      if (url && !item.patch.listing_url) item.patch.listing_url = url;
      if (rec.title && !item.patch.listing_title) item.patch.listing_title = rec.title.slice(0, 500);
      for (const [from, to] of FILL) {
        if (from === 'title' || from === 'url' || !rec[from] || item.patch[to]) continue;
        item.patch[to] = from === 'email' ? rec[from].toLowerCase() : rec[from];
      }
      if (isStarred(rec.starred)) item.patch.starred = true;
      for (const n of notes) {
        if (!item.notes.includes(n)) item.notes.push(n);
      }
      const rank = { NEW: 0, CONTACTED: 1, PITCHED: 2, SIGNED: 3, NO: 4 };
      const incoming = sheetStatus(rec.status);
      if (incoming && rank[incoming] > rank[item.patch.status]) item.patch.status = incoming;
      counts.skip += 1;
      continue;
    }
    if (!match) {
      const patch = {
        source_key: key,
        listing_title: (rec.title || rec.name || 'LISTING').slice(0, 500),
        status: sheetStatus(rec.status) || 'NEW',
        starred: isStarred(rec.starred),
      };
      if (url) patch.listing_url = url;
      for (const [from, to] of FILL) {
        if (from === 'title' || from === 'url') continue;
        if (rec[from]) patch[to] = from === 'email' ? rec[from].toLowerCase() : rec[from];
      }
      if (patch.beds != null) {
        const n = numberOrNull(patch.beds, false);
        if (n == null) delete patch.beds; else patch.beds = n;
      }
      if (patch.baths != null) {
        const n = numberOrNull(patch.baths, true);
        if (n == null) delete patch.baths; else patch.baths = n;
      }
      const contacted = parseDate(rec.date, today);
      const follow = parseDate(rec.followup, today);
      if (contacted) patch.last_contacted = contacted;
      if (follow) patch.next_followup = follow;
      if (patch.status === 'CONTACTED' || patch.status === 'PITCHED') {
        if (!patch.next_followup) patch.next_followup = addDays(today, 3);
        if (!patch.last_contacted) patch.last_contacted = today;
      }
      const item = { action: 'new', source_key: key, patch, notes, sameOwner };
      counts.new += 1;
      items.push(item);
      byKey.set(key, {
        ...patch,
        source_key: key,
        notes: [...notes],
        owner_phone: patch.owner_phone || '',
        _item: item,
      });
      if (phone) {
        if (!phones.has(phone)) phones.set(phone, new Set());
        phones.get(phone).add(key);
      }
      continue;
    }

    const patch = {};
    if (url && !match.listing_url) patch.listing_url = url;
    if (rec.title && !match.listing_title) patch.listing_title = rec.title.slice(0, 500);
    for (const [from, to] of FILL) {
      if (from === 'title' || from === 'url') continue;
      if (!rec[from]) continue;
      if (match[to] != null && String(match[to]).trim() !== '') continue;
      if (from === 'beds' || from === 'baths') {
        const n = numberOrNull(rec[from], from === 'baths');
        if (n == null) continue;
        patch[to] = n;
      } else patch[to] = from === 'email' ? rec[from].toLowerCase() : rec[from];
    }
    if (isStarred(rec.starred) && !match.starred) patch.starred = true;
    if (!match.last_contacted) {
      const contacted = parseDate(rec.date, today);
      if (contacted) patch.last_contacted = contacted;
    }
    if (!match.next_followup) {
      const follow = parseDate(rec.followup, today);
      if (follow) patch.next_followup = follow;
    }
    const have = new Set(match.notes || []);
    const fresh = notes.filter((n) => !have.has(n));
    if (!Object.keys(patch).length && !fresh.length) {
      counts.skip += 1;
      items.push({ action: 'skip', source_key: key, sameOwner });
      continue;
    }
    counts.update += 1;
    items.push({ action: 'update', id: match.id, source_key: key, patch, notes: fresh, sameOwner });
  }

  return {
    counts,
    items,
    write: counts.new + counts.update > 0,
  };
}

export function isDue(row, today) {
  if (!row || row.status === 'SIGNED' || row.status === 'NO') return false;
  return !!(row.next_followup && row.next_followup <= today);
}

const STAGE = { NEW: 1, CONTACTED: 2, PITCHED: 3, SIGNED: 4, NO: 5 };

export function sortRows(rows, today) {
  return [...rows].sort((a, b) => {
    const ad = isDue(a, today) ? 0 : 1;
    const bd = isDue(b, today) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    if (ad === 0) {
      if (a.next_followup !== b.next_followup) return a.next_followup < b.next_followup ? -1 : 1;
      if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
      return (STAGE[a.status] || 9) - (STAGE[b.status] || 9);
    }
    const stage = (STAGE[a.status] || 9) - (STAGE[b.status] || 9);
    if (stage) return stage;
    if (a.status === 'NEW' && !!a.starred !== !!b.starred) return a.starred ? -1 : 1;
    const af = a.next_followup || '9999-99-99';
    const bf = b.next_followup || '9999-99-99';
    if (af !== bf) return af < bf ? -1 : 1;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
}

export function escapeCsvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, notesById) {
  const headers = [
    'listing_title', 'address', 'city', 'state', 'zip', 'listing_url', 'report_url',
    'owner_name', 'owner_phone', 'owner_email', 'status', 'starred',
    'last_contacted', 'next_followup', 'source', 'source_key', 'notes',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    const notes = (notesById[row.id] || []).map((n) => n.body).join('\n');
    const values = [
      row.listing_title, row.address, row.city, row.state, row.zip,
      row.listing_url, row.report_url, row.owner_name, row.owner_phone, row.owner_email,
      row.status, row.starred ? 'yes' : '', row.last_contacted, row.next_followup,
      row.source, row.source_key, notes,
    ];
    lines.push(values.map(escapeCsvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function countsOf(rows, today) {
  const counts = { DUE: 0, NEW: 0, CONTACTED: 0, PITCHED: 0, SIGNED: 0, NO: 0 };
  for (const row of rows) {
    if (counts[row.status] != null) counts[row.status] += 1;
    if (isDue(row, today)) counts.DUE += 1;
  }
  return counts;
}

export function matchesQuery(row, notes, q) {
  const needle = normText(q);
  if (!needle) return true;
  const hay = [
    row.listing_title, row.address, row.city, row.owner_name,
    row.owner_phone, row.owner_email, row.listing_url,
    ...(notes || []).map((n) => n.body),
  ].map(normText).join('\n');
  return hay.includes(needle);
}
