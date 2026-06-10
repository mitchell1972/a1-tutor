#!/usr/bin/env python3
"""Harvest genuine WAEC SSCE CRS (CRK) past MCQs from myschool.ng (static HTML, no Firecrawl).

Listing page  -> question stem + options A-D + year badge + detail URL
Detail page    -> "Correct Answer: Option X" + explanation
Only items with a clear stem, exactly 4 options, and a single answer letter are kept.
Nothing is invented.
"""
import json, re, sys, time, subprocess, html as ihtml, os

SLUG = "christian-religious-knowledge-crk"
BASE = "https://myschool.ng/classroom"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

def fetch(url, tries=3):
    for n in range(tries):
        try:
            out = subprocess.run(
                ["curl", "-sL", url,
                 "-H", f"User-Agent: {UA}",
                 "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                 "-H", "Accept-Language: en-US,en;q=0.9",
                 "--compressed", "--max-time", "45"],
                capture_output=True, text=True, timeout=60)
            if out.stdout and "Correct Answer" in out.stdout or "question-item" in out.stdout or "question-desc" in out.stdout:
                return out.stdout
            if out.stdout and len(out.stdout) > 2000:
                return out.stdout
        except Exception as e:
            sys.stderr.write(f"  fetch err {e}\n")
        time.sleep(1.5 * (n + 1))
    return out.stdout if 'out' in dir() and out.stdout else ""

def clean(t):
    t = re.sub(r"<[^>]+>", " ", t)
    t = ihtml.unescape(t)
    t = t.replace("\xa0", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return t

# --- listing parser ---
ITEM_RE = re.compile(r'<div class="media question-item.*?</a>', re.S)
DESC_RE = re.compile(r'<div class="question-desc[^"]*">(.*?)</div>', re.S)
OPT_RE  = re.compile(r'<li>\s*<strong>([A-D])\.</strong>(.*?)</li>', re.S)
URL_RE  = re.compile(r'href="(https://myschool\.ng/classroom/[^"]*?/(\d+)\?[^"]*)"', re.S)
YEAR_RE = re.compile(r'WAEC\s*</?\w*>?\s*(\d{4})', re.S)

# --- detail parser ---
ANS_RE  = re.compile(r'Correct Answer:\s*Option\s*([A-D])', re.I)
EXP_RE  = re.compile(r'<h5>\s*Explanation\s*</h5>\s*<p>(.*?)</p>', re.S | re.I)

def parse_listing(htmltext, year):
    items = []
    for block in ITEM_RE.findall(htmltext):
        dm = DESC_RE.search(block)
        if not dm:
            continue
        text = clean(dm.group(1))
        opts = {}
        for letter, val in OPT_RE.findall(block):
            opts[letter] = clean(val)
        um = URL_RE.search(block)
        if not (text and len(opts) == 4 and all(k in opts for k in "ABCD") and um):
            continue
        # year sanity: badge must match requested year if present
        ym = YEAR_RE.search(block)
        badge_year = int(ym.group(1)) if ym else year
        if badge_year != year:
            continue
        items.append({"text": text, "options": opts,
                      "detail_url": um.group(1).replace("&amp;", "&"),
                      "qid": um.group(2), "year": year})
    return items

def parse_detail(htmltext):
    am = ANS_RE.search(htmltext)
    if not am:
        return None, ""
    ans = am.group(1).upper()
    em = EXP_RE.search(htmltext)
    exp = clean(em.group(1)) if em else ""
    if exp.lower() in ("", "n/a", "no explanation", "none"):
        exp = ""
    return ans, exp

TOPIC_KW = [
    (r"\bcreat|garden of eden|adam|eve|domin", "creation"),
    (r"\bnoah|flood|ark\b", "noah"),
    (r"\babraham|isaac|sacrific", "abraham"),
    (r"\bjacob|esau\b", "jacob"),
    (r"\bjoseph\b|potiphar|pharaoh.*dream", "joseph"),
    (r"\bmoses|exodus|burning bush|red sea|plague", "moses"),
    (r"\bten commandment|sinai|covenant|law\b", "the law / covenant"),
    (r"\bjoshua|jericho|promised land", "joshua"),
    (r"\bdeborah|gideon|samson|judge", "judges"),
    (r"\bsamuel|eli\b|hannah", "samuel"),
    (r"\bsaul\b", "saul"),
    (r"\bdavid\b|goliath|jonathan|bathsheba", "david"),
    (r"\bsolomon|temple|wisdom|rehoboam", "solomon"),
    (r"\belijah|carmel|baal|ahab|jezebel", "elijah"),
    (r"\belisha|gehazi|naaman", "elisha"),
    (r"\bjonah|nineveh", "jonah"),
    (r"\bjeremiah|amos|hosea|isaiah|prophet", "prophets"),
    (r"\bjesus|christ|messiah", "life of Jesus"),
    (r"\bbaptis|john the baptist", "baptism"),
    (r"\btemptation|wilderness.*jesus", "temptation of Jesus"),
    (r"\bsermon|beatitude|mount\b", "sermon on the mount"),
    (r"\bparable|sower|prodigal|good samaritan|talent", "parables"),
    (r"\bmiracle|heal|leper|blind|feed.*thousand", "miracles"),
    (r"\bcrucifix|cross|calvary|golgotha|trial of jesus|pilate", "crucifixion"),
    (r"\bresurrect|empty tomb|risen", "resurrection"),
    (r"\bascension|pentecost|holy spirit", "pentecost / Holy Spirit"),
    (r"\bpeter\b|cornelius", "Peter"),
    (r"\bpaul|saul of tarsus|damascus|missionary journey", "Paul"),
    (r"\bstephen\b", "Stephen"),
    (r"\bchurch|apostle|early christian|disciple", "early church"),
    (r"\bfaith|love|forgive|humil|obedien|righteous|sin\b|repent", "Christian living"),
]

def topic_for(text):
    low = text.lower()
    for pat, lab in TOPIC_KW:
        if re.search(pat, low):
            return lab
    return "general"

PER_YEAR = 6          # target per year -> 6 x 10 = 60, even spread
TOTAL_CAP = 60
MAX_PAGES = 6

def main():
    years = list(range(2016, 2026))  # 2016-2025 inclusive
    seen_keys = set()
    records = []
    stats = {y: 0 for y in years}
    for year in years:
        page = 1
        ycount = 0
        while page <= MAX_PAGES and ycount < PER_YEAR:
            url = f"{BASE}/{SLUG}?exam_type=waec&exam_year={year}&page={page}"
            sys.stderr.write(f"[{year}] listing page {page} (have {ycount}/{PER_YEAR}) ...\n")
            lst_html = fetch(url)
            items = parse_listing(lst_html, year)
            if not items:
                break
            for it in items:
                if ycount >= PER_YEAR:
                    break
                dedup = re.sub(r"[^a-z0-9]", "", it["text"].lower())[:80]
                if dedup in seen_keys:
                    continue
                seen_keys.add(dedup)
                sys.stderr.write(f"   q{it['qid']} detail ...\n")
                det_html = fetch(it["detail_url"])
                ans, exp = parse_detail(det_html)
                if ans is None or ans not in it["options"]:
                    sys.stderr.write("    -> no clean answer, skip\n")
                    continue
                rec = {
                    "subject": "crs",
                    "exam": "ssce",
                    "year": int(year),
                    "topic": topic_for(it["text"]),
                    "source": "past",
                    "difficulty": 2,
                    "text": it["text"],
                    "options": {k: it["options"][k] for k in "ABCD"},
                    "answer": ans,
                    "explanation": exp,
                }
                records.append(rec)
                ycount += 1
                time.sleep(0.6)
            stats[year] = ycount
            page += 1
            time.sleep(0.6)
        stats[year] = ycount

    # second pass: if under cap, top up from years that still have more pages
    if len(records) < TOTAL_CAP:
        for year in years:
            if len(records) >= TOTAL_CAP:
                break
            page = (stats[year] // 5) + 1
            tries = 0
            while len(records) < TOTAL_CAP and tries < 4:
                url = f"{BASE}/{SLUG}?exam_type=waec&exam_year={year}&page={page}"
                sys.stderr.write(f"[topup {year}] page {page} ...\n")
                lst_html = fetch(url)
                items = parse_listing(lst_html, year)
                tries += 1
                page += 1
                if not items:
                    break
                for it in items:
                    if len(records) >= TOTAL_CAP:
                        break
                    dedup = re.sub(r"[^a-z0-9]", "", it["text"].lower())[:80]
                    if dedup in seen_keys:
                        continue
                    seen_keys.add(dedup)
                    det_html = fetch(it["detail_url"])
                    ans, exp = parse_detail(det_html)
                    if ans is None or ans not in it["options"]:
                        continue
                    records.append({
                        "subject": "crs", "exam": "ssce", "year": int(year),
                        "topic": topic_for(it["text"]), "source": "past", "difficulty": 2,
                        "text": it["text"],
                        "options": {k: it["options"][k] for k in "ABCD"},
                        "answer": ans, "explanation": exp,
                    })
                    stats[year] += 1
                    time.sleep(0.6)

    outpath = "/Users/mitchellagoma/Documents/exam-prep-agent/data/scraped/ssce-crs-decade.jsonl"
    with open(outpath, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    sys.stderr.write(f"\nWROTE {len(records)} -> {outpath}\n")
    sys.stderr.write("per-year: " + json.dumps(stats) + "\n")
    print(json.dumps({"harvested": len(records),
                      "years": sorted({r['year'] for r in records}),
                      "per_year": stats}))

if __name__ == "__main__":
    main()
