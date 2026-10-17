"""The committed catalogue JSON (app/catalog/data) equals a fresh export from the TypeScript sources, and the
collation weights match the Node ICU they were derived from."""

import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


@pytest.mark.skipif(not shutil.which('node'), reason='node not installed')
def test_catalog_is_up_to_date():
    r = subprocess.run(['node', 'backend/tools/export_catalog.mjs', '--check'], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr + r.stdout


@pytest.mark.skipif(not shutil.which('node'), reason='node not installed')
def test_collation_weights_match_node_icu():
    with open(os.path.join(ROOT, 'backend/app/js_collation.json'), encoding='utf-8') as f:
        icu = json.load(f)['icu']
    out = subprocess.run(['node', '-p', 'process.versions.icu'], capture_output=True, text=True, check=True).stdout.strip()
    assert out == icu, f'Node ICU {out} != {icu}: run node backend/tools/gen_collation.mjs and the js golden tests'
