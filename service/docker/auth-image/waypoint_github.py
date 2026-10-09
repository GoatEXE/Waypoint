import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REAL_GH = os.environ.get('WAYPOINT_REAL_GH', '/opt/gh/bin/gh')
REPO_RE = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
REMOTE_RE = re.compile(r'github\.com[:/]+([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$')
NO_TOKEN = {'--version', 'version', 'help', '--help', '-h', 'completion'}


def bridge_config():
    home = Path(os.environ.get('HERMES_HOME') or '/opt/data')
    for name in ('messaging.json', 'bridge.json'):
        path = home / 'waypoint' / name
        if path.is_file():
            config = json.loads(path.read_text(encoding='utf-8'))
            if config.get('baseUrl') and config.get('token'):
                return config
    raise SystemExit('Waypoint: GitHub access is not set up for this agent.')


def repo_token(repo):
    config = bridge_config()
    args = {'repo': repo} if repo else {}
    request = urllib.request.Request(config['baseUrl'], data=json.dumps({'tool': 'github_token', 'args': args}).encode('utf-8'), headers={'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            message = json.load(error).get('error', {}).get('message') or str(error)
        except ValueError:
            message = str(error)
        raise SystemExit('Waypoint: ' + message)
    except urllib.error.URLError as error:
        raise SystemExit('Waypoint: GitHub access is unavailable (' + str(error.reason) + ').')


def clean_repo(value):
    value = (value or '').strip()
    match = REMOTE_RE.search(value)
    if match:
        value = match.group(1)
    value = value.removesuffix('.git').strip('/')
    return value if REPO_RE.match(value) else ''


def origin_repo():
    try:
        url = subprocess.run(['git', 'config', '--get', 'remote.origin.url'], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return ''
    return clean_repo(url)


def gh_repo(args):
    for index, arg in enumerate(args):
        if arg in ('-R', '--repo') and index + 1 < len(args):
            return clean_repo(args[index + 1])
        if arg.startswith('--repo='):
            return clean_repo(arg.split('=', 1)[1])
        if arg.startswith('-R') and len(arg) > 2:
            return clean_repo(arg[2:])
    if args[:1] == ['api']:
        for arg in args[1:]:
            match = re.match(r'^/?repos/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?:/|$)', arg)
            if match:
                return match.group(1)
    if args[:1] == ['repo'] and len(args) > 2 and not args[2].startswith('-'):
        named = clean_repo(args[2])
        if named:
            return named
    return origin_repo()


def run_gh(args):
    env = dict(os.environ)
    if args and args[0] not in NO_TOKEN:
        env['GH_TOKEN'] = repo_token(gh_repo(args))['token']
        env['GH_PROMPT_DISABLED'] = '1'
    os.execve(REAL_GH, [REAL_GH, *args], env)


def git_credential(args):
    if args[:1] != ['get']:
        return
    fields = dict(line.split('=', 1) for line in sys.stdin.read().splitlines() if '=' in line)
    if fields.get('host') != 'github.com':
        return
    repo = clean_repo(fields.get('path', ''))
    if not repo:
        return
    print('username=x-access-token')
    print('password=' + repo_token(repo)['token'])


if __name__ == '__main__':
    mode, rest = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ('', [])
    if mode == 'gh':
        run_gh(rest)
    elif mode == 'credential':
        git_credential(rest)
    else:
        raise SystemExit('usage: waypoint_github.py gh ARGS | credential get')
