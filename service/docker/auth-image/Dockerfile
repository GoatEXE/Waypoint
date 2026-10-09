FROM nousresearch/hermes-agent@sha256:d4da4a40cd7a28aba983775d9fd31d94cbf153eeb0cb9e844d6d0f612b7c24db




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
ARG GH_VERSION=2.102.0
ARG GH_SHA256=bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386
RUN curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
 && echo "${GH_SHA256}  /tmp/gh.tgz" | sha256sum -c - \
 && tar -xzf /tmp/gh.tgz -C /tmp \
 && install -D -m 0755 "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /opt/gh/bin/gh \
 && rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_amd64"
COPY waypoint_github.py /usr/local/lib/waypoint/waypoint_github.py
RUN printf '#!/bin/sh\nexec python3 /usr/local/lib/waypoint/waypoint_github.py gh "$@"\n' > /usr/local/bin/gh \
 && printf '#!/bin/sh\nexec python3 /usr/local/lib/waypoint/waypoint_github.py credential "$@"\n' > /usr/local/bin/waypoint-git-credential \
 && chmod 0755 /usr/local/bin/gh /usr/local/bin/waypoint-git-credential \
 && git config --system credential.https://github.com.helper '!/usr/local/bin/waypoint-git-credential' \
 && git config --system credential.https://github.com.useHttpPath true
LABEL com.waypoint.github-cli="true"
