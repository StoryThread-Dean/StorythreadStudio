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
    "relation_not_allowed",
    "duplicate_entity_id",
    "duplicate_fact_id",
    "version_conflict",
    # Something on disk is wrong.
    "source_corrupt",
    "schema_unsupported",
    "index_dirty",
    "migration_incomplete",
    "run_not_found",
    "report_not_found",
    "entity_not_empty",
}

# Which HTTP status each code travels as. Kept in one table so two routes
# cannot disagree about whether a missing Thread is a 404 or a 400.
_STATUS = {
    "entity_not_found": 404,
    "fact_not_found": 404,
    "anchor_not_found": 404,
    "scene_tombstoned": 404,
    "type_invalid": 400,
    "tie_endpoint_invalid": 400,
    "relation_not_allowed": 400,
    "duplicate_entity_id": 409,
    "duplicate_fact_id": 409,
    "version_conflict": 409,
    "source_corrupt": 422,
    "schema_unsupported": 422,
    "index_dirty": 503,
    "migration_incomplete": 409,
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
