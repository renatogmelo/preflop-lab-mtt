import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SyntheticCompactProvider,
  compileCompactGame,
  evaluateLazyStrategy,
} from "../solver/research/compact/index.ts";
import { SCALE_CONFIGURATIONS } from "../solver/research/scalability/experiment-runner.ts";

test("Phase 6.9 information-set IDs are stable and exclude opponent private state", () => {
  const configuration = SCALE_CONFIGURATIONS[1].configuration;
  const first = new SyntheticCompactProvider(configuration);
  const second = new SyntheticCompactProvider({ ...configuration, id: "same-semantics-new-id" });
  assert.equal(first.informationSetCount, second.informationSetCount);
  for (let id = 0; id < first.informationSetCount; id += 1) {
    assert.equal(first.informationSetKey(id), second.informationSetKey(id));
    assert.doesNotMatch(first.informationSetKey(id), /opponent|opp/);
  }
});

test("Phase 6.9 explicit stack traverses a deeper tree without recursion", () => {
  const base = SCALE_CONFIGURATIONS[0].configuration;
  const provider = new SyntheticCompactProvider({ ...base, id: "deep-stack", privateStates: 1, publicSignals: 1, stages: 8 });
  const result = evaluateLazyStrategy(provider, () => 0.5);
  assert.equal(result.nodesVisited, provider.nodeCount);
  assert.ok(result.stackBytes <= (provider.maximumDepth + 2) * 23);
  assert.ok(result.utilities.every(Number.isFinite));
});

test("Phase 6.9 compiler rejects index overflow before allocating", () => {
  const provider = {
    id: "overflow",
    logicalGameHash: "overflow",
    nodeCount: 0x1_0000_0000,
    informationSetCount: 0,
    maximumDepth: 0,
    levels: [],
  };
  assert.throws(() => compileCompactGame(provider), /Uint32 capacity/);
});

test("Phase 6.9 compiler rejects invalid non-forward transitions", () => {
  const provider = {
    id: "invalid-transition",
    logicalGameHash: "invalid-transition",
    nodeCount: 2,
    informationSetCount: 0,
    maximumDepth: 1,
    levels: [
      { kind: "root-chance", stage: -1, offset: 0, count: 1 },
      { kind: "terminal", stage: 0, offset: 1, count: 1 },
    ],
    initialState: () => 0,
    stateAt: (state) => state,
    actor: (state) => state === 0 ? "chance" : null,
    legalActions: (state) => state === 0 ? [0] : [],
    transition: () => 0,
    informationSet: () => -1,
    informationSetKey: () => "",
    informationSetActionCount: () => 0,
    actionLabel: () => "",
    chanceProbability: () => 1,
    terminalUtility: (state) => state === 1 ? [0, 0] : null,
  };
  assert.throws(() => compileCompactGame(provider), /invalid forward child/);
});

test("Phase 6.9 preserves explicit zero-probability chance branches", () => {
  const provider = {
    id: "zero-probability",
    logicalGameHash: "zero-probability",
    nodeCount: 3,
    informationSetCount: 0,
    maximumDepth: 1,
    levels: [
      { kind: "root-chance", stage: -1, offset: 0, count: 1 },
      { kind: "terminal", stage: 0, offset: 1, count: 2 },
    ],
    initialState: () => 0,
    stateAt: (state) => state,
    actor: (state) => state === 0 ? "chance" : null,
    legalActions: (state) => state === 0 ? [0, 1] : [],
    transition: (_state, action) => action + 1,
    informationSet: () => -1,
    informationSetKey: () => "",
    informationSetActionCount: () => 0,
    actionLabel: () => "",
    chanceProbability: (_state, action) => action === 0 ? 1 : 0,
    terminalUtility: (state) => state === 1 ? [2, -2] : state === 2 ? [-100, 100] : null,
  };
  const compilation = compileCompactGame(provider);
  assert.equal(compilation.tree.validation.valid, true);
  assert.equal(compilation.tree.edgeProbability[2], 0);
  assert.deepEqual(evaluateLazyStrategy(provider, () => 0).utilities, [2, -2]);
});

test("Phase 6.9 artifact preserves gates, safe abort and honest reporting", async () => {
  const artifact = JSON.parse(await readFile(new URL("../solver/artifacts/phase6-9-compact-tree-v0.9.0.json", import.meta.url), "utf8"));
  assert.deepEqual(artifact.gates, { M1: true, M2: true, M3: true, M4: true, M5: true, M6: true, M7: true });
  assert.equal(artifact.s5Experiment.status, "safe-abort");
  assert.deepEqual(artifact.s5Experiment.preflight.reasons, ["node-budget"]);
  assert.equal(artifact.s4Convergence.convergedClaim, false);
  assert.equal(artifact.historicalGates.D, false);
  assert.equal(artifact.verifiedDatasets, 0);
});
