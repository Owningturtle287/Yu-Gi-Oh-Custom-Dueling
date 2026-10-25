"""Regenerate the pinned offline rules pack from upstream source archives.

python scripts/update-rules.py --cards cards.json --database cards.cdb \
  --scripts CardScripts.tar.gz --scripts-revision SHA --database-revision SHA \
  --era-end 2006-12-31
The normal test/build never downloads upstream data.
"""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tarfile

p = argparse.ArgumentParser()
for name in ('cards', 'database', 'scripts', 'scripts-revision', 'database-revision'):
    p.add_argument('--' + name, required=True)
p.add_argument('--era-end', required=True, type=date.fromisoformat)
a = p.parse_args()
root = Path(__file__).resolve().parent.parent
out = root / 'assets' / 'rules'
out.mkdir(parents=True, exist_ok=True)
cards = json.loads(Path(a.cards).read_text())['data']
era_end = a.era_end.isoformat()
def released(value):
    try:
        return bool(value) and date.fromisoformat(value) <= a.era_end
    except (ValueError, TypeError):
        return False
# Worldwide scripts include OCG predecessors and transitive dependencies, while
# the app independently limits playable decks to dated TCG releases.
early = {c['id'] for c in cards if any(released(m.get(region)) for m in c.get('misc_info', []) for region in ('tcg_date', 'ocg_date'))}
db = sqlite3.connect(a.database)
rows = db.execute('SELECT d.*,t.name,t.str1,t.str2,t.str3,t.str4,t.str5,t.str6,t.str7,t.str8,t.str9,t.str10,t.str11,t.str12,t.str13,t.str14,t.str15,t.str16 FROM datas d JOIN texts t ON d.id=t.id').fetchall()
by_id = {r[0]: r for r in rows}
with tarfile.open(a.scripts) as archive:
    scripts = {}
    notices = {}
    for member in archive.getmembers():
        parts = member.name.split('/')[1:]
        if not member.isfile() or not parts:
            continue
        if member.name.endswith('.lua') and (len(parts) == 1 or parts[0] == 'official'):
            scripts[parts[-1]] = archive.extractfile(member).read().decode('utf-8-sig')
        if len(parts) == 1 and parts[0] in ('README.md', 'COPYING'):
            notices[parts[0]] = archive.extractfile(member).read().decode('utf-8-sig')
# Keep audited local rule corrections when refreshing the upstream snapshot.
overrides = sorted((out/'overrides').glob('*.lua'))
for override in overrides:
    scripts[override.name] = override.read_text()
helpers = {k:v for k,v in scripts.items() if not re.match(r'c\d+\.lua$', k)}
constants = {key:int(value) for key,value in re.findall(r'(CARD_\w+)\s*=\s*(\d+)', scripts['constant.lua'])}
names_to_id = {r[11]:r[0] for r in rows}
selected = set(early) | {names_to_id[c['name']] for c in cards if c['id'] in early and c['name'] in names_to_id}
selected |= {by_id[i][2] for i in early if i in by_id and by_id[i][2]}
checked = set()
while selected - checked:
    for code in sorted(selected - checked):
        checked.add(code)
        if code in by_id and by_id[code][2]:
            selected.add(by_id[code][2])
        text = scripts.get(f'c{code}.lua', '')
        selected.update(int(value) for groups in re.findall(r'\bc(\d+)\b|LoadCardScript\((\d+)\)', text) for value in groups if value and int(value) in by_id)
        selected.update(constants[k] for k in re.findall(r'\bCARD_\w+\b', text) if k in constants and constants[k] in by_id)
packed = {**helpers, **{f'c{i}.lua':scripts[f'c{i}.lua'] for i in sorted(selected) if f'c{i}.lua' in scripts}}
# Only replace generated shards; runtime-sources.json is a separate pinned
# provenance record and must survive a pack refresh.
for label in ('cards', 'scripts'):
    for old in out.glob(label + '-*.json'):
        old.unlink()
files = []
def chunks(label, entries, limit=180000):
    current = {}; size = 0; index = 0
    for key,value in entries:
        length = len(json.dumps({key:value}, ensure_ascii=False).encode())
        if current and size + length > limit:
            name = f'{label}-{index:02}.json'; write(name, current); index += 1; current = {}; size = 0
        current[str(key)] = value; size += length
    if current:
        write(f'{label}-{index:02}.json', current)
def write(name, value):
    content = json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'
    (out/name).write_text(content)
    files.append({'path':name, 'sha256':hashlib.sha256(content.encode()).hexdigest()})
chunks('scripts', sorted(packed.items()))
# Numeric database fields and names for every code allow tokens and declarations;
# effect descriptions are retained for the complete early card pool.
chunks('cards', ((r[0], [r[2], str(r[3] & ((1<<64)-1)), r[4], r[5], r[6], r[7], str(r[8]), r[9], r[11], list(r[12:]) if r[0] in selected else []]) for r in rows))
names_to_id = {r[11]:r[0] for r in rows}
aliases = {c['id']:names_to_id[c['name']] for c in cards if c['id'] in early and c['id'] not in by_id and c['name'] in names_to_id}
supported = sorted(i for i in early if (i in by_id or i in aliases) and ((by_id.get(i) or by_id[aliases[i]])[4] & 0x11 == 0x11 or f'c{i}.lua' in packed or f'c{aliases.get(i, by_id.get(i, [0,0,0])[2])}.lua' in packed))
(root/'src/duel/rules-manifest.js').write_text('// Generated by scripts/update-rules.py; pinned upstream rule coverage.\nexport const NATIVE_ERA_END = '+json.dumps(era_end)+';\nexport const NATIVE_CARD_IDS = new Set('+json.dumps(supported,separators=(',',':'))+');\n')
manifest = {'eraEnd':era_end,'scriptsRevision':a.scripts_revision,'databaseRevision':a.database_revision,'apiSnapshotCards':len(cards),'apiSnapshotSha256':hashlib.sha256(Path(a.cards).read_bytes()).hexdigest(),'earlyCards':len(early),'supportedCards':len(supported),'scripts':len(packed),'cardAliases':aliases,'files':files,'localOverrides':['overrides/'+path.name for path in overrides]}
(out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
(out/'CardScripts-README.md').write_text(notices['README.md'])
(out/'AGPL-3.0.txt').write_text(notices['COPYING'])
print(json.dumps({k:v for k,v in manifest.items() if k != 'files'}))
