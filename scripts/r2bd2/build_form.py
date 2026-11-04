#!/usr/bin/env python3
"""Embed the derived mission registry into the self-contained offline form."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / 'scripts/r2bd2/form_template.html'
MISSIONS = ROOT / 'data/geospatial/r2bd2-c1-field-intake-v1/missions.json'
OUT = ROOT / 'docs/r2b/field/FIELD-FORM-C1.html'
PLACEHOLDER = '/*__MISSIONS__*/null'


def build():
    template = TEMPLATE.read_text()
    if template.count(PLACEHOLDER) != 1:
        raise ValueError('form template must contain exactly one missions placeholder')
    payload = json.dumps(json.loads(MISSIONS.read_text()), ensure_ascii=False, separators=(',', ':'))
    # Keep embedded JSON inert inside the script element.
    payload = payload.replace('</', '<\\/').replace('<!--', '<\\!--')
    return template.replace(PLACEHOLDER, payload)


if __name__ == '__main__':
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build())
    print(OUT)
