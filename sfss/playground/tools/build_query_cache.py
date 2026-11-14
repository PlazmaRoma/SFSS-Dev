import json, sys, time, urllib.request
from pathlib import Path

API = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src/shared/fixtures/query_cache.json"

QUESTIONS = [
    ("oxygen",    "How does oxygen concentration affect flame spread in microgravity?",
                  "Как концентрация кислорода влияет на распространение пламени в невесомости?"),
    ("pressure",  "What happens to a flame at reduced atmospheric pressure?",
                  "Что происходит с пламенем при пониженном давлении?"),
    ("solids",    "How do solid materials burn in microgravity compared to Earth?",
                  "Чем горение твёрдых материалов в невесомости отличается от земного?"),
    ("airflow",   "What role does airflow velocity play in extinguishing a flame?",
                  "Какую роль играет скорость потока воздуха при гашении пламени?"),
    ("materials", "What did the BASS-II experiment find about burning solid fuels aboard the ISS?",
                  "Что эксперимент BASS-II показал о горении твёрдых материалов на МКС?"),
    ("helium",    "How does helium in the atmosphere affect combustion?",
                  "Как гелий в атмосфере влияет на горение?"),
    ("safety",    "What are the fire safety implications for crewed spacecraft?",
                  "Что это значит для пожарной безопасности пилотируемых кораблей?"),
    ("droplet",   "Why does droplet size matter for burning rate?",
                  "Почему размер капли влияет на скорость горения?"),
]

def ask(q, lang):
    body = json.dumps({"question": q, "language": lang}).encode()
    req = urllib.request.Request(API + "/query", data=body,
                                 headers={"Content-Type": "application/json"})
    t = time.perf_counter()
    d = json.load(urllib.request.urlopen(req, timeout=600))
    return d, time.perf_counter() - t

cache = {}
for key, en, ru in QUESTIONS:
    entry = {"question": {"en": en, "ru": ru}}
    for lang, text in (("en", en), ("ru", ru)):
        try:
            d, secs = ask(text, lang)
            entry[lang] = {
                "answer": d["answer"],
                "sources": [{"doc_id": s["doc_id"], "page": s.get("page"),
                             "excerpt": (s.get("excerpt") or "")[:400].rstrip() + "…"}
                            for s in d.get("sources", [])],
            }
            print(f"  {key:<10} {lang}  {secs:5.1f} s  {len(d['answer']):>4} chars")
        except Exception as e:
            print(f"  {key:<10} {lang}  ERROR: {e}")
    cache[key] = entry

OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n→ {OUT}  ({OUT.stat().st_size // 1024} KB, {len(cache)} topics × 2 languages)")
