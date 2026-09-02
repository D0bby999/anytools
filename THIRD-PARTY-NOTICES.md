# Third-party notices

anytools is MIT licensed. This file records third-party code whose licence requires its
copyright and permission notice to be reproduced.

Ordinary npm dependencies are not listed here — their licences travel with them in
`node_modules` and are not redistributed as our source. This file is for code that was read
and adapted into this repository.

---

## omni-tools

`packages/anytools-tools/src/extract-images-from-pdf/logic.ts` was written with reference to
the approach in `src/pages/tools/pdf/extract-images-from-pdf/service.ts` from
[iib0011/omni-tools](https://github.com/iib0011/omni-tools) — specifically the technique of
walking a pdf.js page's operator list for `OPS.paintImageXObject` and resolving each name
against `page.objs`, rather than rasterising the page.

MIT requires the full permission notice, not an acknowledgement in a code comment:

```
MIT License

Copyright (c) 2024 Ibrahima Gaye Coulibaly

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Not used: it-tools

[CorentinTh/it-tools](https://github.com/CorentinTh/it-tools) is GPL-3.0. Its **catalogue**
informed which tools were worth building — a list of facts, which no licence covers — but no
code from it has been read or adapted, and none may be: this repository is MIT, and copying
GPL-3.0 code into it would both breach that licence and force the whole repository to GPL.

Tools whose idea came from that catalogue are implemented from primary specifications
(WebCrypto, the WHATWG URL Standard, MDN, the Open Graph protocol) and their commits say which.
