// hooks/useDonationState.ts -- Donation prompts and donor flag
// =================================================================
// Tracks two pieces of state in localStorage that drive donation UX:
//
//   1. `hasDonated` -- a self-attest flag set by the writer in About when
//      they click "I donated" / "Mark as donor". Suppresses ALL donation
//      prompts. Shows a "Thank you for donating!" badge in the About panel.
//      We don't try to verify; donations happen on Ko-fi or GitHub Sponsors,
//      neither of which exposes a privacy-friendly read API. The flag is
//      for the writer's UX, not our accounting -- if someone wants to
//      silence the prompts without paying, that's fine; it costs us nothing.
//
//   2. `appOpenCount` -- monotonic counter incremented on each fresh launch.
//      Used to schedule the periodic "consider donating" prompt every Nth
//      launch. The threshold is randomized per-installation between 30 and
//      50 (chosen on first run and persisted) so the cadence feels natural
//      rather than mechanically every-X-launches.
//
// All state is local and never leaves the user's machine.

import { useEffect, useState, useCallback } from "react";


const HAS_DONATED_KEY        = "storythread.donation.hasDonated";
const APP_OPEN_COUNT_KEY     = "storythread.donation.appOpenCount";
const NEXT_PROMPT_AT_KEY     = "storythread.donation.nextPromptAt";
const DISMISS_TS_KEY         = "storythread.donation.lastDismissedAt";
// The session-flag prevents the open-counter from incrementing more than
// once per actual app run. React's StrictMode double-mounts effects in dev,
// and module hot reloads would otherwise count as new "launches".
const SESSION_INCREMENTED_KEY = "storythread.donation.sessionIncremented";

// How many launches between periodic prompts. Picked once per installation
// and persisted so the user doesn't see a uniform every-35-launches pattern.
function pickNextPromptThreshold(currentCount: number): number {
  // Range 30-50 inclusive. Ensures every donor-noise prompt feels like a
  // judgment call, not a metronome.
  const offset = 30 + Math.floor(Math.random() * 21);
  return currentCount + offset;
}


// Read a number from localStorage, returning fallback if missing or junk.
function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}


function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(key) === "true";
}


export interface UseDonationStateResult {
  hasDonated:           boolean;
  appOpenCount:         number;
  // True when the periodic prompt should fire on this launch.
  // Cleared by calling dismissPeriodicPrompt() (advances the next threshold).
  shouldShowPrompt:     boolean;
  markDonated:          () => void;
  unmarkDonated:        () => void;     // For users who toggled it by mistake
  dismissPeriodicPrompt: () => void;
}


export function useDonationState(): UseDonationStateResult {
  const [hasDonated, setHasDonated]       = useState<boolean>(() => readBool(HAS_DONATED_KEY));
  const [appOpenCount, setAppOpenCount]   = useState<number>(() => readNumber(APP_OPEN_COUNT_KEY, 0));
  const [shouldShowPrompt, setShouldShow] = useState<boolean>(false);

  // On mount: increment the open counter (once per session), then decide
  // whether the periodic prompt fires.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Guard against React StrictMode double-effect-fire and dev hot reloads.
    // We use sessionStorage rather than localStorage so the flag clears on
    // app close, letting the next launch increment normally.
    if (window.sessionStorage.getItem(SESSION_INCREMENTED_KEY) === "true") {
      return;
    }
    window.sessionStorage.setItem(SESSION_INCREMENTED_KEY, "true");

    const nextCount = readNumber(APP_OPEN_COUNT_KEY, 0) + 1;
    window.localStorage.setItem(APP_OPEN_COUNT_KEY, String(nextCount));
    setAppOpenCount(nextCount);

    // Initialize the threshold on first launch.
    let nextPromptAt = readNumber(NEXT_PROMPT_AT_KEY, 0);
    if (nextPromptAt === 0) {
      nextPromptAt = pickNextPromptThreshold(nextCount);
      window.localStorage.setItem(NEXT_PROMPT_AT_KEY, String(nextPromptAt));
    }

    // Decide whether to fire the prompt this launch. Skips if the user
    // has marked themselves as a donor.
    if (!readBool(HAS_DONATED_KEY) && nextCount >= nextPromptAt) {
      // Gentle anti-nag: if they dismissed within the last 24 hours, skip
      // (someone closing and reopening shouldn't get hit twice in a day).
      const lastDismissed = readNumber(DISMISS_TS_KEY, 0);
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      if (lastDismissed < dayAgo) {
        setShouldShow(true);
      }
    }
  }, []);


  const markDonated = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HAS_DONATED_KEY, "true");
    setHasDonated(true);
    // Suppressing the prompt if it was queued.
    setShouldShow(false);
  }, []);


  const unmarkDonated = useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(HAS_DONATED_KEY);
    setHasDonated(false);
  }, []);


  const dismissPeriodicPrompt = useCallback(() => {
    if (typeof window === "undefined") return;
    setShouldShow(false);
    window.localStorage.setItem(DISMISS_TS_KEY, String(Date.now()));
    // Push the next threshold out by another 30-50 launches so we don't
    // hit them again immediately on the next launch.
    const current = readNumber(APP_OPEN_COUNT_KEY, 0);
    window.localStorage.setItem(NEXT_PROMPT_AT_KEY, String(pickNextPromptThreshold(current)));
  }, []);


  return {
    hasDonated,
    appOpenCount,
    shouldShowPrompt,
    markDonated,
    unmarkDonated,
    dismissPeriodicPrompt,
  };
}
