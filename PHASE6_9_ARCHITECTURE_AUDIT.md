# Phase 6.9 Architecture Audit

Baseline: `8f0eaa0c932e5a1db43068c760ef57012c771e8c`.

## Materialization path before Phase 6.9

1. `SyntheticExtensiveGameGenerator.generateGame` recursively allocated every node, transition record, action string, observation object, history array, and node ID in `UnifiedGameDefinition.nodes`.
2. `UnifiedResearchGame` retained that declarative definition.
3. `compileGameTree` recursively copied the definition into a second object graph of compiled nodes.
4. `compileIndexedTree` walked the compiled graph into a temporary `TemporaryNode[]`, then copied it into typed arrays.
5. `IndexedCfrSolver` retained both the compiled object graph and indexed arrays because compiled best response still consumed the object graph.
6. Information-set keys/actions remained JavaScript strings and objects even after numeric topology compilation.
7. Regrets and strategy sums were allocated separately as `Float64Array` buffers.
8. Compiled best response built `Map<string, ResponseNode[]>` groups and recursively re-evaluated subtrees.
9. Checkpoint creation expanded typed state into per-infoset JavaScript objects and JSON serialization created another full textual copy.

The peak therefore could include definition, compiled objects, temporary indexed nodes, final indexed arrays, solver buffers, BR groups, and checkpoint copies at different phases.

## Phase 6.9 path

`SyntheticGameConfiguration → SyntheticCompactProvider → CompactIndexedTree`

The provider defines state identity, transitions, information sets, chance probabilities, and terminal utilities arithmetically. `compileCompactGame` writes final typed arrays directly, using only a one-byte-per-node parent/reachability validation buffer. It does not build the declarative node dictionary, compiled object graph, temporary node objects, duplicated child-index array, or P1 terminal array.

The solver retains only the provider, compact topology, regrets, strategy sums, and small metadata. BR V2 consumes the compact representation directly. Checkpoint V4 is created only on request.

## Retention findings

- Double materialization existed and was structural, not incidental.
- The Phase 6.8 solver's reference to `compiledTree` was necessary only because evaluation had not yet been ported.
- Eager exact CFR still benefits from a compact topology because it visits the full tree every iteration.
- Lazy state generation is useful for validation and one-off evaluation, but it does not change the mathematical node count of exact CFR.
- JSON checkpoint serialization remains the principal intentional full-state copy.
