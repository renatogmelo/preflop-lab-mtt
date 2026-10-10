# Research Engine 1.0 — CLI V1

Entrada: `npm run research -- <comando>`; binário declarado: `preflop-research`.

| Comando | Uso |
|---|---|
| `info` | versão, commit, runtime, algoritmos, formatos, escopo e limitações |
| `capabilities` | contrato completo de capabilities |
| `validate --config <json>` | valida schema, provider, matemática, compatibilidade e recursos |
| `compile --config <json>` | compila e retorna apenas resumo seguro |
| `run --config <json>` | persiste manifesto, inicia worker isolado e espera conclusão |
| `status --run-id <id>` | lê o status persistido |
| `cancel --run-id <id>` | solicita cancelamento cooperativo |
| `resume --run-id <id>` | retoma do Checkpoint V5 mais novo e compatível |
| `checkpoint --run-id <id>` | solicita checkpoint ou informa o último existente |
| `results --run-id <id>` | lê e verifica o resultado completo |
| `verify --artifact <path>` | verifica checksum de Result V1 dentro do workspace |
| `doctor` | verifica Node, escrita, dependências, capabilities e limites |

Saída de sucesso é JSON em `stdout`; erro é JSON estruturado em `stderr`. Configuração inválida sai com código 2; outras falhas saem com código 1. A CLI usa `spawn` com argumentos, nunca shell composto, e não executa código de provider externo.

Exemplo:

```powershell
npm run research -- validate --config examples/research-engine/experiment.json
npm run research -- run --config examples/research-engine/experiment.json
```

O `run` segue a ordem: schema → provider → preflight → manifesto/status → processo isolado → eventos → checkpoints → resultado checksummed. Nenhuma publicação externa é executada pela CLI.
