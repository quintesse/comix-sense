# Bundled archive decoder notices

The application uses @zip.js/zip.js 2.24.0 (BSD-3-Clause) and libarchive.js
2.0.2 (MIT). The latter's WASM reports libarchive 3.7.2. npm versions and
integrities are pinned in package-lock.json.

`tools/prepare-archive-codecs.mjs` copies the libraries' notices and all files
in this directory into `static/codecs/`, then into the static production build.
No codec is downloaded at runtime from npm or a CDN.

libarchive.js's published build recipe links libarchive, zlib, bzip2, liblzma
and OpenSSL, using Emscripten. Their upstream notices are retained here:

- libarchive 3.7.2: libarchive.COPYING
- zlib 1.3: zlib.LICENSE
- bzip2 1.0.8: bzip2.LICENSE
- XZ Utils 5.2.11 / public-domain liblzma: xz.COPYING
  (the accompanying LGPL text is also preserved; the CLI tools are not shipped)
- OpenSSL 1.0.2s / SSLeay: openssl.LICENSE
- Emscripten: emscripten.LICENSE (MIT/University of Illinois alternatives)

Build recipe source:
https://github.com/nika-begiashvili/libarchivejs/blob/master/lib/tools/docker/Dockerfile
https://github.com/nika-begiashvili/libarchivejs/blob/master/lib/tools/build.sh

The unmodified Emscripten loader supports multiple environments. In this app
it runs only in a browser worker; its Node environment branches are never
selected. No Node shim, filesystem extraction API or native program is used.
