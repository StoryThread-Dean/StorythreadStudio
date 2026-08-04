# app/audiobook -- the Audiobook Converter backend package (v1.1.0 feature).
#
# A standalone workspace that turns a manuscript (DOCX / EPUB / Markdown /
# TXT, or an existing Storythread writing project) into narration-ready
# text and, in later stages, generated audio and exported audiobooks.
#
# Stage A (this package's first slice) covers the FOUNDATION:
#   extraction/       one extractor per source format -> chapters of text
#   workspace.py      the audiobook workspace folder: manifest + text layers
#   import_service.py the import pipeline gluing extraction to a workspace
#   markers.py        [pause:0.8]-style narration markers (text is truth)
#   pronunciation.py  pronunciation rules + TTS payload preparation
#   recents_store.py  app-level SQLite index of known audiobook workspaces
#
# Full specification: docs/audiobook-converter-spec.md.
