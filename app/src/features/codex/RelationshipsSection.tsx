// features/codex/RelationshipsSection.tsx -- who this character is to people
// ===========================================================================
// One row per relationship, on the page where the writer is already working on
// that character, and written FROM THAT CHARACTER'S SIDE. The writer's own
// description of what this is for:
//
//     "A) provide the writer a foundation of how this character interacts with
//      this character from their point of view. B) AI can read and understand
//      that the relationship maybe mutual or very different depending on how
//      each character sees the other."
//
// And the example that settles the whole design:
//
//     Teenage daughter: "at odds with her mother for being restrictive,
//     angsty, moody, annoyed at all the rules her mother inacts."
//     The mother, about the same daughter: "loving, maternal, caring, trying
//     to control her out-of-control daughter who consistantly makes poor
//     decisions because she's angry."
//
// BOTH ARE TRUE AND NEITHER IS A BELIEF. So this is not one shared record with
// two descriptions -- it is one row on each character's own page, each holding
// that character's reading. The daughter's brief gets hers, the mother's gets
// hers, and a scene with both in it gets both. That is why the row is stored
// on the character it belongs to and never mirrored onto the other one.
//
// ── WHAT THIS REPLACED, AND WHY IT WAS WRONG ────────────────────────────────
//
// The first version of this section reused the trait-block editor, because it
// was already built. That gave a relationship an IMPORTANCE dropdown, and the
// writer's objection is unanswerable:
//
//     "Why would there be a need for Importance: Background for a relationship
//      with her Mother Victoria."
//
// None. A relationship's dropdown is the KIND of relationship -- the same
// connection vocabulary the Weaving walkthrough offers -- and reusing the
// nearest available structure produced a control that asked the wrong
// question. The vocabulary comes from the world's own registry now, so a
// writer's custom relation appears here with no code change, and they can type
// one that does not exist yet.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Link2, Loader,
         Plus, Trash2, X } from "lucide-react";

import { Explain } from "../../components/learn/Explain";
import { fetchAnchors, fetchGraph, nodeLabel,
         type ChapterAnchor, type GraphNode } from "./api";

const API_BASE = "http://localhost:8000";

/** A relation the world allows, as the registry describes it. */
interface Relation {
  id: string;
  label: string;
  /** The heading it sits under -- Family, Knows / Known, Against. */
  group?: string;
}

/** One stored relationship, as this page works with it. */
interface Row {
  /** Stable identity while editing. Not persisted. */
  uid: string;
  /** The other end, when it is a real entry. Empty for a typed-in name. */
  targetId: string;
  /** What to show in the box -- a picked entry's name, or the typed text. */
  otherName: string;
  otherType: string;
  /** The relation id, or a free-typed label the writer invented. */
  rel: string;
  relLabel: string;
  /** The writer's own account of the relationship, from this side. */
  description: string;
  /** One line for the map and every brief. Required by the backend. */
  reason: string;
  /** Chapter anchor this stage begins at. Empty = true all the way through. */
  at: string;
  /**
   * On this page rather than as a connection: the other end is a name with no
   * entry. Saved with the profile, not recorded on its own.
   */
  unlisted: boolean;
  /** Already on disk, so editing means PATCH rather than POST. */
  saved: boolean;
  /** The anchor it was saved under, which is part of its address. */
  savedAt: string;
  savedRel: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);

interface RelationshipsSectionProps {
  projectPath: string;
  entityId: string;
  entityType: string;
  entityName: string;
  /**
   * The character's own Relationships section, which is where a relationship
   * with NOBODY ON THE OTHER END lives.
   *
   * "I'm trying to add the following relationship with her parents, but they
   * do not have a charcter profile and won't." A Tie cannot hold that -- it
   * needs two ends that exist -- so it is kept on this page as a trait-shaped
   * block, and saved with the page like every other field on it.
   */
  blocks: UnlistedBlock[];
  onBlocksChange: (blocks: UnlistedBlock[]) => void;
  /** Re-read the world so the map and other pages see the change. */
  onChanged?: () => void;
}

/** A relationship whose other end is not an entry. Stored on the character. */
export interface UnlistedBlock {
  id?: string;
  trait: string;
  description: string;
  importance?: string;
  rel?: string;
}

export function RelationshipsSection({
  projectPath, entityId, entityType, entityName, blocks, onBlocksChange,
  onChanged,
}: RelationshipsSectionProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [world, setWorld] = useState<GraphNode[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [chapters, setChapters] = useState<ChapterAnchor[]>([]);
  // Kind id -> the plural label the sidebar uses ("Characters", "Ruling
  // Authorities"). Read from the world's own registry rather than pluralised
  // here: a writer's own kind has a label they chose, and "Ruling Authorities"
  // is not "Ruling Authoritys".
  const [kindLabels, setKindLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Which recorded cards are open. Empty on arrival, so a character with
  // fourteen relationships opens as fourteen readable lines rather than
  // fourteen forms -- the same bargain the trait cards make. A DRAFT is always
  // open: it exists because the writer is filling it in.
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  /**
   * A key for "is this card open" that SURVIVES A RELOAD.
   *
   * Recording anything re-reads the list, and every row gets a fresh uid on
   * the way in -- so an open set keyed by uid would forget itself, and a card
   * the writer had opened would snap shut the moment they saved something
   * else. Keyed by what the row actually IS instead: the other end, the
   * relation and the anchor, which is the same address the save and the
   * delete use.
   */
  const rowKey = (row: Row) => (row.saved
    ? `${row.targetId}|${row.savedRel}|${row.savedAt}`
    : row.uid);

  const toggleRow = (key: string) => setOpenRows(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // ── Load ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ project_path: projectPath,
                                           entity_id: entityId });
      const body = await fetch(`${API_BASE}/api/codex/ties?${params}`)
        .then(r => r.json());
      if (!Array.isArray(body?.ties)) throw new Error("Connections could not be read.");

      // ONLY THE ONES THIS CHARACTER OWNS. A relationship recorded on the
      // other person's page is THEIR reading of it, and showing it here as if
      // it were this character's would be the app putting words in their
      // mouth. It is visible from the map and from that character's own page.
      const fromDisk: Row[] = body.ties
        .filter((t: Record<string, unknown>) => !t.incoming)
        .map((t: Record<string, unknown>): Row => ({
          uid: uid(),
          targetId: String(t.other_id ?? ""),
          otherName: String(t.other_name ?? ""),
          otherType: String(t.other_type ?? ""),
          rel: String(t.rel ?? ""),
          relLabel: String(t.reads_as ?? t.rel ?? ""),
          description: String(t.description ?? ""),
          reason: String(t.why ?? ""),
          at: String(t.at ?? ""),
          unlisted: false,
          saved: true,
          savedAt: String(t.at ?? ""),
          savedRel: String(t.rel ?? ""),
        }));

      // ANYTHING HALF-TYPED SURVIVES THE RELOAD. Recording one relationship
      // re-reads them all, and replacing the whole list threw away every row
      // the writer had started beside it -- work they could see a moment
      // earlier and had no reason to expect to lose.
      setRows(current => [
        ...fromDisk,
        ...(current ?? []).filter(r => !r.saved),
      ]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Relationships could not be read.");
      setRows(prev => prev ?? []);
    }
  }, [projectPath, entityId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetchGraph(projectPath, { hideSpoilers: false })
      .then(g => { if (!cancelled) setWorld(g.nodes ?? []); })
      .catch(() => { if (!cancelled) setWorld([]); });
    fetchAnchors(projectPath)
      .then(b => { if (!cancelled) setChapters(b.chapters ?? []); })
      .catch(() => { if (!cancelled) setChapters([]); });
    // The labels the sidebar uses, so the picker's headings read the way the
    // rest of the app names things -- including a kind the writer invented.
    fetch(`${API_BASE}/api/codex/types?${new URLSearchParams({ project_path: projectPath })}`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return;
        const labels: Record<string, string> = {};
        for (const entry of (body?.types ?? []) as { id?: string; label?: string }[]) {
          if (entry?.id) labels[entry.id] = entry.label || entry.id;
        }
        setKindLabels(labels);
      })
      .catch(() => { if (!cancelled) setKindLabels({}); });
    return () => { cancelled = true; };
  }, [projectPath]);

  // THE VOCABULARY, FROM THE WORLD'S OWN REGISTRY. Not a list in this file:
  // the writer's custom relations have to appear here, and a hardcoded copy
  // would be a second answer to "what can these two be to each other".
  //
  // Asked for character-to-character, which is what a Relationships section on
  // a character is nearly always about. A row pointing at a location or a
  // faction still saves -- the backend decides what is legal for that pair --
  // and a relation it will not allow is reported rather than hidden.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ project_path: projectPath,
                                         src_type: entityType,
                                         dst_type: "character" });
    fetch(`${API_BASE}/api/codex/relations?${params}`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return;
        const forward = (body?.forward ?? []) as Relation[];
        const available = (body?.available ?? []) as Relation[];
        setRelations([...forward, ...available]);
      })
      .catch(() => { if (!cancelled) setRelations([]); });
    return () => { cancelled = true; };
  }, [projectPath, entityType]);

  // The whole world except this entry, GROUPED BY KIND and A-Z inside each --
  // "Characters A-Z, Locations A-Z, Ruling Entities A-Z". One flat list of
  // sixty names in a world of sixty entries is a list nobody reads to the end;
  // headings let a writer jump to the part they mean and stop scanning.
  const peopleByKind = useMemo(() => {
    const groups = new Map<string, GraphNode[]>();
    for (const node of world) {
      if (node.entity_id === entityId) continue;
      const list = groups.get(node.type) ?? [];
      list.push(node);
      groups.set(node.type, list);
    }
    return [...groups.entries()]
      .map(([kind, nodes]) => ({
        kind,
        label: kindLabels[kind] || kind.replace(/_/g, " "),
        nodes: nodes.sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b))),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [world, entityId, kindLabels]);

  const people = useMemo(
    () => peopleByKind.flatMap(g => g.nodes), [peopleByKind]);

  // The relation vocabulary under its own headings, the same way the connect
  // dialog groups it: Family, Knows / Known, Intimate, Against. Asked for
  // exactly so -- "so writers can quickly go past the sections until they
  // reach the section they would best associate the relationship".
  const relationsByGroup = useMemo(() => {
    const groups = new Map<string, Relation[]>();
    for (const relation of relations) {
      const key = relation.group || "Other";
      groups.set(key, [...(groups.get(key) ?? []), relation]);
    }
    return [...groups.entries()].map(([label, list]) => ({ label, list }));
  }, [relations]);

  const chapterLabel = useCallback((anchor: string) => {
    const index = chapters.findIndex(c => c.anchor === anchor);
    return index === -1 ? "" : `${index + 1}. ${chapters[index].title}`;
  }, [chapters]);

  /**
   * THE RANGE, DERIVED AND NEVER STORED.
   *
   * "Chapters 1-6, then 7-20, then 21-36" is three rows on one pair, each with
   * a start. Where one ends is where the next begins, so storing an end as
   * well would give the same fact two homes and let them disagree -- and
   * `until` means something different and narrower: a relationship that ended
   * with nothing replacing it.
   */
  const rangeFor = useCallback((row: Row, all: Row[]): string => {
    if (!row.at) return "all the way through";
    const mine = all
      .filter(r => r.targetId && r.targetId === row.targetId && r.at)
      .map(r => r.at)
      .sort((a, b) => chapters.findIndex(c => c.anchor === a)
                    - chapters.findIndex(c => c.anchor === b));
    const next = mine[mine.indexOf(row.at) + 1];
    const from = chapterLabel(row.at);
    if (!next) return from ? `from ${from} on` : "from an unknown chapter on";
    const endIndex = chapters.findIndex(c => c.anchor === next) - 1;
    const end = endIndex >= 0 ? `${endIndex + 1}. ${chapters[endIndex].title}` : "";
    return end ? `${from} to ${end}` : `from ${from} on`;
  }, [chapters, chapterLabel]);

  /**
   * The chapters a stage covers, as numbers a writer can read at a glance.
   *
   * "(full)" for one that is simply true of the book, and otherwise the
   * chapter numbers it holds for -- 6,7,8,9,10 -- worked out the same way the
   * range is: this stage runs until the next one on the same pair begins.
   * Truncated in the middle rather than cut off, because the LAST number is
   * the half that says how far it goes.
   */
  const chapterMarks = useCallback((row: Row, all: Row[]): string => {
    if (!row.at) return "(full)";
    const start = chapters.findIndex(c => c.anchor === row.at);
    if (start === -1) return "(unplaced)";

    const laterStarts = all
      .filter(r => r.targetId && r.targetId === row.targetId && r.at
                   && r.uid !== row.uid)
      .map(r => chapters.findIndex(c => c.anchor === r.at))
      .filter(i => i > start);
    const end = laterStarts.length ? Math.min(...laterStarts) - 1
                                   : chapters.length - 1;

    const numbers = [];
    for (let i = start; i <= end; i += 1) numbers.push(i + 1);
    if (numbers.length <= 6) return numbers.join(",");
    return `${numbers.slice(0, 4).join(",")}...${numbers[numbers.length - 1]}`;
  }, [chapters]);

  // ── Editing ─────────────────────────────────────────────────────────
  //
  // TWO HOMES, ONE LIST. A relationship with an entry on the other end is a
  // connection and lives in the Weave; one without is prose on this character
  // and lives in their own Relationships section. The writer sees one list and
  // should not have to know which is which -- but the app does, because only
  // one of them can be resolved, drawn on a map, or answered from the other
  // side.
  const unlistedRows: Row[] = useMemo(() => blocks.map((block, index) => ({
    uid: `block:${index}`,
    targetId: "", otherName: block.trait, otherType: "",
    rel: "", relLabel: block.rel ?? "",
    description: block.description, reason: "", at: "",
    unlisted: true, saved: true, savedAt: "", savedRel: "",
  })), [blocks]);

  const patchBlock = (index: number, updates: Partial<Row>) => {
    const next = blocks.map((block, i) => (i === index ? {
      ...block,
      ...(updates.otherName !== undefined ? { trait: updates.otherName } : {}),
      ...(updates.description !== undefined
        ? { description: updates.description } : {}),
      ...(updates.relLabel !== undefined ? { rel: updates.relLabel } : {}),
    } : block));
    onBlocksChange(next);
  };

  const patch = (uidValue: string, updates: Partial<Row>) => {
    if (uidValue.startsWith("block:")) {
      patchBlock(Number(uidValue.slice(6)), updates);
      return;
    }
    setRows(current => (current ?? []).map(
      r => (r.uid === uidValue ? { ...r, ...updates } : r)));
  };

  // APPENDED, and the list is never re-sorted. See the note above the render.
  const addRow = () => setRows(current => [...(current ?? []), {
    uid: uid(), targetId: "", otherName: "", otherType: "character",
    rel: "", relLabel: "", description: "", reason: "", at: "",
    unlisted: false, saved: false, savedAt: "", savedRel: "",
  }]);

  /**
   * The relation id to save this row under.
   *
   * A writer may have picked from the list, or typed their own wording, or
   * edited the wording of one they picked. `POST /relation` settles all three:
   * already in this world, use it; shipped but not adopted, adopt it;
   * genuinely new, mint it. So a typed relationship is recorded as a real
   * relation rather than being quietly dropped -- which is what happened
   * before, because the save read only the dropdown.
   */
  const resolveRelation = async (row: Row): Promise<string> => {
    const typed = row.relLabel.trim();
    const picked = relations.find(r => r.id === row.rel);
    if (!typed) return row.rel || "connected_to";
    if (picked && picked.label.toLowerCase() === typed.toLowerCase()) {
      return picked.id;
    }
    const known = relations.find(
      r => r.label.toLowerCase() === typed.toLowerCase());
    if (known) return known.id;

    const response = await fetch(`${API_BASE}/api/codex/relation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_path: projectPath, label: typed,
        source_types: [entityType], target_types: [row.otherType || "character"],
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.detail?.message
                      ?? `"${typed}" could not be added as a kind of relationship.`);
    }
    return String(body.id ?? "connected_to");
  };

  /** Record or update one row. Ties are shared, so each is written on its own. */
  const recordRow = async (row: Row) => {
    // A NAME WITH NO ENTRY IS A REAL ANSWER, and this used to refuse it
    // outright -- "I can add [child of], but... it won't allow me to
    // Record/save." The offer was that a typed name would be kept on this page;
    // the storage for that was never built, so the button simply said no.
    //
    // It goes into the character's own Relationships section instead: their
    // parents, a guild, someone dead before page one. No other end to resolve
    // against, so no connection -- but the writer keeps the relationship.
    if (!row.targetId) {
      if (!row.otherName.trim()) {
        setError("Say who this relationship is with -- pick one of your "
                 + "entries, or type any name.");
        return;
      }
      onBlocksChange([...blocks, {
        trait: row.otherName.trim(),
        description: row.description,
        rel: row.relLabel.trim(),
        importance: "present",
      }]);
      setRows(current => (current ?? []).filter(r => r.uid !== row.uid));
      setError(null);
      return;
    }
    if (!row.reason.trim()) {
      setError("Say in one line why they are connected. That line is what "
               + "goes to AI every time; the longer description travels only "
               + "when the other person is in the scene.");
      return;
    }
    setBusy(row.uid);
    setError(null);
    try {
      const rel = await resolveRelation(row);
      const shared = {
        project_path: projectPath, src_id: entityId, dst_id: row.targetId,
        reason: row.reason.trim(), description: row.description,
      };
      const response = row.saved
        ? await fetch(`${API_BASE}/api/codex/tie`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...shared, rel: row.savedRel, at: row.savedAt || null,
              new_rel: rel, new_at: row.at || null,
            }),
          })
        : await fetch(`${API_BASE}/api/codex/tie`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...shared, rel, at: row.at || null }),
          });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.detail?.message ?? body?.detail
                        ?? "That could not be recorded.");
      }
      // THE TRANSACTION IS OVER, so the card that started it goes.
      //
      // Without this the writer saw the same relationship twice: the real one
      // filed below the button, and the draft they had just filled in still
      // sitting above it -- which reads as "it did not save" and invites them
      // to press Record again. Add, fill in, record, done: the next one starts
      // from a fresh card when they ask for it.
      //
      // Queued BEFORE load()'s own update, so the merge that keeps other
      // half-typed rows alive no longer sees this one.
      setRows(current => (current ?? []).filter(r => r.uid !== row.uid));
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be recorded.");
    } finally {
      setBusy(null);
    }
  };

  const removeRow = async (row: Row) => {
    if (row.unlisted) {
      onBlocksChange(blocks.filter(
        (_, i) => i !== Number(row.uid.slice(6))));
      return;
    }
    if (!row.saved) {
      setRows(current => (current ?? []).filter(r => r.uid !== row.uid));
      return;
    }
    setBusy(row.uid);
    try {
      const params = new URLSearchParams({
        project_path: projectPath, src_id: entityId,
        rel: row.savedRel, dst_id: row.targetId,
      });
      // The anchor is part of the address: without it, removing one stage of a
      // relationship removes every stage of it.
      if (row.savedAt) params.set("at", row.savedAt);
      await fetch(`${API_BASE}/api/codex/tie?${params}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (rows === null) {
    return (
      <p className="flex items-center gap-1.5 text-mini text-text-muted">
        <Loader size={11} className="animate-spin" /> Reading relationships...
      </p>
    );
  }

  // ── THE ORDER IS THE ORDER THEY WERE MADE IN, AND THIS IS A BUG FIX ──
  //
  // This list used to sort itself alphabetically on every render, and the
  // reported consequence was losing a relationship:
  //
  //     "I added the first relationship of Milton... I clicked add a new
  //      relationship to add kipling. When I clicked update, it appeared to
  //      erase Milton's relationship and replaced it with Kiplings."
  //
  // Nothing was wrong with the save. Typing "Kipling" into the new row at the
  // bottom made it jump ABOVE the recorded Milton row part-way through the
  // word, so the buttons under the writer's cursor now belonged to the other
  // relationship -- including Remove, which is how Milton went. A list that
  // rearranges itself while being used is not a list, and no amount of
  // confirming would have made it safe.
  //
  // So: first made, first shown. Deleting one closes the gap. Nothing moves
  // unless the writer moves it.

  return (
    <div data-testid="relationships-section">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-mini text-text-muted">
          Who {entityName} is to other people, in {entityName}&rsquo;s own
          terms.
        </p>
        <Explain of="profile.relationships" />
      </div>

      {rows.length === 0 && (
        <p className="mb-2 rounded border border-dashed border-border px-3 py-3 text-mini text-faint">
          Nothing recorded yet. Add the people {entityName} deals with and say
          what each one is to them -- a parent, a mentor, a rival -- and what
          that actually feels like from {entityName}&rsquo;s side. The other
          person&rsquo;s page holds their own version, which can be completely
          different and still be true.
        </p>
      )}

      {/* ── WHERE THINGS SIT ON THE PAGE ────────────────────────────
          The Add button is ABOVE the list, and a new blank card opens above
          the button -- so a writer adding their fifth relationship does not
          have to scroll past four to reach the control, and the card they just
          opened is where they were already looking.

          Unsaved cards stack above the button in the order they were opened,
          which puts the newest one directly above the control that made it.
          Recording one files it below the button with the rest, in the order
          they were created -- the move is the confirmation that it is now a
          real, shared record rather than a draft. */}
      {renderRows(rows.filter(r => !r.saved))}

      <button
        onClick={addRow}
        className="my-2 inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-mini text-text-muted transition-colors hover:border-accent-fill hover:text-accent"
      >
        <Plus size={11} /> Add a relationship
      </button>

      {renderRows([...rows.filter(r => r.saved), ...unlistedRows])}

      {/* THE SEAM, SAID OUT LOUD. Every other field on this page waits for the
          page's Save. A relationship does not, because it is a shared record:
          it appears on the other character's page and on the map, and can be
          edited from either. Hiding that difference would be worse than
          naming it. */}
      <p className="mt-2 text-micro text-faint">
        Each relationship is recorded on its own, when you press Record or
        Update -- not with the rest of the page. They are shared: the map draws
        them, and the other person can be opened and given their own version.
      </p>

      {error && (
        <p role="alert"
           className="mt-1.5 flex items-start gap-1 text-mini text-danger">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );

  function renderRows(shown: Row[]) {
    if (shown.length === 0) return null;
    return (
      <ul className="space-y-3">
        {shown.map(row => {
          // A DRAFT IS ALWAYS OPEN -- it exists because it is being filled in.
          const open = !row.saved || openRows.has(rowKey(row));
          if (!open) {
            return (
              <li key={row.uid}
                  className="rounded border border-border bg-bg-surface/40">
                {/* THE WHOLE ROW IS THE CONTROL, so there is no small target
                    to hunt for, and it reads as one line: who, what they are,
                    and when it holds. */}
                <button
                  onClick={() => toggleRow(rowKey(row))}
                  aria-expanded={false}
                  aria-label={`Open the relationship with ${row.otherName || "this person"}`}
                  className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-bg-raised"
                >
                  <ChevronRight size={12}
                                className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text-primary">
                      {row.otherName || "Someone"}
                      {row.relLabel && (
                        <span className="text-success"> ({row.relLabel})</span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-micro text-text-muted">
                        {row.description || row.reason || "Nothing written yet"}
                      </span>
                      {/* WHEN IT HOLDS, on the right where the eye can run
                          down a column of them. */}
                      <span className="shrink-0 text-micro text-faint">
                        {chapterMarks(row, rows ?? [])}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          }
          return (
          <li key={row.uid}
              className="rounded border border-border bg-bg-surface/40 p-2">
            {row.saved && (
              <button
                onClick={() => toggleRow(rowKey(row))}
                aria-expanded
                aria-label={`Close the relationship with ${row.otherName || "this person"}`}
                className="mb-1 flex items-center gap-1 text-micro text-text-muted transition-colors hover:text-text-primary"
              >
                <ChevronDown size={12} /> Close
              </button>
            )}
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {/* WHAT KIND OF RELATIONSHIP. The world's own vocabulary, and a
                  box the writer can type into when none of it fits. */}
              <select
                value={relations.some(r => r.id === row.rel) ? row.rel : ""}
                onChange={e => {
                  // QUICK INSERT: choosing from the list writes its wording
                  // into the box beside it, which the writer is then free to
                  // edit or replace entirely.
                  const chosen = relations.find(r => r.id === e.target.value);
                  if (!chosen) return;
                  patch(row.uid, { rel: chosen.id, relLabel: chosen.label });
                }}
                aria-label={`Kind of relationship with ${row.otherName || "this person"}`}
                className="rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
              >
                <option value="">Choose from...</option>
                {relationsByGroup.map(group => (
                  <optgroup key={group.label} label={group.label}>
                    {group.list.map(r => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <input
                value={row.relLabel}
                onChange={e => patch(row.uid, { relLabel: e.target.value })}
                placeholder="or type it -- mentored by, sworn enemy of"
                aria-label={`Relationship wording with ${row.otherName || "this person"}`}
                className="w-52 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
              />

              <span className="text-mini text-faint">with</span>

              {/* THE PICKER IS A QUICK INSERT FOR THE BOX BESIDE IT, and that
                  is the whole reason it is two controls rather than one.
                  Picking fills the box and links the entry, so the map can
                  draw it. Typing a name that is not on the list is equally
                  valid and stays text -- which is the case the writer named:
                  "a deceased lover from a time before the story starts...
                  that character never actually appears or is directly
                  relavant within the story. But the current character has a
                  relationship of some type and kind with said character that
                  is relavent to them." */}
              <select
                value=""
                onChange={e => {
                  const picked = people.find(p => p.entity_id === e.target.value);
                  if (!picked) return;
                  patch(row.uid, { otherName: nodeLabel(picked),
                                   targetId: picked.entity_id,
                                   otherType: picked.type });
                }}
                aria-label={`Pick someone from this world for ${entityName}`}
                className="rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
              >
                <option value="">Pick from your world...</option>
                {peopleByKind.map(group => (
                  <optgroup key={group.kind} label={group.label}>
                    {group.nodes.map(node => (
                      <option key={node.entity_id} value={node.entity_id}>
                        {nodeLabel(node)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* THE OTHER END. Filled by the picker, and equally open to a
                  name that will never be a profile. */}
              <input
                value={row.otherName}
                onChange={e => {
                  const typed = e.target.value;
                  const match = people.find(p => nodeLabel(p) === typed
                                              || p.name === typed);
                  patch(row.uid, {
                    otherName: typed,
                    targetId: match?.entity_id ?? "",
                    otherType: match?.type ?? "character",
                  });
                }}
                placeholder="a character, or any name"
                aria-label={`Who ${entityName} has this relationship with`}
                className="w-52 rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
              />
              {/* WHEN THIS STAGE STARTS. A pair can hold several, and the one
                  that starts later takes over on its own. */}
              <select
                value={row.at}
                onChange={e => patch(row.uid, { at: e.target.value })}
                aria-label={`From when this relationship with ${row.otherName || "this person"} holds`}
                className="rounded border border-border bg-bg-surface px-1.5 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
              >
                <option value="">All the way through</option>
                {chapters.map((c, n) => (
                  <option key={c.chapter_id} value={c.anchor}>
                    From {n + 1}. {c.title}
                  </option>
                ))}
              </select>

              <span className="ml-auto flex items-center gap-1">
                {/* NO RECORD BUTTON ON AN UNLISTED ROW. It is part of this
                    page, so it saves when the page saves -- and a button
                    claiming otherwise would be the second thing on this screen
                    to promise something it does not do. */}
                {!row.unlisted && (
                  <button
                    onClick={() => void recordRow(row)}
                    disabled={busy === row.uid}
                    className="inline-flex items-center gap-1 rounded border border-accent-fill/60 bg-accent-soft/30 px-2 py-0.5 text-micro text-accent transition-colors hover:bg-accent-soft/50 disabled:opacity-50"
                  >
                    {busy === row.uid
                      ? <Loader size={10} className="animate-spin" />
                      : <Check size={10} />}
                    {row.saved ? "Update" : "Record"}
                  </button>
                )}
                <button
                  onClick={() => void removeRow(row)}
                  disabled={busy === row.uid}
                  title="Remove this relationship"
                  aria-label={`Remove the relationship with ${row.otherName || "this person"}`}
                  className="rounded p-1 text-text-muted transition-colors hover:text-danger"
                >
                  {row.saved ? <Trash2 size={11} /> : <X size={11} />}
                </button>
              </span>
            </div>

            <input
              value={row.reason}
              onChange={e => patch(row.uid, { reason: e.target.value })}
              maxLength={140}
              placeholder="In one line: why these two are connected"
              aria-label={`In one line, why ${entityName} is connected to ${row.otherName || "this person"}`}
              className="mb-1 w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-fill"
            />

            <textarea
              value={row.description}
              onChange={e => patch(row.uid, { description: e.target.value })}
              rows={3}
              // AN EXAMPLE FROM A BOOK EVERYONE HAS READ, rather than one
              // assembled from the writer's own names -- a placeholder made of
              // their characters reads as a statement ABOUT them, which is
              // confusing on a blank field. Sam and Frodo also carry the point
              // this section exists for in four lines: the same friendship,
              // read completely differently from each end.
              placeholder={"e.g. Sam has decided Mr Frodo cannot manage without him and will not be argued out of it. He calls himself a servant and behaves like a guardian -- rationing the food, watching who Frodo talks to, keeping the rope. He would not call it love and it is."}
              aria-label={`What ${row.otherName || "this person"} is to ${entityName}`}
              className="w-full resize-y rounded border border-border bg-bg-surface px-2 py-1 text-xs leading-relaxed text-text-primary outline-none focus:border-accent-fill"
            />

            <div className="mt-1 flex flex-wrap items-center gap-2 text-micro">
              {row.unlisted ? (
                <span className="text-faint">
                  kept on {entityName}&rsquo;s page -- saved with the rest of
                  this profile. No entry on the other end, so it is not on the
                  map and nobody can answer back.
                </span>
              ) : row.targetId ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <Link2 size={9} />
                  linked -- on the map, and {row.otherName} can hold their own
                  version of this
                </span>
              ) : (
                <span className="text-faint">
                  kept on this page only -- pick a character from the list to
                  put it on the map and let them answer back
                </span>
              )}
              {row.saved && (
                <span className="text-faint">{rangeFor(row, rows ?? [])}</span>
              )}
            </div>
          </li>
          );
        })}
      </ul>
    );
  }
}
