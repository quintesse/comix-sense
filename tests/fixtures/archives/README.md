# Archive test fixtures

`test_read_format_rar*.rar` are decoded from the corresponding `.rar.uu`
files in [libarchive's test suite](https://github.com/libarchive/libarchive/tree/03b426003adf12c1eb4c34e72bedb4c2bf1ba8d3/libarchive/test).
They contain test text/binary data, not commercial comics. The upstream BSD
license and copyright notices are retained in LICENSE.libarchive, NOTICE.rar
and NOTICE.rar5. `tools/fetch-archive-fixtures.mjs` reproduces the binary
fixtures from that pinned revision (network needed only to refresh fixtures).

`tests/archive-fixtures.ts` creates additional original stored-RAR4 and ZIP
fixtures from a one-pixel image and original test dialogue. No native archiver
is needed to run these tests. RAR fixtures cover RAR4, RAR5, solid RAR5,
encryption, hard links and symbolic links; generated fixtures also cover
unsafe/duplicate paths, unsupported methods, forged sizes and corruption.
