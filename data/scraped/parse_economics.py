#!/usr/bin/env python3
"""Parse EduPadi JAMB Economics raw HTML into schema-exact JSONL.

Source pages (server-rendered HTML, fetched by curl), all from edupadi.com:
  https://edupadi.com/classroom/lessons/jamb/economics/<YEAR>/page/<N>

Each question is transcribed from two co-located, redundant places in the HTML:

  1. The visible block carries the correct-answer letter:
        Correct Answer:
        **<letter>**
     We extract the letter from the FIRST "Correct Answer:" ... **X** that
     follows each question's share payload anchor.

  2. The Facebook "share" link for every question embeds a clean,
     URL-encoded copy of the stem + four options, in the form:
        quote=JAMB%3A%20Economics%3A%20<YEAR>%20Question%0A%0A
              <STEM>%0A%0A
              index-0.%20<A>%0A
              index-1.%20<B>%0A
              index-2.%20<C>%0A
              index-3.%20<D>%0A%0A
              Shared%20from%20EduPadi
     This is the authoritative source for the stem and options because it is
     unambiguous about option boundaries (index-0..index-3).

We only emit a question when it has a clear stem, four non-empty options A-D,
and one answer letter A-D. Diagram/graph-dependent questions (which reference
an image the JSONL cannot carry) are discarded. Year is taken from the URL/
page heading the question came from; anything outside 2016-2025 is dropped.

Even spread: at most PER_YEAR questions are kept per exam year.
"""
import html
import json
import re
import sys
import urllib.parse
from collections import Counter, OrderedDict
from pathlib import Path

SCRAPE_DIR = Path("/Users/mitchellagoma/Documents/exam-prep-agent/data/scraped")
OUT = SCRAPE_DIR / "jamb-economics-decade.jsonl"

PER_YEAR = 7          # cap per year (even spread); trimmed later to TARGET total
TARGET = 60           # overall cap

# Phrases meaning the question depends on an image/figure we cannot transcribe.
DIAGRAM_MARKERS = re.compile(
    r"(diagram|the graph above|graph below|the figure|figure above|figure below|"
    r"from the table above|the table above|use the diagram|shown above|"
    r"from the diagram|in the diagram|table below)",
    re.IGNORECASE,
)

# Best-guess economics topic (first keyword match wins).
TOPIC_RULES = [
    ("demand and supply", ["demand", "supply", "elasticity", "elastic", "inelastic",
                            "equilibrium price", "price mechanism", "substitute",
                            "complement", "ostentation", "quantity demanded",
                            "quantity supplied", "demand curve", "supply curve"]),
    ("utility and consumer behaviour", ["utility", "scale of preference",
                                        "diminishing marginal", "consumer", "satisfaction",
                                        "value in use", "indifference"]),
    ("production", ["production possibility", "product possibility", "factors of production",
                    "marginal cost", "marginal revenue", "marginal product",
                    "average revenue product", "returns to scale", "optimum size",
                    "law of increasing", "cost of production", "factor of production"]),
    ("market structures", ["monopoly", "monopolist", "oligopoly", "duopoly",
                           "perfect competition", "monopolistic", "market structure",
                           "few sellers", "market price is determined"]),
    ("business organisation", ["sole proprietor", "partnership", "joint stock",
                               "joint-stock", "co-operative", "cooperative", "public corporation",
                               "business organization", "business organisation", "retailer",
                               "bankruptcy", "company", "shareholder", "dividend"]),
    ("national income", ["national income", "gross domestic product", "gdp",
                         "income approach", "expenditure approach", "value added",
                         "output method", "output approach", "per capita", "investment"]),
    ("money and banking", ["money supply", "central bank", "commercial bank", "money is",
                           "legal tender", "currency", "bank rate", "interest rate", "cheque"]),
    ("public finance", ["budget", "taxation", "tax", "deficit", "surplus", "subsid",
                        "government expenditure", "fiscal", "import dut", "export dut"]),
    ("international trade", ["balance of payment", "terms of trade", "international trade",
                            "ecowas", "opec", "export", "import", "dumping", "exchange rate",
                            "foreign market", "tariff", "free trade", "world bank"]),
    ("economic systems", ["capitalist", "capitalism", "socialist", "mixed economy",
                          "free market", "command economy", "frugal economy", "economic system"]),
    ("development economics", ["economic growth", "economic development", "developing countries",
                              "foreign aid", "industrial growth", "industrialization",
                              "localization of industry", "mono production", "infrastructure",
                              "standard of living"]),
    ("population and labour", ["population", "labour force", "labour market", "unemployment",
                              "full employment", "migration", "dependency ratio",
                              "wage", "labour"]),
    ("basic concepts", ["scarcity", "opportunity cost", "economic problem", "choice",
                        "wants", "natural resources", "free gift"]),
    ("statistics", ["standard deviation", "variance", "measures of dispersion",
                    "mean", "median", "mode", "range"]),
]


def guess_topic(text: str) -> str:
    low = text.lower()
    for topic, kws in TOPIC_RULES:
        for kw in kws:
            if kw in low:
                return topic
    return "general"


def clean(s: str) -> str:
    """Normalise whitespace and decode HTML entities."""
    s = html.unescape(s)
    s = s.replace(" ", " ")
    s = re.sub(r"\s+", " ", s).strip()
    # Trim trailing fill-in underscores / leading dashes used as blanks.
    s = re.sub(r"_{2,}", "", s)
    s = re.sub(r"^[-–—\s]{3,}", "", s)
    return s.strip()


# Match a single question's share payload (the Facebook quote= variant is the
# most reliable; it appears once per question). The year inside the payload is
# used to double-check the page year.
SHARE_RE = re.compile(
    r"quote=JAMB%3A%20Economics%3A%20(?P<year>\d{4})%20Question%0A%0A"
    r"(?P<body>.*?)%0A%0AShared%20from%20EduPadi",
    re.DOTALL,
)

# Within the decoded payload: stem then index-0..index-3.
INDEX_SPLIT_RE = re.compile(r"index-[0-3]\.\s*")

# Correct-answer letter markers, in document order.
ANSWER_RE = re.compile(r"Correct Answer:\s*</[^>]+>\s*<[^>]*>\s*\*?\*?\s*([A-D])\b", re.IGNORECASE)
# Fallback: the markdown-ish "Correct Answer:\n**X**" can also survive in some
# renderings; and a plain ">A<" right after the label.
ANSWER_RE_SIMPLE = re.compile(r"Correct Answer:\s*[^A-D]{0,40}?\b([A-D])\b", re.IGNORECASE | re.DOTALL)


def extract_answers(raw_html: str):
    """Return list of answer letters in document order."""
    letters = []
    for m in re.finditer(r"Correct Answer:(.{0,120})", raw_html, re.DOTALL):
        chunk = m.group(1)
        lm = re.search(r"\b([A-D])\b", re.sub(r"<[^>]+>", " ", chunk))
        if lm:
            letters.append(lm.group(1).upper())
        else:
            letters.append(None)
    return letters


def parse_file(path: Path):
    year = int(re.search(r"edu_(\d{4})_", path.name).group(1))
    raw = path.read_text(encoding="utf-8", errors="replace")

    # Answer letters in order (one per question block).
    answers = extract_answers(raw)

    # Questions in order, from the share payloads.
    questions = []
    for m in SHARE_RE.finditer(raw):
        payload_year = int(m.group("year"))
        body_enc = m.group("body")
        body = urllib.parse.unquote(body_enc)
        body = body.replace("+", " ")
        # Split stem | options on index-N markers.
        parts = INDEX_SPLIT_RE.split(body)
        if len(parts) != 5:
            # Not a clean 1 stem + 4 options payload -> skip.
            continue
        stem = clean(parts[0])
        opts = [clean(p) for p in parts[1:5]]
        questions.append((payload_year, stem, opts))

    records = []
    # Pair questions with answers positionally. The share payloads and the
    # "Correct Answer:" markers both appear once per question, in the same order.
    for idx, (pyear, stem, opts) in enumerate(questions):
        ans = answers[idx] if idx < len(answers) else None
        yr = pyear or year
        if yr != year:
            # Mismatch between payload year and page year -> trust nothing, skip.
            continue
        if ans is None or ans not in ("A", "B", "C", "D"):
            continue
        if not stem or len(stem) < 8:
            continue
        if any(not o for o in opts):
            continue
        if DIAGRAM_MARKERS.search(stem):
            continue
        if not (2016 <= yr <= 2025):
            continue
        rec = OrderedDict([
            ("subject", "economics"),
            ("exam", "jamb"),
            ("year", yr),
            ("topic", guess_topic(stem + " " + " ".join(opts))),
            ("source", "past"),
            ("difficulty", 2),
            ("text", stem),
            ("options", OrderedDict([("A", opts[0]), ("B", opts[1]),
                                     ("C", opts[2]), ("D", opts[3])])),
            ("answer", ans),
            ("explanation", ""),
        ])
        records.append(rec)
    return records


def main():
    files = sorted(SCRAPE_DIR.glob("edu_*_p*.html"))
    by_year_recs = {}
    seen = set()  # dedupe on (year, normalized stem)
    for path in files:
        for r in parse_file(path):
            key = (r["year"], re.sub(r"\s+", " ", r["text"].lower()))
            if key in seen:
                continue
            seen.add(key)
            by_year_recs.setdefault(r["year"], []).append(r)

    # Even spread: take up to PER_YEAR per year, then fill toward TARGET.
    years = sorted(by_year_recs)
    chosen = []
    # First pass: 6 per year (even base).
    base = 6
    for y in years:
        chosen.extend(by_year_recs[y][:base])
    # Second pass: top up to TARGET by adding extras (7th) per year round-robin.
    if len(chosen) < TARGET:
        for y in years:
            if len(chosen) >= TARGET:
                break
            extra = by_year_recs[y][base:PER_YEAR]
            for r in extra:
                if len(chosen) >= TARGET:
                    break
                chosen.append(r)
    # Trim if somehow over.
    chosen = chosen[:TARGET]
    # Stable sort by (year, then original order preserved within year).
    chosen.sort(key=lambda r: r["year"])

    with OUT.open("w", encoding="utf-8") as f:
        for r in chosen:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    by_year = Counter(r["year"] for r in chosen)
    by_topic = Counter(r["topic"] for r in chosen)
    print(f"WROTE {len(chosen)} records to {OUT}")
    print("Available per year:", {y: len(by_year_recs[y]) for y in years})
    print("Kept by year:", dict(sorted(by_year.items())))
    print("By topic:", dict(sorted(by_topic.items())))


if __name__ == "__main__":
    main()
