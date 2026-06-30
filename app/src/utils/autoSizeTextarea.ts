// utils/autoSizeTextarea.ts -- jump-free textarea auto-resize
// ============================================================
// Several editing surfaces (the Outline Planner section cards, the Profile
// Builder trait textareas, the chat inputs) auto-grow a <textarea> to fit its
// content so the writer never sees an inner scrollbar. The standard way to do
// that is:
//
//     el.style.height = "auto";              // let it collapse so we can re-measure
//     el.style.height = el.scrollHeight + "px";
//
// That works, but it has a nasty side effect inside a SCROLLING container.
// Reading `scrollHeight` forces a synchronous layout WHILE the textarea is
// collapsed to ~1 line. For a tall textarea (a long outline section) that is a
// sudden 800px -> 20px collapse: everything below leaps up, the browser decides
// the focused caret is no longer where it should be, and it scrolls the
// container to "fix" that. We then restore the height, but the scroll position
// has already been thrown to the bottom. The visible result: the page jumps to
// the bottom the instant you type, and re-centering never sticks.
//
// The fix is to snapshot the nearest scrollable ancestor's scrollTop and put it
// back after the height mutation, so the user's scroll position is preserved.
// Everything here is synchronous (one frame, no paint in between), so the writer
// never sees the collapse or the jump.

interface AutoSizeOpts {
  /** Minimum height in px (the textarea never shrinks below this). */
  minH?: number;
  /** Maximum height in px. Beyond this the textarea scrolls internally. */
  maxH?: number;
}

/**
 * Resize a textarea to fit its content WITHOUT disturbing the scroll position
 * of its scrolling ancestor.
 *
 * @param el   the textarea to size
 * @param opts optional minH / maxH clamps (px)
 */
export function autoSizeTextarea(el: HTMLTextAreaElement, opts: AutoSizeOpts = {}): void {
  const { minH, maxH } = opts;

  // Find the nearest scrollable ancestor so we can preserve its scrollTop.
  const scroller = findScrollParent(el);
  const prevTop = scroller ? scroller.scrollTop : 0;

  // The measure-and-set dance. Collapsing to "auto" is what lets the textarea
  // SHRINK when text is deleted; without it the height would only ever grow.
  el.style.height = "auto";
  let next = el.scrollHeight;
  if (minH != null) next = Math.max(next, minH);
  if (maxH != null) {
    el.style.overflowY = next > maxH ? "auto" : "hidden";
    next = Math.min(next, maxH);
  }
  el.style.height = next + "px";

  // Undo any scroll the browser did to "follow" the caret during the collapse.
  if (scroller && scroller.scrollTop !== prevTop) {
    scroller.scrollTop = prevTop;
  }
}

/**
 * Walk up from an element to the first ancestor that scrolls vertically
 * (overflow-y auto/scroll). Returns null if none is found before the document.
 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
