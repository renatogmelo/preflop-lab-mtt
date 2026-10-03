import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server renders the Preflop Lab product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Preflop Lab/);
  assert.match(html, /PREFLOP/);
  assert.match(html, /MTT 8-max/);
  assert.match(html, /Treino preflop/);
  assert.doesNotMatch(html, /Your site is taking shape|Starter Project|codex-preview/i);
});

test("server output exposes accessible core controls", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /aria-label="Navegação principal"/);
  assert.match(html, /id="position"/);
  assert.match(html, /id="spot"/);
  assert.match(html, /aria-label="Preflop Lab/);
});
