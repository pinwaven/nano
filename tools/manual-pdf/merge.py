#!/usr/bin/env python3
"""Stage 3 of 3 — join the cover and body into docs/user-manual/end-user-guide.pdf."""
import os
from pypdf import PdfWriter, PdfReader

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.abspath(HERE + '/../../docs/user-manual/end-user-guide.pdf')

w = PdfWriter()
for part in ('_cover.pdf', '_body.pdf'):
    for page in PdfReader(os.path.join(HERE, part)).pages:
        w.add_page(page)
w.add_metadata({'/Title': 'Waven Nano — End User Guide',
                '/Subject': 'WeChat Mini Program user manual',
                '/Author': 'Waven'})
with open(OUT, 'wb') as fh:
    w.write(fh)
print(f'{OUT}\n{len(PdfReader(OUT).pages)} pages | {os.path.getsize(OUT)/1048576:.2f} MB')
