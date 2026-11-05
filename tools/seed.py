#!/usr/bin/python3
"""Read July from Leads.xlsx and load properties.

Dry-run prints counts only. --commit writes through a normal login.
The password stays in the environment. Nothing here is the lead sheet.
"""

import hashlib
import json
import os
import re
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from urllib.parse import urlsplit

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

SAMPLE = "HTTPS://WWW.Zillow.COM/homedetails/Example/123_zpid/"
SAMPLE_OUT = "https://www.zillow.com/homedetails/Example/123_zpid"


def normalize_url(raw):
    raw = (raw or "").strip()
    if not raw:
        return ""
    parts = urlsplit(raw)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return raw
    path = parts.path or ""
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}{path}{query}"


def source_key(url):
    return hashlib.sha256(normalize_url(url).encode()).hexdigest()


def self_test():
    got = normalize_url(SAMPLE)
    if got != SAMPLE_OUT:
        raise SystemExit(f"normalize mismatch: {got}")
    digest = hashlib.sha256(b"abc").hexdigest()
    if digest != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad":
        raise SystemExit("sha mismatch")


def last10(value):
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else ""


def sheet_status(value):
    s = (value or "").strip().lower()
    if not s:
        return None
    if "not interested" in s:
        return "NO"
    if "interest" in s:
        return "PITCHED"
    if any(w in s for w in ("voicemail", "email", "conversation", "called")):
        return "CONTACTED"
    return None


def parse_address(title):
    text = re.sub(r"\s*\|\s*Zillow\s*$", "", title or "", flags=re.I).strip()
    match = re.match(
        r"^(\d+\s+.+?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:,\s*USA)?$",
        text,
    )
    if not match:
        return {}
    return {
        "address": match.group(1),
        "city": match.group(2),
        "state": match.group(3),
        "zip": match.group(4),
    }


def excel_date(value):
    if not value:
        return None
    try:
        serial = float(value)
    except ValueError:
        return None
    if serial < 20000 or serial > 80000:
        return None
    day = datetime(1899, 12, 30) + timedelta(days=serial)
    return day.date().isoformat()


def load_rows(path):
    book = zipfile.ZipFile(path)
    shared = []
    root = ET.fromstring(book.read("xl/sharedStrings.xml"))
    for si in root.findall("m:si", NS):
        shared.append("".join(t.text or "" for t in si.iter(M + "t")))
    rels = {}
    rel_root = ET.fromstring(book.read("xl/worksheets/_rels/sheet1.xml.rels"))
    for rel in rel_root:
        rels[rel.attrib.get("Id")] = rel.attrib.get("Target", "")
    sheet = ET.fromstring(book.read("xl/worksheets/sheet1.xml"))
    links = {}
    for hy in sheet.findall("m:hyperlinks/m:hyperlink", NS):
        links[hy.attrib.get("ref")] = rels.get(hy.attrib.get(REL + "id"), "")
    rows = {}
    for cell in sheet.findall("m:sheetData/m:row/m:c", NS):
        ref = cell.attrib["r"]
        col = re.match(r"[A-Z]+", ref).group(0)
        row = int(re.search(r"\d+", ref).group(0))
        kind = cell.attrib.get("t")
        val = cell.find("m:v", NS)
        text = ""
        if kind == "s" and val is not None and val.text:
            text = shared[int(val.text)]
        elif val is not None and val.text:
            text = val.text
        rows.setdefault(row, {})[col] = text.strip()
    records = []
    for number in range(2, max(rows) + 1):
        row = rows.get(number, {})
        if row.get("C") == "Contact Info" and row.get("E") == "Status":
            continue
        listing = links.get(f"B{number}") or links.get(f"D{number}") or ""
        report = links.get(f"D{number}") or ""
        if not any(row.get(c) for c in "ABCDEFGI") and not listing:
            continue
        records.append({
            "name": row.get("A", ""),
            "title": row.get("B", ""),
            "contact": row.get("C", ""),
            "mark": row.get("E", ""),
            "note": row.get("F", ""),
            "date": excel_date(row.get("G", "")),
            "status": sheet_status(row.get("I", "")),
            "listing": listing,
            "report": report,
        })
    return records


def build(records, today):
    groups = {}
    order = []
    for rec in records:
        url = normalize_url(rec["listing"])
        if not url:
            continue
        key = source_key(url)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(rec)
    properties = []
    note_rows = []
    for key in order:
        group = groups[key]
        url = normalize_url(group[0]["listing"])
        report = ""
        for rec in group:
            other = normalize_url(rec["report"])
            if other and other != url:
                report = other
                break
        names = [r["name"] for r in group if r["name"]]
        proper = [n for n in names if n.lower() not in ("home owner", "homeowner", "owner")]
        name = (proper or names or [""])[0]
        titles = [r["title"] for r in group if r["title"]]
        title = max(titles, key=len) if titles else (name or "LISTING")
        phones = []
        notes = []
        status = "NEW"
        rank = {"NEW": 0, "CONTACTED": 1, "PITCHED": 2, "SIGNED": 3, "NO": 4}
        starred = False
        contacted = None
        for rec in group:
            found = last10(rec["contact"])
            if found and found not in phones:
                phones.append(found)
            elif rec["contact"] and not found:
                notes.append(rec["contact"])
            if rec["mark"]:
                starred = True
                notes.append(rec["mark"])
            if rec["note"]:
                notes.append(rec["note"])
            if rec["status"] == "NO":
                if status == "NEW":
                    status = "NO"
                else:
                    notes.append("marked no")
            elif rec["status"] and rank[rec["status"]] >= rank[status]:
                status = rec["status"]
            if rec["date"]:
                contacted = rec["date"]
        seen = []
        for note in notes:
            text = note.strip()
            if text and text not in seen:
                seen.append(text)
        host = urlsplit(url).netloc
        if "zillow" in host:
            source = "zillow"
        elif "craigslist" in host:
            source = "craigslist"
        elif "realtor" in host:
            source = "realtor"
        else:
            source = "report"
        prop = {
            "source_key": key,
            "listing_title": title[:500],
            "listing_url": url,
            "report_url": report or None,
            "owner_name": name or None,
            "owner_phone": (f"{phones[0][:3]}-{phones[0][3:6]}-{phones[0][6:]}" if phones else None),
            "status": status,
            "starred": starred,
            "last_contacted": contacted,
            "source": source,
        }
        prop.update(parse_address(title))
        if status in ("CONTACTED", "PITCHED"):
            prop["next_followup"] = contacted or today
        if len(phones) > 1:
            seen.append("second phone on the same listing")
        properties.append(prop)
        note_rows.append(seen)
    return properties, note_rows


def counts(records, properties, note_rows):
    tally = {}
    for prop in properties:
        tally[prop["status"]] = tally.get(prop["status"], 0) + 1
    print(f"rows {len(records)}")
    print(f"no_url {sum(1 for r in records if not r['listing'])}")
    print(f"properties {len(properties)}")
    print(f"starred {sum(1 for p in properties if p['starred'])}")
    print(f"phones {sum(1 for p in properties if p['owner_phone'])}")
    print(f"addresses {sum(1 for p in properties if p.get('address'))}")
    print("status " + " ".join(f"{k} {tally[k]}" for k in sorted(tally)))
    print(f"notes {sum(len(n) for n in note_rows)}")
    print(f"keys {len({p['source_key'] for p in properties})}")


def request(url, method, headers, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def commit(properties, note_rows):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    anon = os.environ["SUPABASE_ANON_KEY"]
    email = os.environ["SUPABASE_EMAIL"]
    password = os.environ["SUPABASE_PASSWORD"]
    auth = request(
        f"{base}/auth/v1/token?grant_type=password",
        "POST",
        {"apikey": anon, "Content-Type": "application/json"},
        {"email": email, "password": password},
    )
    token = auth["access_token"]
    headers = {
        "apikey": anon,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    have = request(
        f"{base}/rest/v1/properties?select=source_key",
        "GET",
        {"apikey": anon, "Authorization": f"Bearer {token}"},
    )
    owned = {row["source_key"] for row in have}
    fresh = [(p, n) for p, n in zip(properties, note_rows) if p["source_key"] not in owned]
    made = 0
    noted = 0
    for prop, notes in fresh:
        body = {k: v for k, v in prop.items() if v is not None}
        inserted = request(f"{base}/rest/v1/properties", "POST", headers, body)
        row = inserted[0]
        made += 1
        for note in notes:
            request(
                f"{base}/rest/v1/notes",
                "POST",
                headers,
                {"property_id": row["id"], "body": note[:2000]},
            )
            noted += 1
    print(f"inserted {made}")
    print(f"skipped {len(properties) - len(fresh)}")
    print(f"notes_written {noted}")


def main():
    self_test()
    print("selftest ok")
    if "--self-test" in sys.argv:
        return
    path = os.environ.get("LEADS_XLSX", os.path.expanduser("~/Downloads/Leads.xlsx"))
    today = os.environ.get("SEED_TODAY") or datetime.now().date().isoformat()
    records = load_rows(path)
    properties, note_rows = build(records, today)
    counts(records, properties, note_rows)
    if "--commit" in sys.argv:
        commit(properties, note_rows)


if __name__ == "__main__":
    main()
