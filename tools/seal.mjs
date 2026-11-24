#!/usr/bin/env node
// Seals July into one file. Two halves open it: the link, and a number code.
// The link half is made here. The code is typed by the King and never stored.
// Neither half alone opens the file. Prints counts only, never a name or a phone.
//
//   node tools/seal.mjs                 reads ~/Downloads/Leads.xlsx through seed.py
//   node tools/seal.mjs --stdin --out X reads [{...property, notes:[]}] JSON on stdin
//   node tools/seal.mjs --keep          seals again with the same key: same link, same code

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : '';
};
const out = flag('--out') || join(here, '..', 'july', 'july.sealed');
const base = flag('--base') || 'https://leevzo.github.io/10xbnb-board/july/';

const PY = `
import json, sys
from datetime import datetime
import seed
records = seed.load_rows(seed.os.environ.get("LEADS_XLSX", seed.os.path.expanduser("~/Downloads/Leads.xlsx")))
props, notes = seed.build(records, datetime.now().date().isoformat())
rows = []
for p, n in zip(props, notes):
    row = {k: v for k, v in p.items() if v is not None and k != "source_key"}
    row["notes"] = n
    rows.append(row)
json.dump(rows, sys.stdout)
`;

let text;
if (args.includes('--stdin')) {
  text = readFileSync(0, 'utf8');
} else {
  text = execFileSync('/usr/bin/python3', ['-c', PY], {
    cwd: here,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const rows = JSON.parse(text);
if (!Array.isArray(rows) || !rows.length) throw new Error('no rows');

const ITER = 600000;

function ask(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) return reject(new Error('needs a terminal to ask for the code'));
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    let typed = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.pause();
          input.off('data', onData);
          process.stdout.write('\n');
          return resolve(typed);
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') {
          if (typed) { typed = typed.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (/[0-9]/.test(ch)) {
          typed += ch;
          process.stdout.write('*');
        }
      }
    };
    input.on('data', onData);
  });
}

async function code() {
  if (args.includes('--stdin')) {
    const test = process.env.SEAL_TEST_CODE || '';
    if (!/^[0-9]{4,}$/.test(test)) throw new Error('--stdin is for made-up rows and needs SEAL_TEST_CODE');
    return test;
  }
  for (;;) {
    const first = await ask('Type the number code for the door (numbers only, 4 or more), then return: ');
    if (first.length < 4) { console.log('Too short. Four numbers or more.'); continue; }
    const again = await ask('Once more: ');
    if (first === again) return first;
    console.log('Those two did not match. Again.');
  }
}

// --keep: seal again with the SAME key, so the link already sent and every
// phone that already opened the list keep working. The link half comes from
// the old link, the salt from the old file, and the code must open the old
// file before anything is written.
const keep = args.includes('--keep');

function askLine(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) return reject(new Error('needs a terminal to ask for the link'));
    process.stdout.write(label);
    input.setRawMode(true);
    input.resume();
    let typed = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false);
          input.pause();
          input.off('data', onData);
          process.stdout.write('\n');
          return resolve(typed);
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else if (ch >= ' ') typed += ch;
      }
    };
    input.on('data', onData);
  });
}

async function oldHalf() {
  const file = flag('--link-file');
  const text = file ? readFileSync(file, 'utf8') : await askLine('Paste the link you sent Lon, then return (it will not show): ');
  const tail = (text.trim().split('#')[1] || '').split('~')[0];
  const bytes = new Uint8Array(Buffer.from(tail, 'base64url'));
  if (bytes.length !== 32) throw new Error('that is not the whole link. Nothing was changed.');
  return bytes;
}

let old = null;
let half;
let salt;
if (keep) {
  old = new Uint8Array(readFileSync(out));
  half = await oldHalf();
  salt = old.slice(0, 16);
} else {
  half = webcrypto.getRandomValues(new Uint8Array(32));
  salt = webcrypto.getRandomValues(new Uint8Array(16));
}

async function onePin() {
  if (!keep || args.includes('--stdin')) return code();
  for (;;) {
    const typed = await ask('Type the number code for the door, then return: ');
    if (typed.length >= 4) return typed;
    console.log('Too short. Four numbers or more.');
  }
}

const pin = await onePin();
const body = new TextEncoder().encode(JSON.stringify({ made: new Date().toLocaleDateString('en-CA'), rows }));
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const mix = new Uint8Array(half.length + salt.length);
mix.set(half, 0);
mix.set(salt, half.length);
const base_key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
const key = await webcrypto.subtle.deriveKey(
  { name: 'PBKDF2', hash: 'SHA-256', salt: mix, iterations: ITER },
  base_key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
);
if (keep) {
  let before;
  try {
    const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: old.slice(16, 28) }, key, old.slice(28));
    before = JSON.parse(new TextDecoder().decode(plain)).rows || [];
  } catch {
    console.log('That link and code do not open the list as it stands. Nothing was changed.');
    process.exit(1);
  }
  const was = new Map(before.map((row) => [row.id || row.listing_url, row.owner_phone || '']));
  let mended = 0;
  let gone = 0;
  for (const row of rows) {
    const id = row.id || row.listing_url;
    if (was.has(id) && was.get(id) !== (row.owner_phone || '')) mended += 1;
    was.delete(id);
  }
  gone = was.size;
  console.log(`opened the old list: ${before.length} rows`);
  console.log(`phones changed ${mended}`);
  console.log(`rows no longer present ${gone}`);
}
const sealed = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
const file = new Uint8Array(salt.length + iv.length + sealed.length);
file.set(salt, 0);
file.set(iv, salt.length);
file.set(sealed, salt.length + iv.length);
writeFileSync(out, file);

const link = `${base}#${Buffer.from(half).toString('base64url')}`;
const linkOut = flag('--link-out');
if (linkOut) writeFileSync(linkOut, `${link}\n`, { mode: 0o600 });
console.log(`rows ${rows.length}`);
console.log(`bytes ${file.length}`);
if (keep) console.log('SEALED AGAIN with the same key. The link already sent still opens it. Go back to Orv.');
else console.log(linkOut ? 'SEALED. The door has its code. Go back to Orv.' : `link ${link}`);
