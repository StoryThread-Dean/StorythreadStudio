# ai/local_endpoint.py -- What "Local model" is allowed to mean
# ==============================================================
# A writer can point Storythread Studio at a model running on their own
# machine (Ollama, LM Studio, llama.cpp) instead of a paid cloud service.
# That address is stored in settings as `local_base_url`.
#
# The important word is LOCAL. Every one of these runtimes speaks the same
# OpenAI-compatible HTTP API that OpenRouter and NanoGPT speak, which means
# an unvalidated `local_base_url` would happily point at ANY server on the
# internet. "Local model" would quietly become an undocumented way to add
# arbitrary remote providers -- with no key field, no cost warning, and no
# provider entry explaining what the writer had connected to.
#
# So this module draws the line deliberately: loopback, private networks,
# and .local names only. Supporting arbitrary remote OpenAI-compatible
# endpoints may well be worth doing one day, but it should be a decision
# somebody makes on purpose, with its own UI and its own warnings -- not a
# side effect of a text box that says "Local model".
#
# Think of it like a house intercom. It is wired to rooms in the building.
# You could in principle splice the wire into the public phone network, but
# then it is not an intercom any more, and everyone using it still thinks
# it is.

import ipaddress
from urllib.parse import urlparse, urlunparse

# How long to wait for the local server at each stage. These are much
# shorter than the cloud timeouts because "on this machine" either answers
# almost immediately or is not running at all -- there is no transatlantic
# hop to be patient about. Generation still uses the normal long timeout
# (openrouter.REQUEST_TIMEOUT), since a local model can genuinely think for
# minutes on a slow GPU.
LOCAL_CONNECT_TIMEOUT = 3.0
LOCAL_LIST_TIMEOUT = 10.0

# The two shapes a local runtime can speak.
#
# NARROWED 2026-08-23, and the narrowing is the fix for a shipped bug. This
# setting used to choose the CHAT transport as well as the model list, and the
# chat half could not work: for "ollama" the address stayed at the bare root
# while run_completion and run_chat POST to a hardcoded {base}/chat/completions,
# which Ollama does not serve. So a writer who picked Ollama native got a
# passing Test Connection, a full model dropdown, and a 404 on every single AI
# action. Nothing announced it, because listing and generation used the same
# address for different things.
#
# It is now a MODEL LISTING choice and nothing else -- which is the only thing
# it ever controlled correctly. The two runtimes really do list models in
# different places (`/api/tags` vs `/v1/models`), and Ollama's `/api/tags` is
# also where the parameter size, quantization and family of each model come
# from, so the choice earns its keep. CHAT always goes to the
# OpenAI-compatible `/v1/chat/completions`, which Ollama's compatibility layer,
# LM Studio, llama.cpp and vLLM all serve. See chat_base_url below.
#
# Still never guessed up front: sniffing would mean firing requests at an
# unknown port and inferring from what comes back, which is slow, occasionally
# wrong, and impossible to explain in an error message. Test Connection tries
# the writer's choice, and if the OTHER one answers it CORRECTS the setting and
# says it did.
LOCAL_API_STYLES = ("openai", "ollama")

# Shown to the writer whenever an address is rejected, so the message
# explains the rule rather than just refusing.
ALLOWED_HOST_NOTE = (
    "Local model addresses must point at your own machine or network: "
    "localhost, 127.0.0.1, a private address like 192.168.1.50, or a "
    "name ending in .local."
)


def _host_is_local(host: str) -> bool:
    """
    Is this hostname one that can only mean "here" or "my network"?

    Three accepted shapes:
      - the literal name "localhost"
      - anything ending in ".local" (mDNS/Bonjour, e.g. "studio-pc.local")
      - an IP address that is loopback (127.x, ::1) or private
        (10.x, 172.16-31.x, 192.168.x, and link-local)

    Anything else -- a public hostname, a public IP -- is rejected.
    """
    host = (host or "").strip().lower()
    if not host:
        return False
    if host == "localhost" or host.endswith(".local"):
        return True

    # Strip the brackets IPv6 hosts wear inside a URL: "[::1]" -> "::1"
    bare = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    try:
        address = ipaddress.ip_address(bare)
    except ValueError:
        # Not an IP literal, and it was not localhost or .local, so it is
        # a real DNS name pointing somewhere out on the internet.
        return False
    return address.is_loopback or address.is_private


def validate_local_base_url(raw: str) -> str:
    """
    Check a writer-entered local address and return it in canonical form.

    Returns "scheme://host[:port]" with any path, query, and trailing slash
    stripped -- the PATH is added later by normalize_base_url(), because
    which path is correct depends on the API style.

    Raises ValueError with a writer-facing message on anything invalid.
    Callers surface that message directly; it is written to be read by a
    novelist, not a developer.
    """
    text = (raw or "").strip()
    if not text:
        raise ValueError("Enter the address of your local model server.")

    # A bare "localhost:11434" is what most people type, and urlparse reads
    # that as scheme="localhost" with no host at all. Assume http:// so the
    # obvious input does the obvious thing.
    if "://" not in text:
        text = "http://" + text

    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(
            f"'{parsed.scheme}' is not an address Storythread Studio can call. "
            "Use http:// or https://."
        )
    if not parsed.hostname:
        raise ValueError(f"'{raw}' is not a complete address. {ALLOWED_HOST_NOTE}")
    if not _host_is_local(parsed.hostname):
        raise ValueError(
            f"'{parsed.hostname}' is not a local address, so it cannot be used "
            f"as a Local model. {ALLOWED_HOST_NOTE}"
        )

    # netloc keeps the port and the IPv6 brackets exactly as given, which is
    # what we want to hand back to httpx.
    return urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")).rstrip("/")


def normalize_base_url(raw: str, style: str) -> str:
    """
    The URL to LIST MODELS at, for a given API style.

    Chat does not come through here any more -- see chat_base_url. This
    function answers one question: given the writer's declared runtime, where
    does its model catalog live?

    The two runtimes disagree about where their API lives, and writers
    reasonably paste whichever URL their tool showed them:

      openai style (LM Studio, llama.cpp, Ollama's compatibility layer)
        -> needs the OpenAI-compatible root, which ends in /v1
      ollama style (Ollama's own API)
        -> needs the bare root; its endpoints live under /api/

    So "http://localhost:11434" and "http://localhost:11434/v1" both work,
    and the writer never has to know which one we wanted. Settings shows
    the normalized result underneath the field so the guess is visible
    rather than mysterious.
    """
    base = validate_local_base_url(raw)
    if style == "ollama":
        return base
    # openai style (the default): ensure exactly one /v1 on the end.
    return base if base.endswith("/v1") else base + "/v1"


def chat_base_url(raw: str) -> str:
    """
    Where to send a CHAT request, whatever the writer chose for listing.

    Always the OpenAI-compatible root. Ollama's compatibility layer has served
    /v1/chat/completions for a long time, and it is the only shape LM Studio,
    llama.cpp and vLLM all speak -- so there is exactly one chat transport and
    no setting that can point it somewhere that does not answer.

    This is deliberately NOT style-aware, and that is the whole point: the
    style setting used to reach generation, where its "ollama" value resolved
    to a path Ollama does not serve. A writer could not have diagnosed that,
    because the same setting was making the model list work correctly at the
    same time.

    Kept as its own function rather than a flag on normalize_base_url so the
    two questions cannot be confused again at a call site: "where do I list
    models" and "where do I send a prompt" now have different names.
    """
    return normalize_base_url(raw, "openai")
