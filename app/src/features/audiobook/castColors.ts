// features/audiobook/castColors.ts
// =================================
// One colour per character, so a glance at the dialogue window answers
// "who reads this line" without reading a word.
//
// The palette is colourblind-safe by construction (user-specified):
// blue, gold, orange and teal, which stay distinguishable under
// deuteranopia, protanopia and tritanopia. Deliberately NOT used
// together: red with green, blue with purple, light green with yellow.
//
// The narrator has NO colour. Plain text means "the narrator reads
// this", so colour always means "somebody is cast here" -- which makes
// an unassigned line visible by its plainness rather than by a badge.
//
// The lighter half of each pair leads, because this app is dark-mode
// only and the darker variants lose contrast on charcoal. The darks are
// the second wave once a cast grows past four.

export const PALETTE: { hex: string; label: string }[] = [
  { hex: "#0C7BDC", label: "Blue" },
  { hex: "#FFC20A", label: "Gold" },
  { hex: "#E66100", label: "Orange" },
  { hex: "#40B0A6", label: "Teal" },
  { hex: "#005B9A", label: "Deep blue" },
  { hex: "#F2A900", label: "Amber" },
  { hex: "#F57C00", label: "Burnt orange" },
  { hex: "#00796B", label: "Deep teal" },
];

/** The colour for a character, stable for as long as the cast order is.
 *  An unknown name (a marker referencing somebody not cast) gets the
 *  amber warning colour instead -- it is a problem, not a character. */
export function castColor(name: string, castNames: string[]): string {
  const index = castNames.findIndex(n => n.toLowerCase() === name.trim().toLowerCase());
  if (index < 0) return "#F59E0B";
  return PALETTE[index % PALETTE.length].hex;
}

/** Readable text on top of a cast colour. Gold and orange are light
 *  enough that white text on them is unreadable; the rest take white. */
export function castTextColor(background: string): string {
  return ["#FFC20A", "#F2A900", "#40B0A6", "#E66100", "#F57C00"]
    .includes(background) ? "#0F172A" : "#FFFFFF";
}
