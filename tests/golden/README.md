# Golden strategy snapshots

Every Verified dataset must have a reviewed snapshot in this directory before installation or deployment. Updating a golden file is an explicit review action and must accompany the dataset changelog/version bump.

Curated datasets may add snapshots for strategically important boundary hands. Modeled data uses invariant tests, not golden values that could falsely imply GTO verification.

Files explicitly labeled as regression fixtures, including the Phase 5 reduced-game snapshot, only detect unintended implementation changes. They are not poker truth, solver certification, or evidence that a strategy is GTO.
