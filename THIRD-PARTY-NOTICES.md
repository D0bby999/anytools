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

## zxing-wasm

`barcode-generator` and `qr-barcode-scanner` encode and decode barcodes with
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (MIT), pinned at 3.1.3. The compiled
`zxing_full.wasm` it ships is redistributed by this site — staged into
`public/third-party/zxing/` and served to every visitor who scans or generates a code — so the
notices of everything inside that binary have to travel with it. Three licences apply:

| Component | Role | Licence |
|---|---|---|
| zxing-wasm | the JS/TS wrapper and the Emscripten build | MIT |
| [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) | barcode **reading** | Apache-2.0 |
| [zint](https://sourceforge.net/projects/zint/) (backend only) | barcode **writing** | BSD-3-Clause |

A note on zint, because its licensing is easy to get wrong: zint's own `LICENSE` records that
the 2013 relicensing "is done for backend and therefore for ZINT shared library only, for the
frontends and Qt4-backend the GPL is still valid". Only the backend is bundled here — zxing-cpp
vendors `core/src/libzint/` (`library.c`, `common.c`, `raster.c`, `svg.c`, the Reed–Solomon and
GS1 code and the embedded HRI fonts) and compiles nothing from zint's frontends. The shipped
`zxing_full.wasm` contains no GPL string. This repository is MIT and could not carry the
frontends.

### zxing-wasm — MIT

Copied from `LICENSE` in the installed `zxing-wasm@3.1.3` package.

```
MIT License

Copyright (c) 2023 Ze-Zheng Wu

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

### zxing-cpp — Apache-2.0

Copyright 2019 Axel Waggershauser and the zxing-cpp contributors; earlier portions Copyright
ZXing authors. `SPDX-License-Identifier: Apache-2.0`, declared per source file (e.g.
`core/src/ReadBarcode.h`). Licensed under the Apache License, Version 2.0; you may not use
these files except in compliance with the License. A copy of the License is at
<http://www.apache.org/licenses/LICENSE-2.0> and at
<https://github.com/zxing-cpp/zxing-cpp/blob/master/LICENSE>. Unless required by applicable law
or agreed to in writing, software distributed under the License is distributed on an "AS IS"
BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. The zxing-cpp
sources are not modified here; they are used as compiled by zxing-wasm.

### zint (backend) — BSD-3-Clause

Reproduced verbatim from the licence header of `backend/zint.h` at
<https://raw.githubusercontent.com/zint/zint/master/backend/zint.h> (fetched 2026-09-03), which
is the notice every zint backend source carries and which clause 2 requires to accompany a
binary redistribution.

```
    libzint - the open source barcode library
    Copyright (C) 2009-2026 Robin Stuart <rstuart114@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

    1. Redistributions of source code must retain the above copyright
       notice, this list of conditions and the following disclaimer.
    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.
    3. Neither the name of the project nor the names of its contributors
       may be used to endorse or promote products derived from this software
       without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
    ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
    FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
    DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
    OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
    HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
    LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
    OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.
```

zint's `LICENSE` additionally asks, as a condition of the 2013 relicensing, that the names of
Robin Stuart and the contributors are not removed from sources or manual, and that the
documentation stays in British English. Both are honoured above.

The zint backend embeds two fonts for the human-readable text under a barcode — Arimo and a
UPC/EAN subset, `backend/fonts/normal_woff2.h` and `upcean_woff2.h`. Those files are BSD-3-Clause
like the rest of the backend, and the font data inside them is:

```
    Copyright 2013 Steve Matteson

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0
```

---

## Not used: it-tools

[CorentinTh/it-tools](https://github.com/CorentinTh/it-tools) is GPL-3.0. Its **catalogue**
informed which tools were worth building — a list of facts, which no licence covers — but no
code from it has been read or adapted, and none may be: this repository is MIT, and copying
GPL-3.0 code into it would both breach that licence and force the whole repository to GPL.

Tools whose idea came from that catalogue are implemented from primary specifications
(WebCrypto, the WHATWG URL Standard, MDN, the Open Graph protocol) and their commits say which.
