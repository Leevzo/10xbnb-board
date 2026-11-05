import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256, normalizeUrl, sourceKey, titleKey, parseCsv, parseDate, planImport,
  sortRows, escapeCsvCell, suggestMap, sheetStatus, esc, toCsv, isDue, addDays,
} from '../logic.js';

const TODAY = '2026-11-05';
const SAMPLE = 'HTTPS://WWW.Zillow.COM/homedetails/Example/123_zpid/';

test('sha256 matches the known vectors', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('listing url keeps path case and drops the trailing slash', () => {
  const n = normalizeUrl(SAMPLE);
  assert.equal(n, 'https://www.zillow.com/homedetails/Example/123_zpid');
  assert.equal(sourceKey(SAMPLE), createHash('sha256').update(n).digest('hex'));
  assert.equal(sourceKey(`${SAMPLE}?x=1`), sourceKey('https://www.zillow.com/homedetails/Example/123_zpid?x=1'));
});

test('Nov 12 with no year is the next occurrence', () => {
  assert.equal(parseDate('Nov 12', '2026-11-05'), '2026-11-12');
  assert.equal(parseDate('Nov 12', '2026-11-12'), '2026-11-12');
  assert.equal(parseDate('Nov 12', '2026-11-20'), '2027-11-12');
  assert.equal(parseDate('11/12', '2026-11-20'), '2027-11-12');
  assert.equal(parseDate('2024-01-02', TODAY), '2024-01-02');
  assert.equal(parseDate('Feb 31', TODAY), null);
  assert.equal(parseDate('', TODAY), '');
});

test('a shared phone does not merge two listings', () => {
  const urlA = 'https://www.zillow.com/homedetails/A/1_zpid/';
  const urlB = 'https://www.zillow.com/homedetails/B/2_zpid/';
  const existing = [{
    id: 'a', source_key: sourceKey(urlA), listing_url: normalizeUrl(urlA),
    listing_title: 'A', owner_phone: '(801) 555-0100', owner_name: 'Ada',
    status: 'NEW', starred: false, notes: [],
  }];
  const csv = parseCsv([
    'title,url,phone',
    `B,${urlB},801-555-0100`,
    `A2,${urlA},`,
  ].join('\n'));
  const plan = planImport(existing, csv, {
    title: 'title', url: 'url', phone: 'phone',
  }, TODAY);
  assert.equal(plan.counts.new, 1);
  assert.equal(plan.counts.update, 0);
  assert.equal(plan.counts.sameOwner, 1);
  assert.equal(plan.items[0].patch.listing_title, 'B');
  assert.notEqual(plan.items[0].source_key, existing[0].source_key);
});

test('the same file twice adds nothing', () => {
  const url = 'https://www.craigslist.org/view/one';
  const csv = parseCsv(`title,url,phone,note\nHouse,${url},8015550199,CTS\n`);
  const map = { title: 'title', url: 'url', phone: 'phone', note: 'note' };
  const first = planImport([], csv, map, TODAY);
  assert.equal(first.counts.new, 1);
  const stored = [{
    id: '1',
    ...first.items[0].patch,
    notes: ['CTS'],
  }];
  const second = planImport(stored, csv, map, TODAY);
  assert.equal(second.counts.new, 0);
  assert.equal(second.counts.update, 0);
  assert.equal(second.counts.skip, 1);
  assert.equal(second.write, false);
});

test('a blank phone does not wipe a filled phone and status stays', () => {
  const url = 'https://www.zillow.com/homedetails/C/3_zpid';
  const existing = [{
    id: 'c', source_key: sourceKey(url), listing_url: normalizeUrl(url),
    listing_title: 'C', owner_phone: '801-555-0133', status: 'PITCHED',
    starred: true, notes: [],
  }];
  const csv = parseCsv(`title,url,phone,status\nC,${url},,NO\n`);
  const plan = planImport(existing, csv, {
    title: 'title', url: 'url', phone: 'phone', status: 'status',
  }, TODAY);
  assert.equal(plan.counts.skip, 1);
  assert.equal(plan.items[0].patch, undefined);
});

test('a mailing-list street column is not a property', () => {
  assert.equal(suggestMap('Address 1 - Street'), 'ignore');
  assert.equal(suggestMap('street'), 'ignore');
  assert.equal(suggestMap('Zillow Listing'), 'title');
  assert.equal(suggestMap('listing_url'), 'url');
  const csv = parseCsv('First Name,Email 1,Address 1 - Street\nAda,ada@example.com,1 Main\n');
  const mapping = Object.fromEntries(csv.headers.map((h) => [h, suggestMap(h)]));
  const plan = planImport([], csv, mapping, TODAY);
  assert.equal(plan.counts.fix, 1);
  assert.equal(plan.counts.new, 0);
  assert.equal(plan.write, false);
});

test('quoted commas, a bom, and formula cells', () => {
  const csv = parseCsv('\uFEFFtitle,url\n"House, one",https://example.com/a\n');
  assert.equal(csv.rows[0][0], 'House, one');
  assert.equal(parseCsv('title,title\nA,B\n').error, 'duplicate header title');
  assert.equal(escapeCsvCell('=cmd'), "'=cmd");
  assert.equal(escapeCsvCell('+1'), "'+1");
  assert.equal(escapeCsvCell('-1'), "'-1");
  assert.equal(escapeCsvCell('@a'), "'@a");
  const file = toCsv([{
    id: '1', listing_title: '=HYPERLINK', address: '', city: '', state: '', zip: '',
    listing_url: 'https://example.com/a', report_url: '', owner_name: '', owner_phone: '',
    owner_email: '', status: 'NEW', starred: false, last_contacted: '', next_followup: '',
    source: '', source_key: 'abc',
  }], { 1: [{ body: 'line\none' }] });
  assert.match(file, /'=HYPERLINK/);
  assert.match(file, /"line\none"/);
});

test('sheet words become the five stages', () => {
  assert.equal(sheetStatus('Called/left voicemail'), 'CONTACTED');
  assert.equal(sheetStatus('Sent Email'), 'CONTACTED');
  assert.equal(sheetStatus('Had conversation'), 'CONTACTED');
  assert.equal(sheetStatus('Interested'), 'PITCHED');
  assert.equal(sheetStatus('Not Interested'), 'NO');
  assert.equal(sheetStatus('Good one'), null);
});

test('due floats, then stage, and good ones lead NEW', () => {
  const rows = [
    { id: '1', status: 'NEW', starred: false, next_followup: null, updated_at: '2026-11-01' },
    { id: '2', status: 'NEW', starred: true, next_followup: null, updated_at: '2026-10-01' },
    { id: '3', status: 'PITCHED', starred: false, next_followup: '2026-11-01', updated_at: '2026-11-02' },
    { id: '4', status: 'CONTACTED', starred: false, next_followup: '2026-11-08', updated_at: '2026-11-03' },
    { id: '5', status: 'SIGNED', starred: true, next_followup: '2026-11-01', updated_at: '2026-11-04' },
    { id: '6', status: 'NO', starred: false, next_followup: null, updated_at: '2026-11-04' },
    { id: '7', status: 'CONTACTED', starred: false, next_followup: '2026-11-04', updated_at: '2026-11-01' },
  ];
  assert.deepEqual(sortRows(rows, TODAY).map((r) => r.id), ['3', '7', '2', '1', '4', '5', '6']);
  assert.equal(isDue(rows[4], TODAY), false);
  assert.equal(addDays(TODAY, 3), '2026-11-08');
});

test('a note cannot become markup', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('two titles without a url stay two properties', () => {
  const a = titleKey('House A', 'Ada');
  const b = titleKey('House B', 'Ada');
  assert.notEqual(a, b);
  assert.equal(a, titleKey('  house   a ', 'ada'));
});

test('the page chrome stays flat', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /gradient/i);
  for (const found of css.matchAll(/border-radius:\s*([^;]+)/g)) assert.equal(found[1].trim(), '0');
  for (const found of css.matchAll(/box-shadow:\s*([^;]+)/g)) assert.equal(found[1].trim(), 'none');
  assert.match(css, /outline:\s*2px solid var\(--gold\)/);
});

test('the schema does not hand the audit log to the client', () => {
  const sql = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /private\.can_write\(\)/);
  assert.match(sql, /private\.can_read\(\)/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /source_key text not null unique/);
  assert.match(sql, /signup closed/);
  assert.doesNotMatch(sql, /for delete/i);
  assert.doesNotMatch(sql, /grant insert on public\.activity/i);
  assert.doesNotMatch(sql, /grant update on public\.activity/i);
  assert.doesNotMatch(sql, /grant update on public\.notes/i);
  assert.match(sql, /status in \('NEW','CONTACTED','PITCHED','SIGNED','NO'\)/);
  assert.doesNotMatch(sql, /FOLLOW-UP/);
  assert.doesNotMatch(sql, /@/);
});
