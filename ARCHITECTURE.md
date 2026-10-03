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


## Phase 2 — confiança e curadoria

A resolução pública usa providers publicados e habilitados na ordem:

```text
Verified → Curated → Modeled (somente se allowModeledFallback)
```

Experimental nunca participa por padrão. Draft, review-required, reviewed e deprecated não entram no treino normal. `Professional Mode` consulta a mesma camada com `allowModeledFallback = false`.

A confiança é independente da origem:

- `sourceType` descreve como o dado nasceu;
- `trustLevel` descreve quanto o produto pode afirmar;
- `status` descreve o estágio editorial;
- provenance replica dataset id, versão, trust, metodologia, licença, precisão, EV e revisão no node consumido.

O fluxo editorial é:

```text
Create → Draft → Review required → Reviewed → Published
```

`StrategyRepository.install` bloqueia publicação curated que tente pular a revisão. O editor pode usar o modelo como rascunho apenas após uma ação explícita; isso não altera o trust.

Coverage usa um catálogo auditável de 252 combinações canônicas. Inspector valida node, 169 mãos e metadata. O histórico persiste `datasetId + datasetVersion + nodeId`, portanto atualizações futuras não reclassificam decisões antigas.

## Phase 3 ? solver boundary

O solver vive em `solver/` e n?o depende de React, D1 ou views. Somente o exporter conhece o schema do StrategyDataset.

```text
GameDefinition ? Solver Core ? Raw Artifact ? Validation ? Exporter ? StrategyRepository
```

O dataset POC ? instalado como `Experimental`, exige opt-in e n?o participa da resolu??o padr?o. Resultados do solver nunca mudam trust automaticamente.

O core de refer?ncia 0.1.0 usa TypeScript/f64 e execu??o single-thread para auditabilidade. Portar traversal/storage para Rust ? uma evolu??o p?s-profiling e deve manter artefatos e testes diferenciais compat?veis.

Continuation values permanecem uma interface separada. Level 0 ? desenvolvimento; somente uma continua??o tecnicamente defens?vel pode entrar num candidato Verified.
