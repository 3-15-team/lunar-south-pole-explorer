"""Maintain generated sections of docs/VALIDATION.md between <!-- BEGIN:x --> / <!-- END:x --> markers."""

from __future__ import annotations

import re

from ._common import DOCS

PATH = DOCS / "VALIDATION.md"
HEADER = """# VALIDATION

How we check that our numbers are right. Sections marked *generated* are rewritten by the pipeline jobs
(`make validate`); text outside the markers is hand-written. Reference rasters are used **only** as a
sanity check — every product shown in the app is computed by us.
"""


def update_section(key: str, title: str, body: str) -> None:
    text = PATH.read_text() if PATH.exists() else HEADER
    block = f"<!-- BEGIN:{key} -->\n## {title} (generated)\n\n{body.rstrip()}\n<!-- END:{key} -->"
    pat = re.compile(rf"<!-- BEGIN:{re.escape(key)} -->.*?<!-- END:{re.escape(key)} -->", re.S)
    if pat.search(text):
        text = pat.sub(lambda _m: block, text)
    else:
        text = text.rstrip() + "\n\n" + block + "\n"
    PATH.write_text(text)
