import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  addLanes,
  laneGrid,
  laneLayout,
  type LanesState,
  MAX_LANES,
  moveLane,
  removeLane,
} from "./lanesStore";

const ref = (environment: string, thread: string) =>
  scopeThreadRef(environment as EnvironmentId, ThreadId.make(thread));
const empty: LanesState = { lanes: [], zoomedKey: null };
const keys = (state: LanesState) => state.lanes.map(scopedThreadKey);

describe("addLanes", () => {
  it("skips threads already in a lane, including the same id on another environment only once", () => {
    const first = addLanes(empty, [ref("env-1", "a"), ref("env-2", "a"), ref("env-1", "a")]);
    expect(first.added).toBe(2);
    const again = addLanes(first.state, [ref("env-1", "a"), ref("env-1", "b")]);
    expect(again.added).toBe(1);
    expect(keys(again.state)).toEqual(
      [ref("env-1", "a"), ref("env-2", "a"), ref("env-1", "b")].map(scopedThreadKey),
    );
  });

  it("stops at MAX_LANES and reports the rest as overflow", () => {
    const refs = Array.from({ length: MAX_LANES + 3 }, (_, index) => ref("env", `t${index}`));
    const result = addLanes(empty, refs);
    expect(result.added).toBe(MAX_LANES);
    expect(result.overflow).toBe(3);
    expect(addLanes(result.state, [ref("env", "late")]).overflow).toBe(1);
  });
});

describe("removeLane and moveLane", () => {
  const state = addLanes(empty, [ref("e", "a"), ref("e", "b"), ref("e", "c")]).state;
  const [a, b, c] = keys(state) as [string, string, string];

  it("clears the zoom when the zoomed lane closes", () => {
    expect(removeLane({ ...state, zoomedKey: b }, b)).toEqual({
      lanes: [ref("e", "a"), ref("e", "c")],
      zoomedKey: null,
    });
    expect(removeLane({ ...state, zoomedKey: a }, b).zoomedKey).toBe(a);
  });

  it("moves a lane into another's slot in either direction", () => {
    expect(keys(moveLane(state, a, c))).toEqual([b, c, a]);
    expect(keys(moveLane(state, c, a))).toEqual([c, a, b]);
    expect(moveLane(state, a, "missing")).toBe(state);
  });
});

it("lays out one row up to four lanes, then two rows", () => {
  expect([1, 4, 5, 8].map(laneGrid)).toEqual([
    { columns: 1, rows: 1 },
    { columns: 4, rows: 1 },
    { columns: 3, rows: 2 },
    { columns: 4, rows: 2 },
  ]);
});

describe("laneLayout", () => {
  it("widens a short last row so it fills the width", () => {
    expect(laneLayout(3)).toEqual({ columns: 3, rows: 1, spans: [1, 1, 1] });
    expect(laneLayout(6)).toEqual({ columns: 3, rows: 2, spans: [1, 1, 1, 1, 1, 1] });
    expect(laneLayout(5)).toEqual({ columns: 6, rows: 2, spans: [2, 2, 2, 3, 3] });
    expect(laneLayout(7)).toEqual({ columns: 12, rows: 2, spans: [3, 3, 3, 3, 4, 4, 4] });
  });
});
