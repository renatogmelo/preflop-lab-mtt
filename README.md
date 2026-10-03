# Preflop Lab

Preflop Lab é uma plataforma privada de estudo preflop para MTT 8-max ChipEV.

Princípio do produto:

> Não memorize charts. Entenda ranges.

A aplicação combina Explorer de ranges e árvore, sete modos de treino, Academy, revisão espaçada, mastery, detecção de leaks e analytics por mão/node.

## Integridade dos dados

O projeto separa rigorosamente o Trainer da origem estratégica.

O dataset incluído atualmente é identificado na interface como **modelo educacional**. Suas frequências são aproximações arredondadas e seu EV é indisponível. Ele não é apresentado como solve verificado. Datasets verificados ou importados podem substituir o provider sem alterar o Trainer.

Nunca adicione fallback silencioso ou EV fabricado. Quando um node/sizing não existe, a resposta correta do produto é `Strategy unavailable`.

## Desenvolvimento

Requisitos: Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm run lint
npm test
npm run db:generate
```

A suíte `npm test` executa uma build de produção e todos os testes de domínio/renderização.

## Áreas

- **Learn:** 13 capítulos com teoria, exemplo de range, mini teste e prática.
- **Train:** Decision, Frequency, Range, Boundary, Leak, Mixed e Custom Session.
- **Explore:** Range, Tree, Compare e Diff.
- **Analyze:** histórico, review, marcadas, leaks, misconceptions e heatmaps.
- **Progress:** mastery hierárquica, Today's Training e histórico de precisão.

## Persistência

O site usa Cloudflare D1 através do binding `DB`. Em produção, cada registro é associado ao header estável `oai-authenticated-user-id` do site privado. No desenvolvimento sem D1, a interface mantém fallback local explícito.

A migration inicial está em `drizzle/0000_superb_robbie_robertson.sql`.

## Documentação

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [STRATEGY_DATA.md](./STRATEGY_DATA.md)
- [TRAINING_ENGINE.md](./TRAINING_ENGINE.md)
- [PROGRESS.md](./PROGRESS.md)
