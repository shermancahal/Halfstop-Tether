#!/usr/bin/env python3
"""Redact owner-identifying camera values from a probe-output tree.

For rewriting history. tools/scrub.mjs is the one to use on a working tree;
this exists because git filter-branch checks out old commits that predate
src/camera/privacy.mjs and so cannot import it. Same three formats, same
rules, no dependencies, and no imports from the tree it runs inside.

    cd ~/Documents/Claude/Halfstop-Tether
    git tag backup-before-scrub main
    FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f \
      --tree-filter "python3 $PWD/tools/scrub-history.py" d3dc052^..main
    git push --force-with-lease origin main

Rewriting published history does not unpublish anything. Anyone who cloned
keeps what they cloned, and GitHub serves unreferenced commits by SHA until it
collects them; ask GitHub Support to purge if that matters.
"""
import json, os, re, sys

PRIVATE = re.compile(r'serial|artist|copyright|comment|owner|username|nickname', re.I)
R = '[redacted]'


def scrub_dump(text):
    """gphoto2's block format: path / Label / Readonly / Type / Current / END."""
    out, private = [], False
    for line in text.split('\n'):
        if line.startswith('/'):
            private = bool(PRIVATE.search(line)); out.append(line); continue
        m = re.match(r'^Label:\s*(.*)$', line)
        if m:
            private = private or bool(PRIVATE.search(m.group(1))); out.append(line); continue
        if line == 'END':
            private = False; out.append(line); continue
        if private and re.match(r'^Current:\s*\S', line):
            out.append('Current: ' + R); continue
        out.append(line)
    return '\n'.join(out)


def scrub_summary(text):
    """The summary states it twice more: a header line and a property listing."""
    text = re.sub(r'(?im)^(\s*serial\s*number\s*:\s*)(\S.*)$', r'\1' + R, text)

    def prop(m):
        label, middle, value = m.group(1), m.group(2), m.group(3)
        return f"{label}{middle}'{R}'" if (PRIVATE.search(label) and value) else m.group(0)

    return re.sub(r"(?im)^(.*?)(\([0-9a-f]{4}\s+(?:ro|rw)\s+\w+\s*\):\s*)'(.*)'$", prop, text)


changed = 0
for root, _dirs, files in os.walk('probe-output'):
    for name in files:
        path = os.path.join(root, name)
        try:
            if name == 'report.json':
                doc = json.load(open(path))
                cfg = doc.get('phases', {}).get('config', {}).get('configs')
                if cfg:
                    for key, c in cfg.items():
                        if isinstance(c, dict) and c.get('value') and PRIVATE.search(f"{key} {c.get('label') or ''}"):
                            c['value'] = R
                if doc.get('phases', {}).get('summary'):
                    doc['phases']['summary'] = scrub_summary(doc['phases']['summary'])
                json.dump(doc, open(path, 'w'), indent=2)
                open(path, 'a').write('\n')
                changed += 1
            elif name.endswith('.txt'):
                text = open(path, errors='ignore').read()
                open(path, 'w').write(scrub_summary(scrub_dump(text)))
                changed += 1
        except Exception as error:
            print(f'scrub-history: {path}: {error}', file=sys.stderr)
