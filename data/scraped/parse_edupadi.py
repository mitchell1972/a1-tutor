#!/usr/bin/env python3
"""Parse EduPadi JAMB biology raw markdown into schema-exact JSONL.

Source pages (one per year), all from edupadi.com:
  https://edupadi.com/classroom/lessons/jamb/biology/<YEAR>/page/1

Each question block in the markdown has the shape:
    <number>
    <question text...>
    A
    <opt A>
    B
    <opt B>
    C
    <opt C>
    D
    <opt D>
    Answer▼
    Correct Answer:
    **<letter>**
    <optional explanation lines...>

We only emit a question when it has a clear stem, four options A-D, and one
answer letter. Diagram-dependent questions (which reference an image the
markdown cannot carry) are discarded.
"""
import json
import re
import sys
from pathlib import Path

RAW_DIR = Path("/Users/mitchellagoma/Documents/exam-prep-agent/data/scraped/raw")
OUT = Path("/Users/mitchellagoma/Documents/exam-prep-agent/data/scraped/jamb-biology-decade.jsonl")

# Phrases that mean the question depends on an image we cannot transcribe.
DIAGRAM_MARKERS = re.compile(
    r"\b(diagram|the figure above|figure below|use the diagram|shown above|labelled|labeled)\b",
    re.IGNORECASE,
)

# Topic keyword heuristics (first match wins). Best-guess only.
TOPIC_RULES = [
    ("genetics", ["gene", "heredity", "inheritance", "chromosome", "linnaean", "trait", "offspring", "fingerprint", "variation", "blood group"]),
    ("evolution", ["darwin", "evolution", "homologous", "analogous", "natural selection", "use and disuse"]),
    ("ecology", ["ecosystem", "food chain", "food web", "pollut", "biome", "savanna", "habitat", "succession", "population density", "biotic", "epiphyte", "nitrogen", "trophic", "community", "overcrowd", "swarming", "tidal zone", "pyramid"]),
    ("cell biology", ["cell membrane", "cytoplasm", "ribosome", "nucleus", "organelle", "mitochond", "osmosis", "diffusion", "hypotonic", "hypertonic", "plasmolysis", "haemolysis", "mitosis", "cell wall", "cell is placed", "spirogyra cell"]),
    ("photosynthesis", ["photosynthesis", "chlorophyll", "dark stage", "photolysis", "manufacture their food", "green plants"]),
    ("nutrition", ["nutrition", "holozoic", "holophytic", "saprophytic", "symbiotic", "villus", "small intestine", "digest", "endospermous", "cofactor", "enzyme", "food substances"]),
    ("reproduction", ["reproduction", "fertilization", "pollinat", "germination", "flower", "stamen", "sepal", "seed", "vegetative propagation", "hypogeal", "termites die"]),
    ("transport", ["xylem", "phloem", "transport", "lymph", "blood vessel", "heart", "circulat"]),
    ("respiration", ["respiration", "gas exchange", "tracheae", "gaseous", "glycolysis", "lungs"]),
    ("excretion", ["excret", "deamination", "kidney", "uric acid", "sweat gland", "malpighian", "flame cell", "water from the blood"]),
    ("coordination", ["hormone", "insulin", "adrenalin", "thyroxine", "nervous", "myopia", "tropism", "tactic movement", "nastic", "irritability", "stimulus"]),
    ("classification", ["classification", "species", "kingdom", "phylum", "arthropod", "nematode", "invertebrate", "bryophyte", "pteridophyte", "vertebrate", "level of organism", "homodont", "dentition"]),
    ("skeleton/support", ["bone", "femur", "skeleton", "support"]),
    ("adaptation", ["adaptation", "behavioural", "gregarious", "aestivation", "hibernation", "camouflage", "courtship", "defense", "defence"]),
    ("microorganisms", ["bacteria", "virus", "rhizopus", "hypha", "euglena", "fungi", "disease", "syphilis"]),
]


def guess_topic(text: str) -> str:
    low = text.lower()
    for topic, kws in TOPIC_RULES:
        for kw in kws:
            if kw in low:
                return topic
    return "general"


def parse_file(path: Path):
    year = int(path.stem)
    lines = [ln.rstrip() for ln in path.read_text(encoding="utf-8").splitlines()]
    # Drop blank lines for simpler state machine, but keep order.
    toks = [ln.strip() for ln in lines if ln.strip()]

    records = []
    i = 0
    n = len(toks)
    # A question block starts at a standalone integer token.
    while i < n:
        if re.fullmatch(r"\d+", toks[i]):
            qnum = toks[i]
            i += 1
            # Collect stem lines until we hit a standalone "A" option marker.
            stem_parts = []
            while i < n and toks[i] != "A":
                # Stop if we accidentally ran into the next block's number+text with no options (defensive)
                stem_parts.append(toks[i])
                i += 1
            if i >= n:
                break
            # Now parse exactly options A, B, C, D each: marker line then value line(s) until next marker.
            opts = {}
            ok = True
            for letter in ["A", "B", "C", "D"]:
                if i >= n or toks[i] != letter:
                    ok = False
                    break
                i += 1  # consume marker
                val_parts = []
                # value runs until the next single-letter marker (B/C/D) or "Answer" sentinel
                while i < n and toks[i] not in ("B", "C", "D", "Answer▼", "Answer") and not toks[i].startswith("Correct Answer"):
                    val_parts.append(toks[i])
                    i += 1
                opts[letter] = " ".join(val_parts).strip()
            if not ok:
                continue
            # Find answer letter
            answer = None
            # advance to "Correct Answer:" then read next token like **X**
            while i < n and not toks[i].startswith("Correct Answer"):
                # stop if we hit a new question number prematurely
                if re.fullmatch(r"\d+", toks[i]):
                    break
                i += 1
            if i < n and toks[i].startswith("Correct Answer"):
                i += 1
                if i < n:
                    m = re.search(r"([A-D])", toks[i])
                    if m:
                        answer = m.group(1)
                        i += 1
            # Explanation = following lines until next question number or "Loading lesson"
            expl_parts = []
            while i < n and not re.fullmatch(r"\d+", toks[i]) and not toks[i].startswith("Loading lesson"):
                expl_parts.append(toks[i])
                i += 1
            explanation = " ".join(expl_parts).strip()

            stem = " ".join(stem_parts).strip()
            # ---- validation / discards ----
            if not stem or answer is None:
                continue
            if not all(opts.get(l) for l in ["A", "B", "C", "D"]):
                continue
            if DIAGRAM_MARKERS.search(stem) or "DIAGRAM" in stem:
                continue
            if not (2016 <= year <= 2025):
                continue
            rec = {
                "subject": "biology",
                "exam": "jamb",
                "year": year,
                "topic": guess_topic(stem + " " + " ".join(opts.values())),
                "source": "past",
                "difficulty": 2,
                "text": stem,
                "options": {"A": opts["A"], "B": opts["B"], "C": opts["C"], "D": opts["D"]},
                "answer": answer,
                "explanation": explanation,
            }
            records.append(rec)
        else:
            i += 1
    return records


def main():
    all_recs = []
    seen = set()  # dedupe on (year, normalized text)
    for path in sorted(RAW_DIR.glob("*.md")):
        recs = parse_file(path)
        for r in recs:
            key = (r["year"], re.sub(r"\s+", " ", r["text"].lower()))
            if key in seen:
                continue
            seen.add(key)
            all_recs.append(r)

    with OUT.open("w", encoding="utf-8") as f:
        for r in all_recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Report
    from collections import Counter
    by_year = Counter(r["year"] for r in all_recs)
    by_topic = Counter(r["topic"] for r in all_recs)
    print(f"WROTE {len(all_recs)} records to {OUT}")
    print("By year:", dict(sorted(by_year.items())))
    print("By topic:", dict(sorted(by_topic.items())))


if __name__ == "__main__":
    main()
