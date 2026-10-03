import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const explore = fs.readFileSync(new URL("../app/views/explore-view.tsx", import.meta.url), "utf8");
const training = fs.readFileSync(new URL("../app/views/training-lab.tsx", import.meta.url), "utf8");
const analytics = fs.readFileSync(new URL("../app/views/analytics-view.tsx", import.meta.url), "utf8");

test("visual contracts keep critical screens and responsive phase-2 layouts", () => {
  for (const selector of [".coverage-table", ".inspector-grid", ".editor-matrix", ".range-structure", ".evolution-grid", ".context-actions", ".academy-interactive"]) assert.match(css, new RegExp(selector.replace(".", "\\.")));
  assert.match(css, /@media\(max-width:900px\)/);
  for (const label of ["Range Explorer", "Coverage", "Inspector", "Curated Editor"]) assert.match(explore, new RegExp(label));
  for (const label of ["FREQUENCY TRAINER", "RANGE TRAINER", "BOUNDARY TRAINER", "LEAK TRAINER"]) assert.match(training, new RegExp(label));
  for (const label of ["Histórico", "Heatmaps", "TODAY&apos;S TRAINING V2"]) assert.match(analytics, new RegExp(label));
});
