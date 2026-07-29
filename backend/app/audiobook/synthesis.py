# audiobook/synthesis.py -- the pluggable speech backend seam.
# =============================================================
# The generation engine (generation.py) never knows WHICH engine renders a
# segment -- it talks to this interface. The kokoro-worker subprocess plugs
# in here later in Stage B; the OpenRouter/NanoGPT speech providers plug in
# during Stage D. Tests plug in fakes. One seam, many engines -- the same
# philosophy as the writing side's provider registry.

class SynthesisError(Exception):
    """
    A segment failed to synthesize.

    `retryable` drives the retry cap (spec 20.1): timeouts and transient
    server errors may be retried automatically (at most twice); content
    refusals and permanent errors are never auto-retried -- each retry may
    bill, and the cost tracker counts every attempt pessimistically.
    """

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class SynthesisBackend:
    """
    One speech engine. Implementations override synthesize().

    synthesize() is deliberately SYNCHRONOUS: the generation loop runs on
    a worker thread (one segment at a time by design), and every real
    engine call is either a local subprocess request or one HTTP round
    trip. Returns (audio_bytes, duration_seconds) -- duration comes from
    the engine so the truncation check (spec 26.3) can run before any
    audio is trusted.
    """

    key: str = "base"                    # provider key ("local-kokoro", ...)
    model_id: str = ""
    engine_version: str = ""             # joins the generated-state hash (24.1)
    file_extension: str = "flac"         # canonical intermediate (26.1)

    def synthesize(self, text: str, voice_id: str,
                   speed: float = 1.0) -> tuple[bytes, float]:
        """speed carries [pace:...] spans: 1.0 = the voice's natural pace.
        Engines without a native speed control time-stretch at assembly
        instead -- the parameter is part of the universal contract."""
        raise NotImplementedError


def resolve_backend(provider: str) -> SynthesisBackend:
    """
    Look up the backend for a provider key, or raise ValueError with a
    user-facing message. Local import avoids a cycle (local_worker imports
    this module for the base class).
    """
    if provider == "local-kokoro":
        from app.audiobook import local_worker
        try:
            return local_worker.make_backend()
        except local_worker.WorkerUnavailableError as e:
            raise ValueError(str(e))
    if provider in ("openrouter", "nanogpt"):
        raise ValueError(
            "Cloud narration providers arrive in a later stage. The free "
            "local narrator ships first."
        )
    raise ValueError(f"Unknown narration provider '{provider}'.")
