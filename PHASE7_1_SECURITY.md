# Fase 7.1 — Segurança

## Controles implementados

- Bind padrão somente em `127.0.0.1`.
- Allowlist de Origin restrita a localhost/127.0.0.1.
- POST exige JSON e `x-preflop-console: 1`, bloqueando requisição cross-site simples.
- Body limitado a 256 KiB.
- `runId` aceita somente caracteres seguros e tamanho limitado.
- Downloads são derivados do run persistido; o navegador nunca fornece caminho arbitrário.
- Árvore visual limitada a 240 nós.
- Providers são built-in; código externo não é carregado.
- Resource Policy, limites de runtime/memória/nós e worker isolado permanecem no engine.
- Erros retornam códigos estruturados e não expõem stack/path interno na resposta normal.

## Evidência

Testes confirmaram rejeição de Origin externo, POST sem guard, schema inválido, budget acima do Tier 0 e acesso limitado à árvore. Traversal, symlink, checksum, checkpoint e resource exhaustion continuam cobertos pela regressão 7.0.

O console local não é um serviço multiusuário e não deve ser exposto diretamente à internet.
