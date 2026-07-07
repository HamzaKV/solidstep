---
'solidstep': patch
---

Fix `SerovalChunkReader` corrupting a frame when the 12-byte length header
itself arrives split across two stream reads (a network chunk boundary
landing inside the header rather than the payload). Previously this could
parse a truncated header as a plausible-looking but wrong byte length,
misaligning that frame and every one after it in the same stream. Now the
reader buffers until the full header is present before decoding it, and
throws a clear "truncated header" error if the stream ends first.
