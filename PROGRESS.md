# Preflop Lab — Progresso

Atualizado em: 2026-10-03

## PHASE 2 AUDIT

### Implementado e confirmado no código

- `StrategyRepository` é a fronteira única de leitura usada por Explorer, Trainer e simulação.
- O provider heurístico está isolado, declara `sourceType = modeled`, frequências estimadas, `isExact = false` e EV indisponível.
- Nodes carregam identidade, query, pote, histórico, ator, ações, 169 classes e provenance.
- O motor recusa sizings e configurações incompatíveis em vez de adaptar silenciosamente.
- Decision, Frequency, Range, Boundary, Mixed, Leak e Custom existem e usam Strategy Data.
- Learning engine possui repetição espaçada, confidence, misconceptions, mastery limitado por evidência, fronteiras, leaks e relatórios.
- D1 persiste decisões e o JSON integral do registro; o histórico local continua como fallback.
- Build, lint e 21 testes estavam verdes antes do início desta fase.

### Parcialmente implementado

- Provenance existe, mas ainda não separa formalmente `sourceType` de `trustLevel` nem guarda metodologia, licença, revisão e changelog completos.
- O repositório suporta providers estáticos, porém o lookup ainda exige um dataset específico e não resolve automaticamente `verified → curated → modeled`.
- Importação JSON/CSV e validação existem, mas não há status editorial, semver validada, golden snapshots ou inspeção administrativa.
- Frequency Trainer calcula MAE, mas não informa erro por ação, acerto da ação dominante ou calibração pedagógica.
- Range Trainer mede VPIP, faltas, excessos e ação dominante, mas não modela frequências do aluno, boundaries clicáveis nem as maiores divergências ponderadas.
- Boundary Trainer usa mistura e vizinhança, mas não incorpora histórico do aluno, confidence, importância estratégica ou EV disponível.
- Leak detection exige amostra mínima, mas ainda não comunica níveis estatísticos `possible / likely / confirmed`.
- Academy conecta teoria, matriz e prática, porém vários capítulos ainda usam uma matriz estática em vez de uma sequência interativa do conceito.
- Mastery limita pouca evidência, mas não explicita estados de evidência nem contextualiza completamente o nome e trust do dataset estudado.

### Apenas preparado arquiteturalmente

- Entrada de datasets curated/verified legalmente utilizáveis.
- EV e golden values de solve verificado.
- ICM, PKO, Cash e Heads-Up (fora do escopo desta fase).
- Version-aware reinterpretation: decisões já guardam provenance no JSON, mas falta coluna dedicada para `datasetVersion` e sinalização de atualização.

### Limitações e inconsistências encontradas

- `StrategySourceType` mistura origem e confiança (`imported`/`estimated`), o que impede política de confiança inequívoca.
- `SourceNote` trata qualquer fonte não-modelada como “dataset verificado”; isso pode rotular curated/imported incorretamente.
- Não existe Coverage Map nem contagem auditável de combinações cobertas.
- Não há curated dataset instalado, editor, revisão, publicação, diff ou exportação.
- `Professional` aparece como preferência, mas ainda não desativa fallback modelado.
- O Mixed Trainer é apenas Frequency Trainer filtrado e não ensina recognition/composition/frequency em etapas.
- A UI de decisão não oferece todas as rotas contextuais solicitadas após um erro.
- Testes atuais cobrem invariantes centrais, mas não percorrem um catálogo completo de nodes nem validam workflow editorial, prioridade, fallback e regressões visuais.
- Não há E2E automatizado real dos fluxos críticos; o teste renderizado atual valida somente o shell HTML.

### Dívidas técnicas prioritárias

1. Separar origem, confiança e status editorial no domínio.
2. Implementar resolução composta e política de fallback.
3. Criar catálogo de cobertura mensurável e ferramentas de Inspector/Editor.
4. Persistir `datasetVersion` em coluna dedicada.
5. Tornar métricas e explicações trust-aware em todos os trainers e analytics.
6. Expandir testes parametrizados, golden infrastructure, fluxos E2E e contratos visuais.

### Próximos passos desta fase

1. Implementar trust/provenance e repository resolution.
2. Integrar Coverage, Inspector e Curated Range Editor.
3. Corrigir os sete trainers e o fluxo contextual de estudo.
4. Calibrar mastery/analytics e auditar Academy.
5. Executar a suíte ampliada e publicar somente após build, lint e testes verdes.


## Objetivo atual

Concluir a evolução vertical do Preflop Lab para uma plataforma de estudo MTT 8-max ChipEV: Strategy Data Layer honesta, Explorer, centro de treino, inteligência de aprendizado, Academy, Analyze/Progress, persistência D1, documentação e hardening.

## Estado atual

### Foundation — concluída

- Auditoria integral do repositório, engine, simulador, UI, persistência e testes.
- Tipos de domínio separados em `app/core/domain.ts`.
- Catálogo completo das 169 classes, normalização, combinações e baralho em `app/core/hands.ts`.
- Heurísticas legadas isoladas em provider explicitamente `modeled`.
- `StrategyRepository` desacopla Trainer e Strategy Data.
- Datasets possuem metadata, versão, source type, stacks, sizings e nodes suportados.
- Lookups ausentes retornam `Strategy unavailable`; não há fallback silencioso.
- EV heurístico removido da UI e do grading. Sem EV confiável, a aplicação mostra `Indisponível`.
- Arquitetura de nodes contém identidade estável, pai, pote, histórico, ator, ações e estratégia.
- Importadores JSON/CSV e validação de frequências, mãos, posições, stacks, nodes e metadata.
- Trainer e decisões adversárias agora consultam o repositório, nunca o gerador diretamente.

### Explorer — concluído funcionalmente

- Range Explorer com matriz 13×13 e estratégia mista proporcional.
- Painel de mão com classificação, conceitos, EV disponível/indisponível e mãos próximas.
- Tree Explorer com breadcrumbs e travessia de nodes.
- Compare 20bb/40bb/100bb.
- Diff entre stacks, threshold configurável e detalhe por mão.
- Procedência visível: modelo educacional versus dataset verificado.
- Estado explícito para sizing/node indisponível e alternativas somente por escolha do usuário.

### Training Engine — concluído funcionalmente

- Decision Trainer existente preservado e migrado para Strategy Data.
- Histórico correto da ação, pot, stacks e revelação didática das mãos adversárias.
- Confidence 1–5 antes da decisão.
- Frequency Trainer com distribuição completa e MAE em pontos percentuais.
- Range Trainer para construir a matriz e comparar missing hands, excess hands, ação errada e composição.
- Boundary Trainer prioriza estratégias mistas, mudança de ação e distância entre vizinhas.
- Mixed Strategy Trainer.
- Leak Trainer gera treino apenas quando existe amostra mínima real.
- Custom Session Builder com stack, posição, situação, dificuldade, quantidade e filtro de mixed.
- Preset custom local; decisões principais sincronizadas com D1 quando disponível.

### Learning Intelligence — concluída no núcleo

- Estado de aprendizado por `node + hand`.
- Scheduling determinístico inspirado em revisão espaçada.
- Erros confiantes retornam rapidamente e são classificados como misconception.
- Mastery considera accuracy, erro de frequência, calibração, streak, recência e volume.
- Evidência impede mastery alta por uma única resposta.
- Fila de revisões vencidas priorizada por misconception, fraqueza, erro e EV quando disponível.
- Detecção de leaks por node, posição, faixa de stack e classe de mão.
- Reforço de mãos vizinhas e algoritmo de fronteiras.
- Relatório de sessão com accuracy, frequency MAE, EV quando disponível, misconceptions e recomendação.

### Education — concluída verticalmente

- Academy com 13 capítulos: Foundations até Advanced Preflop Thinking.
- Cada aula contém teoria, exemplo, matriz interativa, mini teste, explicação e prática conectada ao Trainer.
- Progresso de aulas salvo localmente; tabela D1 já preparada para migração.
- Linguagem acessível sem esconder conceitos avançados.

### Analyze e Progress — concluídos funcionalmente

- Analyze com histórico, revisão, marcadas, misconceptions, leaks e heatmaps.
- Heatmaps para accuracy, frequency accuracy, confidence, attempts e mastery.
- Diagnóstico recusa afirmar leaks sem amostra suficiente.
- Session report das últimas 50 decisões.
- Progress com mastery hierárquica por cenário, confronto e stack band.
- Today's Training combina reviews vencidas, leaks, misconceptions e fronteiras.
- Histórico visual de precisão.
- Preferência de interface Beginner/Advanced/Professional preparada na UI.

### Deployment — concluído

- Commit funcional validado e enviado ao remote do Sites.
- Versão privada publicada com sucesso em `https://preflop-lab-mtt.renatogomes2504.chatgpt.site`.
- D1 incluído no artefato com migration inicial.
- Site aberto no painel do Codex após confirmação do status `succeeded`.

### Persistência — schema e integração concluídos

- D1 habilitado como binding `DB`.
- Migration Drizzle gerada para sete tabelas:
  - user profiles/preferences;
  - decisions;
  - learning states;
  - study notes;
  - bookmarks;
  - custom sessions;
  - academy progress.
- API `/api/user-data` usa identidade privada do ChatGPT em produção.
- Histórico local existente é mesclado e migrado de forma idempotente.
- Aplicação mantém fallback local explícito quando D1 não está presente no desenvolvimento.

## Decisões arquiteturais

1. O Trainer consome apenas `StrategyRepository`.
2. Fonte modelada pode preencher a experiência educacional, mas nunca é apresentada como solve verificado.
3. Frequências modeladas são aproximadas; EV permanece nulo.
4. Nenhuma configuração de sizing ganha estratégia inventada.
5. Analytics trabalham com evidência e limiares mínimos.
6. Mastery é evidence-capped e hierárquica.
7. D1 é a fonte durável; localStorage é fallback/migração e preferência transitória.
8. O site privado fornece identidade; nenhum login paralelo será criado.
9. MTT 8-max ChipEV continua sendo o núcleo; ICM permanece apenas preparado nos tipos.
10. Academy, treino e análise compartilham o mesmo domínio e Strategy Data.

## Arquivos importantes modificados

- `app/core/domain.ts`
- `app/core/hands.ts`
- `app/core/modeled-provider.ts`
- `app/core/strategy-data.ts`
- `app/core/learning.ts`
- `app/engine.ts`
- `app/simulation.ts`
- `app/components/strategy-matrix.tsx`
- `app/views/explore-view.tsx`
- `app/views/training-lab.tsx`
- `app/views/learn-view.tsx`
- `app/views/analytics-view.tsx`
- `app/api/user-data/route.ts`
- `app/page.tsx`
- `app/globals.css`
- `db/schema.ts`
- `drizzle/0000_superb_robbie_robertson.sql`
- `.openai/hosting.json`
- `tests/core.test.mjs`
- `tests/learning.test.mjs`
- `tests/rendered-html.test.mjs`

## Testes realizados

- Build Vinext limpa após Strategy Data, Explorer, Training Engine, D1, Academy e Analytics.
- ESLint limpo.
- 21 testes passando:
  - 52 cartas e mesas sem colisões;
  - normalização e 169 classes/1326 combos;
  - procedência modelada e ausência de EV inventado;
  - recusa de sizing não suportado;
  - pot e histórico dos nodes;
  - compatibilidade de cenário;
  - validação e importação;
  - confidence/misconception;
  - revisão espaçada determinística;
  - mastery limitada por evidência;
  - fila de review;
  - fronteiras;
  - leak sintético;
  - mastery hierárquica;
  - renderização e acessibilidade básica;
  - 840+ formações de treino sem situações incompatíveis;
  - regressões de UTG first-to-act, ordem de 3-bet e resolução da rodada.
- Migration gerada com Drizzle: 7 tabelas.
- Inspeção visual automatizada não pôde ser executada porque o runtime do navegador encontrou uma falha de ACL do Windows; validação por build/render server permaneceu verde.

## Problemas conhecidos

- O único dataset disponível continua sendo um modelo educacional aproximado, não um solve verificado.
- Sem dataset verificado, Golden Tests de valores estratégicos e EV não podem ser honestamente criados.
- A travessia do Tree Explorer cobre as linhas principais implementadas; cold 4-bets e toda a árvore combinatória aguardam dataset correspondente.
- Academy progress e custom presets possuem schema D1, mas ainda usam armazenamento local na UI.
- Study Notes e Bookmarks possuem persistência preparada, mas ainda não estão expostos na interface.
- Interface Level está visível, mas ainda não altera densidade de todas as explicações.
- Search global, hotkeys configuráveis e auto-next ainda precisam de acabamento.
- É necessário validar visualmente a aplicação publicada em desktop/mobile assim que o runtime do navegador estiver disponível.

## Próximo passo

1. Adicionar um dataset verificado/licenciado para habilitar EV, golden tests e precisão de solve.
2. Validar visualmente desktop/mobile quando o runtime de automação do navegador deixar de falhar por ACL.
3. Expandir Tree Explorer para cold 4-bets e linhas profundas quando esses nodes existirem no dataset.
4. Sincronizar marcações editadas e leitura de presets/notas da nuvem na UI.
5. Continuar calibrando a UX com sessões reais de estudo.


## Phase 2 — implementação concluída

- Trust Level formal: Verified, Curated, Modeled e Experimental.
- Provenance completa com metodologia, licença, revisão, precisão, EV, status, id e versão.
- Resolução `Verified → Curated → Modeled`; Experimental excluído por padrão.
- Fallback modelado configurável e modo trusted-only funcional em Coverage/Inspector.
- Coverage Map e métricas sobre 252 combinações canônicas.
- Cobertura atual: 0 Verified, 0 Curated publicado, 217 Modeled e 35 indisponíveis.
- Preflop Lab Reference Strategy criada com zero ranges inventados/publicados.
- Dataset Inspector e Curated Range Editor com matriz 169, validação, diff, notas, SemVer, import/export e workflow explícito.
- Bloqueio de publicação curated sem revisão.
- Golden infrastructure e invariantes parametrizados sobre todos os nodes suportados.
- Trainers auditados e corrigidos; relatórios em `TRAINER_AUDIT.md`.
- Explanation Engine em três níveis, Range Structure, Neighborhood, Stack Evolution e Position Evolution.
- Academy auditada e RFI Position Evolution tornou-se interativo.
- Today's Training V2 com diversidade e mastery calibrado por evidência/trust.
- Decisões persistem `datasetVersion` em coluna dedicada; versões antigas não são reclassificadas.
- 36 testes verdes, incluindo 2.500 casos gerados, catálogo completo, workflow, golden, E2E lógico, performance e contratos visuais estruturais.

## Phase 3 ? funda??o do Preflop Lab Solver

- Core isolado em TypeScript estrito, vers?o 0.1.0, com fronteira pronta para futura implementa??o nativa ap?s profiling.
- Vanilla CFR, CFR+ e DCFR implementados sobre uma interface de jogo extensivo.
- Kuhn validado contra valor conhecido, best response exato, exploitability e NashConv.
- Deck 52, 1.326 combos, 169 classes, weighted ranges e card removal.
- Betting engine com stacks assim?tricos, blinds, ante/BBA, min-raise, all-in e reopening.
- Hold'em POC heads-up push/fold em n?vel de combo, com 5 milh?es de amostras e 2.652 infosets.
- Checkpoint/resume, solve identity, artefatos brutos, benchmark, valida??o e CLI.
- Primeiro StrategyDataset do solver instalado como Experimental e exclu?do do auto-resolution.
- Continuation Level 0 e exploitability Hold'em continuam pendentes; Verified permanece 0.
- Corre??o adicional: walk do BB n?o consulta mais um node RFI imposs?vel.
- 48 testes verdes ap?s build, typecheck e lint.
- Detalhes em SOLVER_PROGRESS.md e SOLVER_VALIDATION.md.


## Phase 5 - strategic continuation and coupling

- Repository baseline: 9a8a11c; solver version advanced to 0.3.0.
- Hold'em V2 training can sample explicit weighted physical-combo ranges.
- A separate exact evaluation traversal now reports strategy EV, BR values, NashConv and exploitability for computationally tractable reduced games.
- Weighted-range postflop chance uses product weights, card-collision rejection and board blockers.
- Conditional ranges are immutable Bayesian snapshots derived from the complete joint reach.
- The new range postflop engine supports flop/turn/river decisions, jam and one optional raise per street.
- Strategy comparison includes L1, L2, maximum delta, weighted mean delta and Jensen-Shannon divergence.
- The first Proxy/Equity/Solved experiment ran three seeds each. Equity-vs-Solved weighted distance was 0.636867.
- Sampled-vs-enumerated distance fell to 0.176883 at 4,000 iterations but was not monotonic.
- Coupling ran three outer iterations with alpha=0.6 and did not converge; final preflop delta was 0.511634.
- Reference postflop exploitability remained 0.270565. All outputs remain Experimental; Verified remains zero.
- Detailed evidence: PHASE5_REPORT.md and PHASE5_PERFORMANCE.md.

## PHASE 6 - CONVERGENCE, STABILITY AND COUPLING

Completed experimentally on 2026-10-04. The inner frozen solver is now fast and auditable, but the end-to-end pipeline is not yet reliable enough to scale.

- Inner result: exploitability `0.010074` at 5,000 iterations.
- Performance: `9.90x` indexed traversal speedup; compiled BR `117.40x`.
- Seed stability: Solved mean distance `0.126345` - failed.
- Provider signal: PSR `5.171253` - passed as a diagnostic only.
- Coupling: no fixed point; alpha 0.6/1 diverged - failed.
- Decision: Phase 7 blocked; Verified remains 0; product-facing training data unchanged.
Validation final: TypeScript, lint, build de producao e 82/82 testes aprovados.

## Phase 6.5 — deterministic pipeline stability

Implemented and measured exact 46-deal preflop traversal, RNG ledgers, fixed/stratified/quasi schedules, sample coverage, exact provider comparison, sensitivity diagnostics, canonical board buckets and deterministic fixed-point checkpoint/resume.

Result: A ✅, B ✅, C ✅, D ❌. Exact seed distance is zero, but coupling did not converge after 100 outer iterations. Board Coverage / Phase 7 is not released. Product-facing poker data remains Experimental and `Verified = 0`.

<!-- PHASE6.6 START -->
## Phase 6.6 solver status

Solver 0.6.0 completed the continuation-operator diagnosis without product expansion. Gates: A ✅, B ✅, C ✅, D ❌. Verified = 0. Main blocker: non-small raw fixed-point residual and response ratios above one, with path dependence and intermittent inner-quality failure. Phase 7 is not authorized/recommended; next research should stabilize E or evaluate unified solving.
<!-- PHASE6.6 END -->
