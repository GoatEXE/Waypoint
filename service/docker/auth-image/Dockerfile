FROM nousresearch/hermes-agent@sha256:d4da4a40cd7a28aba983775d9fd31d94cbf153eeb0cb9e844d6d0f612b7c24db

# Hermes normally keeps auth.json under each HERMES_HOME. Waypoint supplies one
# Docker volume for the CEO and pods so OAuth refresh locks and atomic writes use
# the same file, including across containers.
USER root
RUN python3 - <<'PY'
from pathlib import Path

source = Path('/opt/hermes/hermes_cli/auth.py')
text = source.read_text(encoding='utf-8')
old = '    path = get_hermes_home() / "auth.json"'
new = '    path = Path(os.environ["WAYPOINT_AUTH_FILE"]) if os.environ.get("WAYPOINT_AUTH_FILE") else get_hermes_home() / "auth.json"'
assert text.count(old) == 1, 'Hermes auth store path changed; review this overlay before building'
source.write_text(text.replace(old, new), encoding='utf-8')
PY
ENV WAYPOINT_AUTH_FILE=/opt/waypoint-auth/auth.json
LABEL com.waypoint.shared-auth="true"
