import test from "node:test";
import assert from "node:assert/strict";
import { POSITIONS, SCENARIOS, STACKS } from "../app/core/domain.ts";
import { makeSpot, resolveRound } from "../app/simulation.ts";
import { scenarioIsCompatible } from "../app/core/strategy-data.ts";

test("training generation never creates an incompatible or incomplete spot", () => {
  for (const stack of STACKS) {
    for (const scenario of Object.keys(SCENARIOS)) {
      for (let sample = 0; sample < 8; sample += 1) {
        const spot = makeSpot(stack, scenario, "Todos");
        assert.ok(scenarioIsCompatible(spot.scenario, spot.hero, spot.stack), `${spot.hero} ${spot.scenario} ${spot.stack}bb`);
        assert.equal(spot.cards.length, 2);
        assert.equal(spot.seats.length, 8);
        assert.equal(new Set(spot.seats.flatMap((seat) => seat.cards.map((card) => card.rank + card.suit))).size, 16);
        assert.ok(spot.pot >= 2.5);
        assert.ok(spot.nodeId.startsWith("node:"));
        assert.equal(Math.round(spot.strategy.reduce((sum, action) => sum + action.frequency, 0)), 100);
        assert.ok(spot.strategy.every((action) => action.ev === null), "modeled spot must not expose fabricated EV");
      }
    }
  }
});

test("UTG RFI history identifies first action instead of claiming folds", () => {
  const spot = makeSpot(40, "rfi", "UTG");
  assert.equal(spot.hero, "UTG");
  assert.match(spot.history[0], /primeiro a agir/i);
  assert.doesNotMatch(spot.history[0], /fold até/i);
  assert.equal(spot.pot, 2.5);
});

test("versus 3-bet history preserves chronological action", () => {
  const spot = makeSpot(40, "vs-3bet", "CO");
  const raise = spot.history.findIndex((item) => item.includes("raise"));
  const threebet = spot.history.findIndex((item) => item.includes("3-bet"));
  assert.ok(raise >= 0);
  assert.ok(threebet > raise);
  assert.match(spot.history[raise], /^CO raise/);
});

test("round resolution reveals a legal action for all opponents without card collisions", () => {
  const spot = makeSpot(20, "vs-open", "BTN");
  const action = [...spot.strategy].sort((a, b) => b.frequency - a.frequency)[0].action;
  const resolution = resolveRound(spot, action);
  assert.ok(resolution.summary.length > 0);
  assert.ok(resolution.events.every((event) => POSITIONS.includes(event.position)));
  assert.equal(new Set(spot.seats.flatMap((seat) => seat.cards.map((card) => card.rank + card.suit))).size, 16);
});
