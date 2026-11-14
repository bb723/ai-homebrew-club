#!/bin/bash
# Re-render the Wallet pass art (tools/wallet/art/*.png) from tools/wallet/art.html.
# Needs the site served from the repo root (python -m http.server 8000) and Chrome.
# Only needed when the brand changes: the rendered pictures are kept in the repo.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CH="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
PROF="$(mktemp -d)"
mkdir -p "$HERE/art"
shot() { "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=3 --virtual-time-budget=6000 \
  --user-data-dir="$PROF" --window-size="$2" --screenshot="$HERE/art/$1@3x.png" "http://localhost:8000/tools/wallet/art.html?part=$1" >/dev/null 2>&1; }
shot strip 375,123
shot logo 160,50
python - "$HERE/art" <<'EOF'
import sys
from PIL import Image
d = sys.argv[1]
for name, w, h in (('strip', 375, 123), ('logo', 160, 50)):
    big = Image.open('%s/%s@3x.png' % (d, name)).convert('RGB')
    assert big.size == (w * 3, h * 3), (name, big.size)
    big.save('%s/%s@3x.png' % (d, name), optimize=True)
    big.resize((w * 2, h * 2), Image.LANCZOS).save('%s/%s@2x.png' % (d, name), optimize=True)
    big.resize((w, h), Image.LANCZOS).save('%s/%s.png' % (d, name), optimize=True)
    print('rendered', name)
EOF
