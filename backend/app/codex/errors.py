# codex/errors.py -- one way for the Weave to say no
# ===================================================
# The Weave's HTTP surface is larger than any existing router in this app,
# and its failures are more varied: a Thread that is gone, an anchor that no
# longer resolves, a relation that makes no sense between two kinds of thing,
# a registry written by a newer build.
#
# If each route invents its own message shape, the frontend ends up with a
# pile of string matching, and the writer gets a different tone of voice
# depending on which button they pressed. So every refusal here has:
#
#   code     a stable identifier the frontend can branch on. Never shown.
#   message  one sentence a novelist can act on. Always shown.
#   detail   optional specifics -- which id, which field, which line.
#
# The codes are a closed set on purpose. Adding one is a deliberate act, and
# a test asserts the router only ever raises codes from this list.

from fastapi import HTTPException

# Every way the Weave is allowed to refuse.
CODES = {
    # Something was asked for that is not there.
    "entity_not_found",
    "fact_not_found",
    "anchor_not_found",
    "scene_tombstoned",
    # Something was sent that cannot be accepted.
    "type_invalid",
    "tie_endpoint_invalid",
    # A connection with no reason. Its own code rather than a generic invalid,
    # because the frontend has to put the cursor in the right box.
    "reason_required",
    "relation_not_allowed",
    "duplicate_entity_id",
    "duplicate_fact_id",
    "version_conflict",
    # A file the writer picked from OUTSIDE this project cannot be used. Its own
    # code because nothing here was looked up and nothing here is corrupt: the
    # problem is the file they chose, and the message has to point at that.
    "import_unreadable",
    # Something on disk is wrong.
    "source_corrupt",
    "schema_unsupported",
    "index_dirty",
    "migration_incomplete",
    "run_not_found",
    "report_not_found",
    "entity_not_empty",
    # A word that already means something else. Its own code because the
    # frontend has to name the entry that already has it -- "invalid" would
    # leave the writer guessing which of their entries it collided with.
    "alias_taken",
    # ── The Profile Extractor (v2.0.1) ──────────────────────────────────────
    # A new run would replace proposals the writer has not looked at yet. Its
    # own code, and a 409 rather than a 400, because the frontend has to offer
    # a CHOICE here: the count travels in `detail` so the confirm can say how
    # many things are about to be thrown away. Treating it as a generic invalid
    # would make it an error message about a thing the writer is allowed to do.
    "extraction_would_replace",
    # Asked to work through an extraction that is not there -- usually a screen
    # left open while another one discarded the run.
    "extraction_missing",
    # A selection with no readable chapters in it. Separate from "missing"
    # because nothing is wrong: the writer ticked nothing, or ticked chapters
    # that could not be read.
    "extraction_empty",
    # More text than this pass will send in one request.
    "extraction_too_long",
    # A proposal for an entry that does not exist yet. The writer creates it
    # first; guessing would write a profile nobody asked for.
    "extraction_no_target",
}

# Which HTTP status each code travels as. Kept in one table so two routes
# cannot disagree about whether a missing Thread is a 404 or a 400.
_STATUS = {
    "import_unreadable": 400,
    "entity_not_found": 404,
    "fact_not_found": 404,
    "anchor_not_found": 404,
    "scene_tombstoned": 404,
    "type_invalid": 400,
    "tie_endpoint_invalid": 400,
    "reason_required": 400,
    "relation_not_allowed": 400,
    "duplicate_entity_id": 409,
    "duplicate_fact_id": 409,
    "version_conflict": 409,
    "source_corrupt": 422,
    "schema_unsupported": 422,
    "index_dirty": 503,
    "migration_incomplete": 409,
    "alias_taken": 409,
    "extraction_would_replace": 409,
    "extraction_missing": 404,
    "extraction_empty": 400,
    "extraction_too_long": 400,
    "extraction_no_target": 400,
    "run_not_found": 404,
    "report_not_found": 404,
    "entity_not_empty": 409,
}


class CodexError(HTTPException):
    """
    A refusal with a code the frontend can branch on and a sentence the
    writer can read.

    Subclasses HTTPException so FastAPI handles it with no extra wiring, and
    so a route can raise it in the middle of ordinary code.
    """

    def __init__(self, code: str, message: str, detail: str = ""):
        if code not in CODES:
            # A typo'd code would silently become an un-branchable error.
            raise ValueError(f"Unknown Codex error code: {code!r}")
        self.code = code
        self.message = message
        self.extra = detail
        super().__init__(
            status_code=_STATUS.get(code, 400),
            detail={"code": code, "message": message, "detail": detail},
        )
