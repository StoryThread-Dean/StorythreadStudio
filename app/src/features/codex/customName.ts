// features/codex/customName.ts -- checking a name as the writer types it
// =======================================================================
// A name typed into [Custom] becomes a FOLDER or a FILE on the writer's
// disk. The backend enforces that (types_registry.custom_type_id) and is
// the authority; this is the same rule applied as they type, so they are
// told before pressing a button rather than after a round trip.
//
// DELIBERATE DUPLICATION, and worth naming as such. Two copies of a rule
// can drift, which is normally reason enough not to have two. Here the
// alternative is worse: a writer types "Order 66", presses Add, waits, and
// is then told to try again. Immediate feedback is the whole point of a
// text field. The backend still refuses anything that gets past this, so
// the failure mode of drift is an unnecessary round trip -- not bad data.

/** Names Windows refuses for a file or folder, whatever the extension. */
const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const LETTERS_AND_SPACES = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

export const CUSTOM_NAME_MAX = 32;

export interface NameCheck {
  ok: boolean;
  /** Why it was refused, in words a novelist can act on. */
  problem: string;
  /** What it will be called on disk. Shown so nothing is a surprise. */
  id: string;
}

/**
 * Check a name, and say what it will become.
 *
 * An empty field is NOT an error -- it is a field nobody has typed in yet.
 * Colouring it red before the writer has done anything would be scolding
 * them for opening a dialog.
 */
export function checkCustomName(raw: string): NameCheck {
  const tidy = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!tidy) return { ok: false, problem: "", id: "" };

  if (tidy.length > CUSTOM_NAME_MAX) {
    return {
      ok: false,
      problem: `That is too long. Keep it under ${CUSTOM_NAME_MAX} characters.`,
      id: "",
    };
  }
  if (/\d/.test(tidy)) {
    return {
      ok: false,
      problem: "Use letters only -- no numbers. This name becomes a folder on your computer.",
      id: "",
    };
  }
  if (!LETTERS_AND_SPACES.test(tidy)) {
    return {
      ok: false,
      problem: "Use letters and spaces only, with no punctuation or symbols. "
             + "This name becomes a folder on your computer.",
      id: "",
    };
  }

  const id = tidy.toLowerCase().replace(/ /g, "_");
  if (WINDOWS_RESERVED.has(id) || WINDOWS_RESERVED.has(id.split("_")[0])) {
    return {
      ok: false,
      problem: `Windows will not allow a folder called "${tidy}". Try another name.`,
      id: "",
    };
  }

  return { ok: true, problem: "", id };
}

/** The tidied, title-cased name that will be stored. */
export function tidyCustomName(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
