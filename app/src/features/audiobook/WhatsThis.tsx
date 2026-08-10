// features/audiobook/WhatsThis.tsx -- moved, re-exported here
// ============================================================
// The component now lives in components/learn/, because explaining itself
// is not an audiobook concern -- Settings, the Weave, and anything else
// that has to teach as it goes wants the same affordance, and a shared one
// keeps them all looking and behaving identically.
//
// This file stays so the audiobook panels that import it are untouched by
// the move. Same trick as the backend's stable_ids extraction: relocate the
// implementation, leave the old door where it was.

export { WhatsThis } from "../../components/learn/WhatsThis";
