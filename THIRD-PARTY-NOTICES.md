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

## libarchive

`unzip-archive` reads 7z, rar, tar and encrypted zip archives with
[libarchive.js](https://github.com/nika-begiashvili/libarchivejs) (MIT), which is a WebAssembly
build of the C library [libarchive](https://github.com/libarchive/libarchive). The compiled
`.wasm` is redistributed by this site — it is staged into `public/third-party/libarchive/` and
served to every visitor who opens a non-zip archive — and libarchive's licence requires its
copyright notice to travel with a binary redistribution. Hence this section.

Text copied verbatim from the notice at the bottom of
<https://github.com/libarchive/libarchive/blob/master/COPYING> (fetched 2026-09-03). The same
file records that a few sources carry additional terms — the compress filter and `mtree.5`
carry a 3-clause UC Regents notice, `archive_parse_date.c` is public domain, and the BLAKE2
files are triple-licensed CC0-1.0 / OpenSSL / Apache-2.0 — none of which conflict with MIT
redistribution.

```
Copyright (c) 2003-2018 <author(s)>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer
   in this position and unchanged.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR(S) ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR(S) BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The wrapper itself, libarchive.js, is MIT. Its notice, from the `LICENSE` file in the installed
`libarchive.js@2.0.2` package:

```
MIT License

Copyright (c) 2018 ნიკა

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
