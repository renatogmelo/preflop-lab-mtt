import assert from "node:assert/strict";
import test from "node:test";
import { makeSpot, resolveRound } from "../app/simulation.ts";

test("BTN folds can reach a BB walk without querying an impossible BB RFI node", () => {
  const spot = makeSpot(40, "rfi", "BTN");
  for (let sample = 0; sample < 100; sample += 1) {
    const resolution = resolveRound(spot, "fold");
    assert.ok(Array.isArray(resolution.events));
  }
});
