const COMMON = String.raw`
import hashlib, json, os, sys
ROOT = '/opt/data/profiles'
DELIM = '\n§\n'
def skill_dirs(profile):
    base = os.path.join(ROOT, profile, 'skills')
    found = {}
    for folder, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        if 'SKILL.md' in files:
            rel = os.path.relpath(folder, base).replace(os.sep, '/')
            if not rel.split('/')[-1].startswith('waypoint-'):
                digest = hashlib.sha256()
                for inner, inner_dirs, inner_files in os.walk(folder):
                    inner_dirs[:] = sorted(d for d in inner_dirs if not d.startswith('.'))
                    for name in sorted(f for f in inner_files if not f.startswith('.')):
                        path = os.path.join(inner, name)
                        digest.update(os.path.relpath(path, folder).encode())
                        with open(path, 'rb') as handle:
                            digest.update(handle.read())
                found[rel] = digest.hexdigest()
            dirs[:] = []
    return found
def entries(profile, name):
    try:
        text = open(os.path.join(ROOT, profile, 'memories', name), encoding='utf-8').read()
    except OSError:
        return []
    return [entry.strip() for entry in text.split(DELIM) if entry.strip()]
def memory_files(profile):
    folder = os.path.join(ROOT, profile, 'memories')
    return sorted(f for f in os.listdir(folder) if f.endswith('.md')) if os.path.isdir(folder) else []
`;

export const SNAPSHOT_SCRIPT = COMMON + String.raw`
p = json.loads(sys.stdin.read())
print(json.dumps({seat: skill_dirs(seat) for seat in p['seats']}))
`;

export const LEARNING_SCRIPT = COMMON + String.raw`
p = json.loads(sys.stdin.read())
items = []
for seat in p['seats']:
    clone, source, baseline = seat['id'], seat['from'], seat.get('baseline')
    now, original = skill_dirs(clone), skill_dirs(source)
    for rel, digest in sorted(now.items()):
        base = baseline.get(rel) if isinstance(baseline, dict) else original.get(rel)
        if digest == base or digest == original.get(rel):
            continue
        try:
            preview = open(os.path.join(ROOT, clone, 'skills', rel, 'SKILL.md'), encoding='utf-8').read()[:4000]
        except OSError:
            preview = ''
        items.append({'seat': clone, 'from': source, 'kind': 'skill', 'path': rel, 'change': 'modified' if base else 'added', 'text': preview})
    for name in memory_files(clone):
        known = set(entries(source, name))
        for entry in entries(clone, name):
            if entry not in known:
                items.append({'seat': clone, 'from': source, 'kind': 'memory', 'path': name, 'change': 'added', 'text': entry})
print(json.dumps({'items': items}))
`;

export const APPLY_SCRIPT = COMMON + String.raw`
import fcntl, shutil
p = json.loads(sys.stdin.read())
if p['kind'] == 'skill':
    src = os.path.join(ROOT, p['seat'], 'skills', p['path'])
    dst = os.path.join(ROOT, p['from'], 'skills', p['path'])
    if not os.path.isdir(src):
        raise SystemExit('skill no longer exists in the pod seat')
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst)
else:
    folder = os.path.join(ROOT, p['from'], 'memories')
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, p['path'])
    with os.fdopen(os.open(path + '.lock', os.O_RDWR | os.O_CREAT, 0o600), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = entries(p['from'], p['path'])
        if p['text'].strip() not in current:
            tmp = os.path.join(folder, '.mem_waypoint')
            with open(tmp, 'w', encoding='utf-8') as handle:
                handle.write(DELIM.join(current + [p['text'].strip()]))
            os.chmod(tmp, 0o600)
            os.replace(tmp, path)
print(json.dumps({'ok': True}))
`;
