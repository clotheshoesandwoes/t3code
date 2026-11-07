import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { toastManager } from "./components/ui/toast";
import { resolveStorage } from "./lib/storage";

/** Lanes shows at most this many threads side by side. */
export const MAX_LANES = 8;

export const LANES_PATH = "/lanes";

export interface LanesState {
  readonly lanes: ReadonlyArray<ScopedThreadRef>;
  /** The lane shown alone, or null for the grid. */
  readonly zoomedKey: string | null;
}

/** Appends the threads not already in a lane, up to MAX_LANES; reports how many were left out. */
export function addLanes(
  state: LanesState,
  refs: ReadonlyArray<ScopedThreadRef>,
): { readonly state: LanesState; readonly added: number; readonly overflow: number } {
  const keys = new Set(state.lanes.map(scopedThreadKey));
  const fresh = refs.filter((ref) => {
    const key = scopedThreadKey(ref);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  const room = Math.max(0, MAX_LANES - state.lanes.length);
  const added = fresh.slice(0, room);
  return {
    state: added.length === 0 ? state : { ...state, lanes: [...state.lanes, ...added] },
    added: added.length,
    overflow: fresh.length - added.length,
  };
}

export function removeLane(state: LanesState, key: string): LanesState {
  const lanes = state.lanes.filter((ref) => scopedThreadKey(ref) !== key);
  if (lanes.length === state.lanes.length) return state;
  return { lanes, zoomedKey: state.zoomedKey === key ? null : state.zoomedKey };
}

/** Moves the lane `fromKey` into the slot `toKey` holds. */
export function moveLane(state: LanesState, fromKey: string, toKey: string): LanesState {
  const from = state.lanes.findIndex((ref) => scopedThreadKey(ref) === fromKey);
  const to = state.lanes.findIndex((ref) => scopedThreadKey(ref) === toKey);
  if (from === -1 || to === -1 || from === to) return state;
  const lanes = [...state.lanes];
  const [moved] = lanes.splice(from, 1);
  lanes.splice(to, 0, moved!);
  return { ...state, lanes };
}

/** Columns and rows for `count` lanes: one row up to four, then two rows. */
export function laneGrid(count: number): { readonly columns: number; readonly rows: number } {
  if (count <= 0) return { columns: 1, rows: 1 };
  if (count <= 4) return { columns: count, rows: 1 };
  return { columns: Math.ceil(count / 2), rows: 2 };
}

/**
 * Grid tracks and each lane's column span for `count` lanes. A short last row's lanes span
 * more tracks so the row fills the width instead of leaving a gap.
 */
export function laneLayout(count: number): {
  readonly columns: number;
  readonly rows: number;
  readonly spans: ReadonlyArray<number>;
} {
  const { columns, rows } = laneGrid(count);
  const lastRow = count - columns * (rows - 1);
  if (rows === 1 || lastRow === columns) {
    return { columns, rows, spans: Array.from({ length: Math.max(0, count) }, () => 1) };
  }
  return {
    columns: columns * lastRow,
    rows,
    spans: Array.from({ length: count }, (_, index) => (index < columns ? lastRow : columns)),
  };
}

interface LanesStore extends LanesState {
  add: (refs: ReadonlyArray<ScopedThreadRef>) => { added: number; overflow: number };
  remove: (key: string) => void;
  move: (fromKey: string, toKey: string) => void;
  toggleZoom: (key: string) => void;
  clear: () => void;
}

const isThreadRef = Schema.is(ScopedThreadRef);

export const useLanesStore = create<LanesStore>()(
  persist(
    (set, get) => ({
      lanes: [],
      zoomedKey: null,
      add: (refs) => {
        const result = addLanes(get(), refs);
        if (result.added > 0) set(result.state);
        return { added: result.added, overflow: result.overflow };
      },
      remove: (key) => set((state) => removeLane(state, key)),
      move: (fromKey, toKey) => set((state) => moveLane(state, fromKey, toKey)),
      toggleZoom: (key) =>
        set((state) => ({
          zoomedKey:
            state.zoomedKey === key || !state.lanes.some((ref) => scopedThreadKey(ref) === key)
              ? null
              : key,
        })),
      clear: () => set({ lanes: [], zoomedKey: null }),
    }),
    {
      name: "t3code:lanes:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: (state) => ({ lanes: state.lanes, zoomedKey: state.zoomedKey }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<LanesState> | null;
        const lanes = Array.isArray(saved?.lanes)
          ? saved.lanes.filter(isThreadRef).slice(0, MAX_LANES)
          : [];
        const zoomedKey =
          typeof saved?.zoomedKey === "string" &&
          lanes.some((ref) => scopedThreadKey(ref) === saved.zoomedKey)
            ? saved.zoomedKey
            : null;
        return { ...current, lanes, zoomedKey };
      },
    },
  ),
);

/** Adds threads to lanes, warning when some did not fit; the caller then opens `LANES_PATH`. */
export function addThreadsToLanes(refs: ReadonlyArray<ScopedThreadRef>): void {
  const { overflow } = useLanesStore.getState().add(refs);
  if (overflow > 0) {
    toastManager.add({
      type: "warning",
      title: "Lanes are full",
      description: `Lanes holds ${MAX_LANES} threads. Close one to add ${overflow === 1 ? "another" : `${overflow} more`}.`,
    });
  }
}

export function isLane(key: string): boolean {
  return useLanesStore.getState().lanes.some((ref) => scopedThreadKey(ref) === key);
}

/** Whether `key` is a lane on screen right now, so its own toasts would repeat what is visible. */
export function isVisibleLane(pathname: string, key: string): boolean {
  if (pathname !== LANES_PATH) return false;
  const { lanes, zoomedKey } = useLanesStore.getState();
  if (zoomedKey !== null) return zoomedKey === key;
  return lanes.some((ref) => scopedThreadKey(ref) === key);
}
