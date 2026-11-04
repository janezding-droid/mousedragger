"""Pinned, bounded training-only downloader. No test data or labels are opened."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import os
from pathlib import Path
import urllib.request


def download(manifest, destination):
    selection = json.loads(Path(manifest).read_text(encoding='utf-8'))
    entries = selection['files']
    assert all(e['path'].startswith('training_files/') and '..' not in e['path'].split('/') for e in entries)
    assert sum(e['size'] for e in entries) <= 5_000_000_000
    root = Path(destination)
    root.mkdir(parents=True, exist_ok=True)

    def fetch(e):
        p = root / e['path']
        p.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/balabit/Mouse-Dynamics-Challenge/{selection['commit']}/{e['path']}"
        if not p.exists():
            request = urllib.request.Request(url, headers={'User-Agent': 'bounded-public-data-research'})
            with urllib.request.urlopen(request, timeout=90) as response:
                content_length = response.headers.get('Content-Length')
                if content_length and int(content_length) != e['size']:
                    raise ValueError('Remote size differs from pinned tree')
                data = response.read(e['size'] + 1)
            if len(data) != e['size']:
                raise ValueError('Truncated or oversized response')
            temp = p.with_suffix('.part')
            temp.write_bytes(data)
            os.replace(temp, p)
        data = p.read_bytes()
        assert len(data) == e['size']
        git_sha = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        assert git_sha == e['sha'], 'Content does not match pinned Git blob'
        return {**e, 'url': url, 'sha256': hashlib.sha256(data).hexdigest(),
                'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'license': 'No explicit license file in pinned repository; research availability statement in README; no raw redistribution'}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        ledger = list(pool.map(fetch, entries))
    (root / 'download-ledger.json').write_text(json.dumps(ledger, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(ledger), 'bytes': sum(e['size'] for e in ledger)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest')
    parser.add_argument('destination')
    args = parser.parse_args()
    download(args.manifest, args.destination)
