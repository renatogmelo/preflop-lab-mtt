# Dataset Coverage — MTT 8-max ChipEV Preflop

Measured on: 2026-10-03

## Catalog definition

Coverage is measured over 252 canonical combinations:

- seven stacks: 10, 15, 20, 30, 40, 60 and 100bb;
- seven scenario families: RFI, vs Open, vs 3-bet, BB Defense, BvB, Squeeze and vs Jam;
- every hero position structurally eligible for that scenario before stack restrictions;
- exact default sizings declared by each provider.

This is a finite audit catalog, not a claim that the full poker game tree contains only 252 nodes.

## Current resolution coverage

| Trust | Nodes | Percent of catalog |
|---|---:|---:|
| Verified | 0 | 0.0% |
| Curated (published) | 0 | 0.0% |
| Modeled | 217 | 86.1% |
| Experimental | 0 | 0.0% |
| Unavailable | 35 | 13.9% |
| Total | 252 | 100% |

The 35 unavailable combinations are intentional stack/scenario exclusions: vs 3-bet at 10bb and vs Jam above 25bb. They are not silently approximated.

## Trusted-only coverage

With `allowModeledFallback = false`:

- supported: 0;
- unavailable: 252;
- Verified: 0;
- Curated: 0.

This is the honest current state. The Preflop Lab Reference Strategy exists as a draft editorial container with zero published nodes; no modeled output was promoted.

## Resolution policy

```text
Verified
  ↓
Curated (published)
  ↓
Modeled, only when allowModeledFallback = true
```

Experimental data is excluded from automatic resolution. Draft, review-required, reviewed and deprecated datasets are also excluded from normal training; only `published` participates.

## How to update this document

Run the repository coverage metrics after installing or publishing a dataset. A change to these numbers must be accompanied by dataset version, changelog and tests. Golden values are mandatory for Verified data and recommended for Curated data.
