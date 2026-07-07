---
'solidstep': patch
---

Fix `FilesystemCacheStore.delete()` leaving stale references in the tag
index (`__tags.json`). Deleting a key directly (e.g. via `revalidatePath`/
`invalidateCache`, not `invalidateTag`) previously only removed its value
file, so the tag index kept referencing an already-deleted key forever.
`delete()` now prunes the key from every tag it was registered under.

Also serializes every read-modify-write of the tag index (in `set`,
`delete`, and `invalidateTag`) through a per-store-instance lock: without
it, concurrent writers (e.g. `invalidateTag`'s parallel per-key deletes)
could corrupt the index's atomic-rename swap on Windows.
