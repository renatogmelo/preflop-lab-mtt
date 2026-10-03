import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicRandom } from "../solver/core/random.ts";
import { applyBettingAction, assertBettingState, createPreflopBettingState, legalBettingActions } from "../solver/game/betting.ts";
import { mtt8MaxDefinition } from "../solver/game/definition.ts";

test("500 generated legal betting traces preserve chip and state invariants", () => {
  const random = new DeterministicRandom(20261003);
  for (let trial = 0; trial < 500; trial += 1) {
    let state = createPreflopBettingState(mtt8MaxDefinition(10 + random.integer(91)));
    let actions = 0;
    while (!state.complete && actions < 40) {
      const player = state.players.find((item) => item.id === state.actingPlayerId);
      assert.ok(player);
      const maxTarget = player.committed + player.stack;
      const candidates = legalBettingActions(state, [
        state.currentBet + state.minRaiseIncrement,
        Math.min(maxTarget, state.currentBet + state.minRaiseIncrement * 2),
      ]);
      assert.ok(candidates.length > 0);
      state = applyBettingAction(state, candidates[random.integer(candidates.length)]);
      const integrity = assertBettingState(state);
      assert.equal(integrity.valid, true, integrity.issues.join(" "));
      assert.ok(state.players.every((item) => item.stack + item.committed + item.deadCommitted <= item.startingStack + 1e-9));
      actions += 1;
    }
    assert.ok(state.complete, "Generated betting round did not terminate.");
  }
});
