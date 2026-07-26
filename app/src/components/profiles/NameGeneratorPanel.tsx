// components/profiles/NameGeneratorPanel.tsx -- Character name generator
// ========================================================================
// Roll given names and surnames by culture + era (real-world, served from
// the backend's names.db) or by fantasy race (assembled locally). Used in
// two places: the "+ New" character form and the dice button beside the
// Name field in the profile header -- both just pass onPick.
//
// Selection is PARTIAL-FRIENDLY by design: a given name alone or a surname
// alone is a valid pick (a character can go by "Arty" or just "Smith").
// [Use this name] fires with whatever is selected.
//
// Real-world rows deal 6 chips from the fetched pool with the same
// no-repeat paging Quick Build uses (exclude what's been shown until the
// pool cycles). Fantasy rows assemble 6 fresh names per deal.

import { useEffect, useRef, useState } from "react";
import { Dices } from "lucide-react";
import { FANTASY_RACES, generateFantasyGivenName, generateFantasySurname } from "../../data/names/fantasyNames";

const API_BASE = "http://localhost:8000";
const DEAL_COUNT = 6;

interface CultureInfo { id: string; label: string; region: string }
interface EraInfo { id: string; label: string }

interface NameGeneratorPanelProps {
  onPick: (name: string) => void;
}

// Selection values are namespaced so one dropdown can hold both worlds:
// "c:british" = real-world culture, "f:wood_elf" = fantasy race.
const isFantasy = (sel: string) => sel.startsWith("f:");
const bareId = (sel: string) => sel.slice(2);

function dealFromPool(pool: string[], seen: Set<string>): string[] {
  // No-repeat paging: deal only unseen options; when too few remain the
  // pool has cycled and everything is fresh again.
  let source = pool.filter(n => !seen.has(n));
  if (source.length < DEAL_COUNT) source = [...pool];
  const dealt: string[] = [];
  const copy = [...source];
  // Fix the hand size BEFORE the loop -- copy shrinks as we splice, so an
  // inline min would stop the deal early on small pools.
  const handSize = Math.min(DEAL_COUNT, copy.length);
  while (dealt.length < handSize) {
    const i = Math.floor(Math.random() * copy.length);
    dealt.push(copy.splice(i, 1)[0]);
  }
  return dealt;
}

export function NameGeneratorPanel({ onPick }: NameGeneratorPanelProps) {
  // Dropdown data from the backend (cultures + era labels). Fantasy races
  // are local. Loaded once per mount.
  const [cultures, setCultures] = useState<CultureInfo[]>([]);
  const [eras, setEras] = useState<EraInfo[]>([]);
  const [loadError, setLoadError] = useState(false);

  const [selection, setSelection] = useState("");
  const [era, setEra] = useState("any");
  const [gender, setGender] = useState("any");

  // Fetched pools + the era the backend actually served (fallback note).
  const [givenPool, setGivenPool] = useState<string[]>([]);
  const [surnamePool, setSurnamePool] = useState<string[]>([]);
  const [usedEra, setUsedEra] = useState<string>("any");

  const [givenDeal, setGivenDeal] = useState<string[]>([]);
  const [surnameDeal, setSurnameDeal] = useState<string[]>([]);
  const [pickedGiven, setPickedGiven] = useState<string | null>(null);
  const [pickedSurname, setPickedSurname] = useState<string | null>(null);

  // Shown-this-cycle memory per (selection, era, gender, kind). A ref: it
  // only drives the next deal, never rendering. Keys are built from
  // EXPLICIT args, not state -- selector changes deal before React commits
  // the new state, so reading state here would key against stale values.
  const seenRef = useRef<Record<string, Set<string>>>({});
  const seenKey = (sel: string, e: string, g: string, kind: string) =>
    `${sel}|${e}|${g}|${kind}`;

  // Deal a hand and record it in the cycle memory (reset when it cycled).
  const dealAndRemember = (pool: string[], key: string): string[] => {
    const seen = seenRef.current[key] ?? new Set<string>();
    const dealt = dealFromPool(pool, seen);
    if (dealt.some(n => seen.has(n))) {
      seenRef.current[key] = new Set(dealt);
    } else {
      for (const n of dealt) seen.add(n);
      seenRef.current[key] = seen;
    }
    return dealt;
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/names/cultures`)
      .then(r => r.json())
      .then(data => {
        setCultures(Array.isArray(data.cultures) ? data.cultures : []);
        setEras(Array.isArray(data.eras) ? data.eras : []);
      })
      .catch(() => setLoadError(true));
  }, []);

  // Regions in backend-sorted order, deduped, for the optgroups.
  const regions = [...new Set(cultures.map(c => c.region))];

  // Fantasy deals are generated fresh; `kind` scopes the deal so the two
  // Reroll buttons stay independent (rerolling given names must not
  // reshuffle the surnames the writer is still considering).
  const dealFantasy = (sel: string, g: string, kind: "given" | "surname" | "both" = "both") => {
    const raceId = bareId(sel);
    if (kind !== "surname") {
      const genderPick = () => (g === "any" ? (Math.random() < 0.5 ? "male" : "female") : g) as "male" | "female";
      const given = new Set<string>();
      while (given.size < DEAL_COUNT) given.add(generateFantasyGivenName(raceId, genderPick()));
      setGivenDeal([...given]);
    }
    if (kind !== "given") {
      const surnames = new Set<string>();
      // Guard: goblin epithets are a finite list smaller than some pools --
      // stop when the space is exhausted rather than spinning.
      let guard = 0;
      while (surnames.size < DEAL_COUNT && guard++ < 60) surnames.add(generateFantasySurname(raceId));
      setSurnameDeal([...surnames]);
    }
    setUsedEra(era);
  };

  const fetchAndDeal = async (sel: string, e: string, g: string) => {
    if (!sel) return;
    if (isFantasy(sel)) {
      dealFantasy(sel, g);
      return;
    }
    try {
      const culture = bareId(sel);
      const [givenRes, surnameRes] = await Promise.all([
        fetch(`${API_BASE}/api/names/pool?culture=${culture}&kind=given&era=${e}&gender=${g}`),
        fetch(`${API_BASE}/api/names/pool?culture=${culture}&kind=surname&era=${e}`),
      ]);
      const givenData = await givenRes.json();
      const surnameData = await surnameRes.json();
      const gp: string[] = givenData.names ?? [];
      const sp: string[] = surnameData.names ?? [];
      setGivenPool(gp);
      setSurnamePool(sp);
      setUsedEra(givenData.used_era ?? e);
      setGivenDeal(dealAndRemember(gp, seenKey(sel, e, g, "given")));
      setSurnameDeal(dealAndRemember(sp, seenKey(sel, e, g, "surname")));
    } catch {
      setLoadError(true);
    }
  };

  // Selector changes reset the picks and re-deal.
  const onSelectorChange = (next: { sel?: string; era?: string; gender?: string }) => {
    const sel = next.sel ?? selection;
    const e = next.era ?? era;
    const g = next.gender ?? gender;
    if (next.sel !== undefined) setSelection(next.sel);
    if (next.era !== undefined) setEra(next.era);
    if (next.gender !== undefined) setGender(next.gender);
    setPickedGiven(null);
    setPickedSurname(null);
    fetchAndDeal(sel, e, g);
  };

  const rerollRow = (kind: "given" | "surname") => {
    if (!selection) return;
    if (isFantasy(selection)) {
      dealFantasy(selection, gender, kind);
      return;
    }
    const pool = kind === "given" ? givenPool : surnamePool;
    const dealt = dealAndRemember(pool, seenKey(selection, era, gender, kind));
    if (kind === "given") setGivenDeal(dealt);
    else setSurnameDeal(dealt);
  };

  const composed = [pickedGiven, pickedSurname].filter(Boolean).join(" ");
  const eraLabel = (id: string) => eras.find(e => e.id === id)?.label ?? id;
  const showFallbackNote =
    selection && !isFantasy(selection) && era !== "any" && usedEra !== era;

  const chipRow = (kind: "given" | "surname", label: string, deal: string[], picked: string | null, setPicked: (n: string | null) => void) => (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-text-primary">{label}</span>
        <button
          type="button"
          onClick={() => rerollRow(kind)}
          className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-indigo-500 hover:text-text-primary"
          title={`Reroll ${label.toLowerCase()}`}
        >
          <Dices size={11} />
          Reroll
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {deal.map(name => (
          <button
            key={name}
            type="button"
            onClick={() => setPicked(picked === name ? null : name)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              picked === name
                ? "border-indigo-500 bg-indigo-950/40 text-indigo-200"
                : "border-border bg-bg-surface text-text-muted hover:border-indigo-500 hover:text-text-primary"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded border border-border bg-bg-primary p-3" data-testid="name-generator">
      {loadError && (
        <p className="mb-2 text-[11px] text-amber-400">
          Could not load the name lists from the backend -- fantasy races still work.
        </p>
      )}

      {/* Selectors */}
      <div className="mb-2.5 flex gap-2">
        <select
          value={selection}
          onChange={e => onSelectorChange({ sel: e.target.value })}
          className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-indigo-500"
        >
          <option value="">Pick a culture or race...</option>
          {regions.map(region => (
            <optgroup key={region} label={region}>
              {cultures.filter(c => c.region === region).map(c => (
                <option key={c.id} value={`c:${c.id}`}>{c.label}</option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Fantasy">
            {FANTASY_RACES.map(r => (
              <option key={r.id} value={`f:${r.id}`}>{r.label}</option>
            ))}
          </optgroup>
        </select>

        {/* Era only applies to real-world cultures */}
        {selection && !isFantasy(selection) && (
          <select
            value={era}
            onChange={e => onSelectorChange({ era: e.target.value })}
            className="w-44 shrink-0 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-indigo-500"
            title="Time period"
          >
            <option value="any">Any era</option>
            {eras.map(e => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
        )}

        <select
          value={gender}
          onChange={e => onSelectorChange({ gender: e.target.value })}
          className="w-20 shrink-0 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-indigo-500"
          title="Given-name gender"
        >
          <option value="any">Any</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>

      {showFallbackNote && (
        <p className="mb-2 text-[11px] text-amber-400">
          Showing {eraLabel(usedEra)} -- closest available for this culture.
        </p>
      )}

      {selection ? (
        <>
          {chipRow("given", "Given names", givenDeal, pickedGiven, setPickedGiven)}
          {chipRow("surname", "Surnames", surnameDeal, pickedSurname, setPickedSurname)}

          {/* Partial-friendly apply: either half alone is a valid name. */}
          <div className="flex items-center gap-2 border-t border-border pt-2">
            <p className="min-w-0 flex-1 truncate text-xs text-text-muted">
              {composed ? <>Selected: <span className="font-medium text-text-primary">{composed}</span></> : "Pick a given name, a surname, or both."}
            </p>
            <button
              type="button"
              disabled={!composed}
              onClick={() => { onPick(composed); setPickedGiven(null); setPickedSurname(null); }}
              className="shrink-0 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
            >
              Use this name
            </button>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-faint">
          Pick a culture (grouped by region) or a fantasy race, then roll.
          Given names and surnames select independently -- a character can go
          by just one.
        </p>
      )}
    </div>
  );
}
