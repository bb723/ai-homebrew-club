"""Build the club's calling card as an Apple Wallet pass (.pkpass).

The pass is the calling card in a phone: the name of whoever carries it, the towns, and a QR
that lands on the sign-up page tagged ref=wallet, so the book shows who came in by Wallet.

  python tools/wallet/build_pass.py --who "Brett Brockway" --slug brett

Signing needs three files that never go in this repo (it is public). By default they are read
from ~/.aihc-wallet:
  pass.key   the private key the certificate request was made from
  pass.cer   the Pass Type ID certificate downloaded from developer.apple.com
  wwdr.cer   Apple's Worldwide Developer Relations intermediate (G4), from
             https://www.apple.com/certificateauthority/
The pass type identifier and the team identifier are read from pass.cer, so nothing about the
account is written here. With --unsigned the bundle is built without a signature, to check the
layout; Wallet will not open it.

Output: wallet/<slug>.pkpass at the site root, served by GitHub Pages as
application/vnd.apple.pkpass, so opening the link on an iPhone offers "Add to Apple Wallet".
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SECRETS = os.path.join(os.path.expanduser('~'), '.aihc-wallet')

# the street-poster brand (assets/site.css): charcoal, paper and spruce
CHARCOAL = (27, 27, 27)
BAND = (25, 25, 25)
PAPER = (242, 242, 239)
SPRUCE = (62, 123, 92)

TOWNS = 'Waterville · Portland, Maine'
DOOR = 'https://aihomebrewclub.com/signup.html?ref=wallet'


def mark(px, tile, lines, dot, pad=0.0):
    """The club's mark, a notice pinned to the board (assets/favicon.svg), drawn at px square."""
    s = 8  # supersample, then shrink, so the corners are smooth
    n = px * s
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inner = n * (1 - 2 * pad)
    u = inner / 92.0  # the tile is 92 units wide in the favicon's 120-unit box
    ox = oy = n * pad

    def box(x, y, w, h, r, fill):
        d.rounded_rectangle([ox + (x - 14) * u, oy + (y - 14) * u, ox + (x - 14 + w) * u, oy + (y - 14 + h) * u],
                            radius=r * u, fill=fill)

    box(14, 14, 92, 92, 10, tile)
    box(32, 38, 56, 9, 2, lines)
    box(32, 56, 40, 9, 2, lines)
    box(32, 74, 48, 9, 2, lines)
    cx, cy, r = ox + (90 - 14) * u, oy + (30 - 14) * u, 7 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=dot)
    return img.resize((px, px), Image.LANCZOS)


def png(img):
    b = io.BytesIO()
    img.save(b, 'PNG', optimize=True)
    return b.getvalue()


def images():
    out = {}
    art = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'art')
    for scale, suffix in ((1, ''), (2, '@2x'), (3, '@3x')):
        # the icon rides on notifications and the lock screen: the mark on its own charcoal tile
        out['icon' + suffix + '.png'] = png(mark(29 * scale, CHARCOAL, PAPER, SPRUCE))
        # the club's name in its own face, and the poster across the pass: rendered by render.sh
        for name in ('logo', 'strip'):
            with open(os.path.join(art, name + suffix + '.png'), 'rb') as f:
                out[name + suffix + '.png'] = f.read()
    return out


def rgb(c):
    return 'rgb(%d, %d, %d)' % c


def pass_json(who, slug, pass_type, team):
    return {
        'formatVersion': 1,
        'passTypeIdentifier': pass_type,
        'teamIdentifier': team,
        'serialNumber': 'calling-card-' + slug,
        'organizationName': 'The AI Homebrew Club',
        'description': 'The AI Homebrew Club calling card, ' + who,
        # the home page's poster as a pass: the paper strip with the shout and the scrap, on the
        # charcoal band. The club's name is in the logo picture, so there is no logoText.
        'backgroundColor': rgb(BAND),
        'foregroundColor': rgb((255, 255, 255)),
        'labelColor': rgb((185, 185, 180)),
        'sharingProhibited': False,
        'barcodes': [{
            'format': 'PKBarcodeFormatQR',
            'message': DOOR,
            'messageEncoding': 'iso-8859-1',
            'altText': 'aihomebrewclub.com/signup',
        }],
        # a store card is the pass style that carries a strip picture; nothing is printed over it
        'storeCard': {
            'secondaryFields': [
                {'key': 'name', 'label': 'NEIGHBORS TEACHING NEIGHBORS', 'value': who},
            ],
            'auxiliaryFields': [
                {'key': 'towns', 'label': 'WHERE', 'value': TOWNS},
                {'key': 'cost', 'label': 'COST', 'value': 'Free, no vendors'},
            ],
            'backFields': [
                {'key': 'what', 'label': 'What it is',
                 'value': 'Neighbors teaching neighbors to put AI to work. Bring one real task from your week; '
                          'somebody sits with you until it moves. Free, no tickets, no vendors.'},
                {'key': 'join', 'label': 'Join the club', 'value': DOOR},
                {'key': 'dates', 'label': 'Dates', 'value': 'https://aihomebrewclub.com/events.html?ref=wallet'},
            ],
        },
    }


def openssl(*args, **kw):
    return subprocess.run(['openssl'] + list(args), check=True, capture_output=True, **kw)


def cert_ids(cer):
    """The pass type identifier and the team identifier, as Apple wrote them into the certificate."""
    out = openssl('x509', '-inform', 'DER', '-in', cer, '-noout', '-subject', '-nameopt', 'RFC2253').stdout.decode()
    uid = re.search(r'UID=([^,\n]+)', out)
    ou = re.search(r'OU=([^,\n]+)', out)
    if not uid or not ou:
        sys.exit('could not read the pass type and team from ' + cer + ':\n' + out)
    return uid.group(1).strip(), ou.group(1).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--who', default='Brett Brockway')
    ap.add_argument('--slug', default='brett')
    ap.add_argument('--secrets', default=SECRETS)
    ap.add_argument('--out', default=os.path.join(ROOT, 'wallet'))
    ap.add_argument('--unsigned', action='store_true')
    a = ap.parse_args()

    key = os.path.join(a.secrets, 'pass.key')
    cer = os.path.join(a.secrets, 'pass.cer')
    wwdr = os.path.join(a.secrets, 'wwdr.cer')
    if a.unsigned:
        pass_type, team = 'pass.example.unsigned', 'UNSIGNED00'
    else:
        for f in (key, cer, wwdr):
            if not os.path.isfile(f):
                sys.exit('missing ' + f + ' (see the notes at the top of this file)')
        pass_type, team = cert_ids(cer)

    files = images()
    files['pass.json'] = json.dumps(pass_json(a.who, a.slug, pass_type, team), indent=2, ensure_ascii=False).encode('utf-8')
    files['manifest.json'] = json.dumps({n: hashlib.sha1(b).hexdigest() for n, b in files.items()}, indent=2).encode('utf-8')

    if not a.unsigned:
        with tempfile.TemporaryDirectory() as t:
            man, sig = os.path.join(t, 'manifest.json'), os.path.join(t, 'signature')
            cert_pem, wwdr_pem = os.path.join(t, 'pass.pem'), os.path.join(t, 'wwdr.pem')
            with open(man, 'wb') as f:
                f.write(files['manifest.json'])
            openssl('x509', '-inform', 'DER', '-in', cer, '-out', cert_pem)
            openssl('x509', '-inform', 'DER', '-in', wwdr, '-out', wwdr_pem)
            openssl('smime', '-binary', '-sign', '-certfile', wwdr_pem, '-signer', cert_pem, '-inkey', key,
                    '-in', man, '-out', sig, '-outform', 'DER')
            with open(sig, 'rb') as f:
                files['signature'] = f.read()

    os.makedirs(a.out, exist_ok=True)
    dest = os.path.join(a.out, a.slug + ('-unsigned' if a.unsigned else '') + '.pkpass')
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            z.writestr(n, b)
    print(dest, os.path.getsize(dest), 'bytes;', 'unsigned' if a.unsigned else 'signed as ' + pass_type)


if __name__ == '__main__':
    main()
