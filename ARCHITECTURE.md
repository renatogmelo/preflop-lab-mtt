# Architecture

## Fluxo principal

```text
Dataset/provider
      ↓
StrategyRepository
      ↓
StrategyNode + provenance
      ├── Explore
      ├── Simulation/opponents
      ├── Decision Trainer
      └── Training modes
               ↓
          HandRecord
               ↓
Learning engine → Analyze / Progress / Today's Training
               ↓
             D1
```

## Camadas

### Domínio

`app/core/domain.ts` contém posições, cenários, ações, queries, nodes, provenance, spots e registros. Tipos não dependem de React nem de armazenamento.

`app/core/hands.ts` é a fonte para baralho, normalização, 169 classes, 1326 combinações, features e vizinhança de mãos.

### Strategy Data

`app/core/strategy-data.ts` implementa registry, providers, lookup, nodes, importação e validação. Consumidores não conhecem a forma como a estratégia foi produzida.

`app/core/modeled-provider.ts` contém toda a heurística legada isolada. Ela só pode produzir provenance `modeled` e nunca EV confiável.

### Treino e simulação

`app/simulation.ts` constrói a mesa, action history e decisões adversárias consultando o repositório. Cada oponente usa apenas sua mão, posição, stack e range do node.

`app/engine.ts` mantém compatibilidade com o Trainer, grading por frequência, confidence e knowledge state. EV loss só existe quando todas as ações têm EV confiável.

### Aprendizado

`app/core/learning.ts` é puro e determinístico. Contém scheduling, mastery, fronteiras, leaks, fila de review e session report. Isso permite testes sem UI ou banco.

### UI

- componentes compartilhados: `app/components/`;
- experiências verticais: `app/views/`;
- orquestração/navegação: `app/page.tsx`;
- design: `app/globals.css`.

### Persistência

`db/schema.ts` possui tabelas versionadas. `app/api/user-data/route.ts` é a fronteira autenticada. O browser não recebe nem escolhe `userId`.

## Regras arquiteturais

1. Nenhuma view chama a heurística diretamente.
2. Toda estratégia carrega provenance.
3. Configuração inexistente não usa aproximação silenciosa.
4. EV nulo permanece nulo até um dataset confiável.
5. Analytics não inferem leak com amostra insuficiente.
6. LocalStorage é fallback/migração, não a fonte durável final.
7. ICM, PKO, Cash e Heads-Up entram como datasets/contextos; não como condicionais espalhadas na UI.

## Extensão futura

Um novo dataset implementa o schema documentado, passa pela validação e é instalado no `StrategyRepository`. Uma nova árvore pode introduzir child nodes sem alterar os trainers. Novas métricas devem permanecer funções puras no learning engine antes de ganhar UI.
