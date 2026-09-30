# Auditoria de performance — Superset no macOS

**Auditoria original:** 24/09/2026.  
**Arquivo reconstruído:** 28/09/2026, a partir do relatório preservado no histórico da conversa.  
**Checkout auditado:** mulher-afogada, commit **331e0229f92434219d4e79f28c700c7296ea92f4**.

> Este documento preserva os resultados da auditoria original. As medições e conclusões não foram reexecutadas ou revalidadas em 28/09. Os anexos JSON, cópias dos bundles, scripts e perfis que estavam em /tmp/superset-performance-audit-20260924 não estão disponíveis nesta reconstrução. Arquivos e linhas de código referem-se ao checkout auditado e podem ter mudado desde então.

**Nenhum código do projeto foi alterado durante a auditoria.** Não foram executados build, instalação de dependências, testes funcionais ou migrações, nem reiniciado o app. A restauração atual adiciona somente este relatório ao projeto.

## 1. Resumo executivo

Há oportunidades relevantes dentro da arquitetura Electron atual. As evidências mais fortes são o empacotamento excessivo, a ausência de minificação e a inicialização antecipada de subsistemas. Ainda falta uma rodada controlada para ordenar todos os gargalos por milissegundos ou consumo de bateria.

| Prioridade | Gargalo / oportunidade | Ganho estimado e fundamento |
|---|---|---|
| 1 | Pacote carrega mapas e dependências redundantes — P02/P03 | **387,6 MiB** de source maps identificados. Mais **167,4 MiB** em cinco categorias sem sobreposição com os mapas: react-icons, emojibase-data, prebuilds Windows do node-pty, fonte SQLite e tsbuildinfo. Potencial bruto combinado de **555 MiB**, sujeito à auditoria das dependências realmente necessárias em runtime. É economia de conteúdo do pacote, não de RSS. |
| 2 | JS/CSS sem minificação — P01 | Experimento em cópias: entrada do renderer **10,55 → 5,92 MB (−43,9%)**; main **3,45 → 2,38 MB (−31%)**; host **3,33 → 2,13 MB (−35,9%)**. O ganho em abertura precisa ser medido; redução de bytes não implica redução proporcional de tempo. |
| 3 | Trabalho antecipado no startup — P04/P05/P07 | A janela espera reconciliação, provisionamento e persistência legada; a autenticação pode segurar o conteúdo por até **15 s** na primeira barreira configurada. Ganho possível: retirar do caminho crítico o tempo dessas tarefas. Não há uma medição que permita prometer um número em ms. Os 15 s são um timeout do código, não uma demora observada. |
| 4 | Isolates e serviços criados antecipadamente — P08/P09 | Pool de **8 workers de diff** no layout autenticado. Dois pares host + daemon quase ociosos somavam **247 MiB de RSS mediano**, além do par ocupado. Pool sob demanda pode evitar os oito workers antes do primeiro diff; serviços por demanda podem poupar parte desse RSS quando não houver consumidores. Não encerrar agentes ou automações para obter essa economia. |
| 5 | Trabalho visual e memória mantidos fora da tela — P10/P12/P13 | Throttling desabilitado em toda janela macOS; até **12 terminais estacionados**, com exceção que permite exceder o limite para TUIs. Possível redução significativa de CPU em background e memória de sessões grandes. Sem medição de repouso controlado ou teste de eviction, o ganho permanece hipótese. |

**Não somar todas as economias:** minificação e code splitting atuam parcialmente sobre os mesmos bytes. RSS soma páginas compartilhadas e não equivale à memória física exclusiva.

## 2. Método e linha de base

### 2.1 Ambiente e identidade do artefato

| Item | Evidência da auditoria original |
|---|---|
| Hardware | Apple M5, 10 CPUs lógicas/físicas reportadas, 16 GiB de RAM |
| Sistema | macOS 27.0, build 26A428, arm64 |
| Fonte | Commit acima, árvore Git limpa antes e depois da investigação original |
| App examinado | /Applications/Superset.app, versão 1.29.0, executando durante a auditoria |
| Electron do pacote | **41.10.3** |
| Node embarcado | **24.18.0** |
| Chromium embarcado | **146.0.7680.216** |
| V8 embarcado | **14.6.202.34-electron.0** |
| Bundler declarado | electron-vite 4.0.1, Vite 7.3.5; Rollup 4.62.3 fixado por override |
| Ferramenta do experimento | esbuild **0.27.7**, resolvido a partir da instalação local do Vite |
| UI | React/React DOM **19.2.3**, TanStack Router/Query/DB, Zustand, Tailwind **4.2.2**; Motion/Framer Motion **12.38.0** |
| Terminais | node-pty **1.2.0-beta.14**; xterm/headless **6.1.0-beta.302**; addon-webgl **0.20.0-beta.297**, com patches locais |
| Gerenciador | Repositório pede Bun **1.3.14**; máquina executava **1.4.2**. Node do shell: **24.15.0**, diferente do embarcado |

Fontes de versão: [package.json da raiz](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/package.json:22), [desktop](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/package.json:1), [override de dependências](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/package.json:82) e process.versions do executável instalado em modo Node.

O app instalado tinha a mesma versão declarada do checkout, mas não havia SHA de build comprovado. Foram comparadas fontes TS/TSX recuperadas de dois source maps principais com o checkout: **666 de 670 entradas comparáveis coincidiam textualmente**. As quatro diferenças incluíam catálogo inglês repetido e duas rotas; transformações de build também podem explicar diferenças. Isso ajuda a correlacionar o código, mas **não prova identidade integral do build**. Todas as medidas de pacote e processos abaixo são do instalado; recomendações apontam para o checkout auditado.

### 2.2 Tamanho medido

MiB = 1.048.576 bytes. A primeira tabela usa blocos alocados de du, exceto app.asar lógico; bundles usam bytes lógicos do índice ASAR.

| Componente | Tamanho |
|---|---:|
| Superset.app completo, em disco | **1.611,4 MiB / 1,57 GiB** |
| app.asar, tamanho lógico | **985,1 MiB** |
| app.asar.unpacked, em disco | **286,4 MiB** |
| Frameworks, em disco | **262,7 MiB** |
| Resources/resources, em disco | **75,4 MiB** |
| Índice do ASAR | **20,7 MiB**, aproximadamente 82.875 entradas de arquivo |
| Source maps no ASAR inteiro | **387,6 MiB**, 17.783 arquivos |
| Mapas de dist | **141,1 MiB** |
| Mapas de node_modules | **246,6 MiB** |

| Processo / grupo | JS total | CSS total | Source maps | Entrada principal |
|---|---:|---:|---:|---:|
| Main e entrypoints de filhos | 14,39 MiB, 44 arquivos incluindo chunks/templates | 0 | 24,79 MiB | index.js: **3,29 MiB** |
| Host service | incluído no grupo acima | 0 | incluído acima | host-service.js: **3,18 MiB** |
| Preload | **3,96 KiB**, um arquivo | 0 | 0 | index.js: 4.053 bytes |
| Renderer, todas as rotas/workers/gramáticas | **55,99 MiB**, 1.091 arquivos JS | **448,2 KiB** | **116,26 MiB** | index-NapqwWFl.js: **10,06 MiB** |
| CSS inicial | — | **394,4 KiB** | — | index-BZXKTUYx.css |

Os 55,99 MiB não são todos carregados na abertura. O HTML aponta diretamente para a entrada de 10,06 MiB e o CSS inicial; há imports dinâmicos e divisão de rotas. O main também carrega chunks compartilhados além de index.js.

Os anexos originais eram installed-asar-inventory.json, bundle-analysis.json e packaging-categories.json. Seus resultados estão transcritos aqui; os arquivos brutos não foram recuperados.

### 2.3 CPU e RSS por processo

Coleta passiva: **31 observações em 31,44 s**, durante a sessão em uso. CPU calculada pela diferença do tempo acumulado de CPU entre primeira e última observação, dividida pelo tempo monotônico. **100% significa um núcleo**. RSS é mediana das observações, não heap JS nem physical footprint.

| Processo | PID na coleta | RSS mediano (MiB) | CPU média |
|---|---:|---:|---:|
| Main | 89364 | 167,58 | 1,845% |
| Renderer | 89611 | 619,66 | 12,181% |
| GPU | 89371 | 113,00 | 8,651% |
| Network utility | 89375 | 57,00 | 0,413% |
| Host A | 90981 | 172,77 | 1,654% |
| Host B | 90968 | 72,56 | 0,000% |
| Host C | 90982 | 71,84 | 0,032% |
| PTY daemon A | 7690 | 67,16 | 0,350% |
| PTY daemon B | 20119 | 51,12 | 0,032% |
| PTY daemon C | 20159 | 51,45 | 0,000% |

Soma dos RSS medianos: **1.444,14 MiB**; totais simultâneos variaram entre **1.411,36 e 1.457,64 MiB**. CPU somada: **25,16% de um núcleo**, aproximadamente 2,52% da capacidade nominal dos dez núcleos. Esses totais excluem shells, CLIs de agentes e demais filhos externos.

Em **outra observação posterior na mesma auditoria**, foram encontrados seis shells zsh filhos diretos de um daemon, dois processos Codex (136,03 e 172,84 MiB RSS) e um Claude (214,67 MiB). Os outros dois daemons não tinham shells filhos diretos nessa observação. Isso descreve a carga encontrada, sem estabelecer um cenário controlado de seis terminais ou três agentes ativos durante toda a primeira amostra.

O sample do renderer, coletado separadamente por 5 s a cada 10 ms, reportou **physical footprint de 599,5M e pico de 1,0G**. A pilha nativa não dá atribuição confiável por componente React; símbolos V8/Chromium com offsets grandes não são uma prova de hotspot em uma função específica.

Os anexos originais eram runtime-sample.json, process-counts.json e renderer.sample.txt. No primeiro JSON, o campo started_at foi gravado ao final da coleta; duration_s e os timestamps monotônicos foram os dados usados no cálculo.

### 2.4 O que não foi medido

| Métrica | Situação e motivo |
|---|---|
| Cold start até aparecer a janela | **Não medido.** Só o instalado estava executando; o checkout não tinha dist nem instância dev correspondente. A sessão em uso não foi reiniciada |
| Warm start até interatividade | **Não medido.** Não havia CDP ativo identificado nem marcador de interatividade de produto. did-finish-load não comprova isso |
| Tempo real em require/import do main | **Não medido.** A avaliação dos módulos já havia acontecido; sample posterior não recupera seu custo. Executar index.js em modo Node também não reproduziria o main Electron |
| Repouso verdadeiro, minimizado e bateria | **Não medido.** Havia agentes e a própria auditoria em execução; foco, brilho, alimentação e carga de fundo não foram controlados |
| Matriz 0/1/4/8/16 terminais | **Não executada.** Abrir/encerrar terminais para padronizar a sessão mudaria a carga real observada |
| 60/120 fps, latência de digitação, long tasks | **Não medidos.** Precisam de trace do renderer e interação reproduzível |
| Vazamento em ciclo de abrir/fechar | **Não demonstrado.** Uma mediana, um pico de footprint ou um Map no código não comprovam leak |
| Primeiro lançamento após download | **Não medido.** O instalado era arm64 com assinatura **ad hoc**, sem TeamIdentifier e sem atributo quarantine; não representava uma distribuição notarizada recém-baixada |
| DMG/ZIP de distribuição | Não estavam entre os artefatos avaliados; os números acima são da árvore .app instalada |

Procedimentos concretos para preencher as lacunas estão na seção 7. Não foi inferido tempo de startup do tamanho do JS.

## 3. Mapeamento da arquitetura

### 3.1 Monorepo e processos

Monorepo Bun/Turborepo: apps/desktop é Electron; apps/web, api, admin, marketing e outras aplicações são superfícies/serviços separados; apps/mobile é Expo. O Electron não inicia toda a infraestrutura Next.js em produção. Os scripts dev da raiz podem iniciar API/web, portanto seus processos não devem entrar numa comparação de release.

Pacotes relevantes:

- packages/host-service: HTTP/tRPC via Hono, WebSockets, Git, arquivos, sessões e integração com serviços.
- packages/pty-daemon: dono persistente dos PTYs.
- packages/workspace-fs e packages/port-scanner: watchers/indexação e descoberta de portas.
- packages/local-db e banco próprio do host: SQLite/Drizzle.
- packages/panes: organização/estado de painéis.
- packages/chat-runtime e packages/chat-ui: runtimes e UI de chat; há integração real com o SDK Claude.
- packages/macos-process-metrics: módulo nativo para métricas do macOS.

Diagrama do caminho local auditado:

    BrowserWindow
    ├─ preload/index.js → contextBridge + trpc-electron
    └─ renderer React
       ├─ IPC/tRPC → Electron main
       ├─ HTTP/tRPC + WebSocket → host-service da organização
       ├─ Web Workers de diff/highlight
       └─ webviews → processos renderer adicionais conforme navegação

    Electron main
    ├─ janelas, menus, tray, autenticação, integração macOS, updater
    ├─ SQLite local e roteadores locais
    ├─ child_process.spawn → host-service por organização
    └─ caminho legado → terminal-host → pty-subprocess por terminal

    host-service
    ├─ Worker threads para Git/uso e outras tarefas
    ├─ sockets Unix → pty-daemon por organização
    ├─ processos git/gh/shell/CLIs
    └─ HTTP/WS → serviços remotos

    pty-daemon
    └─ node-pty → shells → CLIs de agentes e ferramentas

No caminho atual dos terminais auditado, output passa **PTY → daemon → socket Unix → host-service → WebSocket binário → xterm**. Não passa por um IPC Electron por chunk. O legado possui outro caminho e buffering próprio; não devem ser confundidos.

O host é lançado usando process.execPath em modo Node, com tratamento de spawn-helper no macOS: [coordinator:904](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/lib/host-service-coordinator.ts:904). A configuração de build lista sete entrypoints: [electron.vite.config.ts:127](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/electron.vite.config.ts:127). Workers Node são explícitos em [WorkerTaskRunner:257](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/workers/WorkerTaskRunner.ts:257). Não foi encontrado uso explícito de utilityProcess na aplicação; o NetworkService observado é um utility process do Chromium.

### 3.2 Inicialização até conteúdo utilizável

1. **Antes de app.whenReady:** imports estáticos do main avaliam seus módulos. O módulo local-db abre SQLite e roda migrações durante o import: [local-db:78](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/lib/local-db/index.ts:78). windows/main importa a árvore de roteadores. Há aplicação assíncrona do shell env, configuração de perfil dev, protocolos, handlers de quit e flags. O lock de instância só aparece em [main/index.ts:418](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/index.ts:418).
2. **app.whenReady, linha 454:** idioma persistido/sistema → catálogo i18n → registro de notificações/permissões → protocolos de ícones/fontes.
3. **Linhas 508–517:** diretório de ícones, dock, Sentry, app-state, persistência TanStack; disparo de limpeza de logs/perfis; await da extensão de navegador. React DevTools tem guarda de desenvolvimento.
4. **Linhas 520–539:** await da reconciliação do terminal legado, prewarm em background, await do browser bridge, download manager e configuração do coordinator.
5. **Linhas 561–609:** reconciliação dos hosts disparada sem await; provisionamento síncrono de hooks/skills/wrappers, sincronização de MCP e instalação do shim CLI.
6. **Linhas 619–625:** cria roteadores IPC/menu; makeAppSetup restaura janelas ou cria uma; configura updater e tray. O updater não é aguardado, mas sua primeira checagem pode coincidir com o renderer carregando.
7. **BrowserWindow:** show:false, backgroundColor, preload, sessão persistente e loadFile no build ou loadURL no dev. O evento **did-finish-load** chama show; **não há ready-to-show nesse caminho**. Restaurar várias janelas inicia o mesmo custo por renderer.
8. **Renderer:** importa a entrada e CSS, inicia Sentry de forma assíncrona, faz GC das chaves antigas/scrollback, cria Router e React root. [index.tsx:92](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/index.tsx:92) chama markBootMounted após agendar render, antes de comprovar commit/interatividade.
9. **Providers:** PostHog inicialmente retorna null; AuthProvider aguarda token e sessão/JWT, com timeout de 15 s; gate de notices e layout autenticado podem introduzir outros estados pendentes.
10. **Layout autenticado:** collections e hosts, assinaturas/eventos, pool de oito workers Pierre, restauração do workspace e montagem dos painéis. Um terminal ainda precisa runtime xterm, conexão WS, sessão e replay antes de mostrar conteúdo atual.

Referências centrais: [main:454](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/index.ts:454), [setup:11](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/lib/electron-app/factories/app/setup.ts:11), [janela:399](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/windows/main.ts:399), [show:539](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/windows/main.ts:539), [root providers](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/-layout.tsx:13).

## 4. Tabela de oportunidades

**M** = medição na auditoria de 24/09; **C/H** = mecanismo confirmado no código auditado, ganho de performance ainda hipótese. P/M/G = esforço pequeno/médio/grande. “Alto” indica prioridade potencial no cenário descrito, não ganho já demonstrado.

| ID | Área | Problema | Arquivo/linha | Impacto | Esforço | Risco | Evidência |
|---|---|---|---|---|---|---|---|
| P00 | Medição | Falta marcador de janela/interatividade e baseline repetível | [renderer:85](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/index.tsx:85), [janela:539](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/windows/main.ts:539) | Alto para priorizar | P | Baixo | C/H |
| P01 | Bundle | Minificação não habilitada; targets por fallback da ferramenta | [Vite:124](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/electron.vite.config.ts:124), [Vite:275](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/electron.vite.config.ts:275) | Alto | P | Médio | M + C |
| P02 | Pacote | 387,6 MiB de mapas distribuídos | [builder:84](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/electron-builder.ts:84), [Vite:125](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/electron.vite.config.ts:125), [Vite:276](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/electron.vite.config.ts:276) | Alto em disco | P | Baixo/médio | M |
| P03 | Pacote | Dependências já bundled, fontes e arquiteturas extras | [runtime-dependencies:14](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/runtime-dependencies.ts:14), [builder:84](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/electron-builder.ts:84), [desktop dependencies](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/package.json:41) | Alto em disco | M | Médio | M |
| P04 | Startup/main | Migrações no import e trabalho não visual antes da janela | [DB:78](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/lib/local-db/index.ts:78), [main:508](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/index.ts:508), [main:580](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/index.ts:580) | Alto | M | Alto | C/H |
| P05 | Startup/DB | Persistência SQLite aparentemente sem consumidor e VACUUM síncrono | [persistence:17](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/lib/persistence/persistence.ts:17), [main:512](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/index.ts:512) | Alto condicional | P/M | Médio | C/H |
| P06 | Renderer/bundle | Dependências pesadas e conteúdo de rota no bundle inicial | [automations:108](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/_dashboard/automations/page.tsx:108), [settings:2](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/settings/automations/page.tsx:2), [mermaid:1](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/ui/src/lib/mermaid.ts:1) | Alto | M | Médio | M + C/H |
| P07 | Startup/UI | Telemetria bloqueia árvore; sessão/JWT seguram conteúdo | [PostHogProvider:25](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/providers/PostHogProvider/PostHogProvider.tsx:25), [AuthProvider:28](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/providers/AuthProvider/AuthProvider.tsx:28) | Alto condicional | M | Alto na auth | C/H |
| P08 | Renderer/memória | Oito workers de diff iniciados no layout global | [layout:314](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/layout.tsx:314), [DiffThemeSync:16](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/components/DiffThemeSync/DiffThemeSync.tsx:16) | Alto | M | Médio | C/H |
| P09 | Processos | Hosts de todas as organizações iniciados juntos | [coordinator:600](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/lib/host-service-coordinator.ts:600), [app:155](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/app.ts:155) | Alto em multi-org | G | Alto | M + C/H |
| P10 | macOS/bateria | Throttling e backgrounding desabilitados amplamente | [janela:447](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/windows/main.ts:447), [setup:73](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/lib/electron-app/factories/app/setup.ts:73) | Alto em background | M/G | Alto | C/H |
| P11 | Polling/IPC | Fallbacks persistentes e queries por workspace | [host:167](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/providers/LocalHostServiceProvider/LocalHostServiceProvider.tsx:167), [workspaces:178](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/hooks/host-workspaces/useHostWorkspaces/useHostWorkspaces.ts:178), [status:204](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/providers/DashboardSidebarWorkspaceStatusProvider/DashboardSidebarWorkspaceStatusProvider.tsx:204) | Médio | M | Médio | C/H |
| P12 | Terminais/memória | Cap de 12 não limita TUIs em alternate screen | [cap:39](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/shared/src/settings-constraints.ts:39), [eviction:407](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/terminal-runtime-registry.ts:407) | Alto com muitos TUIs | G | Alto | C/H |
| P13 | Renderer/disco | Serialização síncrona de estado e snapshots | [collections:155](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/collections.ts:155), [buffer:116](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/terminal-runtime.ts:116) | Alto em perfis grandes | G | Alto | C/H |
| P14 | Terminais/transporte | Coalescing no xterm ocorre depois do custo por chunk de WS | [daemon:555](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/pty-daemon/src/Server/Server.ts:555), [host:1820](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/terminal/terminal.ts:1820), [coalescer:109](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/write-coalescer.ts:109) | Médio/alto em flood | M | Médio/alto | C/H |
| P15 | Terminais/GPU | Context loss mantém pane no renderer DOM | [addons:84](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/terminal-addons.ts:84) | Médio/alto condicional | M | Médio | C/H |
| P16 | Terminais/deps | Addons opcionais importados antecipadamente | [addons:1](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/terminal-addons.ts:1), [addons:45](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/terminal-addons.ts:45) | Baixo/médio | M | Médio | C/H |
| P17 | UI/listas | Sidebar expandida monta todas as linhas | [expanded:117](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarProjectSection/components/DashboardSidebarExpandedProjectContent/DashboardSidebarExpandedProjectContent.tsx:117) | Alto com centenas | G | Alto no DnD | C/H |
| P18 | UI/animação | Height animado e stagger crescem com a lista | [variants:3](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/utils/sidebarRevealVariants/sidebarRevealVariants.ts:3), [project:163](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarProjectSection/DashboardSidebarProjectSection.tsx:163) | Médio | P/M | Médio na UX | C/H |
| P19 | UI/estado | Subscrições ao store inteiro em componentes de diff | [FileDiffSection:96](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/screens/main/components/WorkspaceView/ChangesContent/components/FileDiffSection/FileDiffSection.tsx:96) | Médio, sobretudo legado | P | Baixo | C/H |
| P20 | Git/arquivos | Cache por baseBranch sem limite explícito por workspace | [GitStatusStore:30](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/trpc/router/git/utils/git-status-store/git-status-store.ts:30), [read:59](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/trpc/router/git/utils/git-status-store/git-status-store.ts:59) | Baixo/médio condicional | P/M | Médio | C/H |
| P21 | CPU em repouso | Scanner de portas acorda a cada 2,5 s; PTYs adotados têm timer individual | [port-manager:218](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/port-scanner/src/port-manager.ts:218), [Pty:523](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/pty-daemon/src/Pty/Pty.ts:523) | Baixo/médio em escala | M | Médio | C/H |
| P22 | IPC/memória | Registro de listeners não distingue canal ou registro repetido | [preload:27](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/preload/index.ts:27), [on/off:42](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/preload/index.ts:42) | Baixo, preventivo | P | Baixo | C/H, sem leak observado |

## 5. Detalhamento e validação proposta

### P00 — Tornar a abertura mensurável

**Evidência:** show ocorre em did-finish-load; markBootMounted é chamado logo após ReactRoot.render. São marcos diferentes de “primeiro workspace responde a input”. Não há medição do intervalo anterior à avaliação dos imports.

**Proposta:** registrar monotonicamente início do processo/entrypoint, fim dos imports de bootstrap, app ready, criação da janela, show, primeiro commit React, shell visível, workspace pronto e primeiro eco de terminal. O marcador do renderer deve ocorrer em efeito após commit e confirmar a interação de produto em um passo separado. Registrar apenas durações e identidade do build.

**Validação:** 10 warm launches e pelo menos 3 cold launches definidos como primeira abertura após reboot, sem apagar perfil. Reportar p50/p95 e dispersão; três cold launches servem como amostra exploratória, não p95 confiável. Medir profiling e lançamento normal separadamente.

### P01 — Habilitar minificação e explicitar targets

**Evidência:** a configuração não define build.minify. A versão local auditada do electron-vite define false para main/preload/renderer; exemplo no [default do renderer:528](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/node_modules/electron-vite/dist/chunks/lib-ClgyQuZx.js:528). Seu mapa de targets vai até Electron 38 e usa fallback para **node22.19/chrome140** no Electron 41. O runtime instalado era Node 24/Chrome 146. A documentação consultada na auditoria confirma a minificação desativada como padrão: [configuração electron-vite](https://electron-vite.org/config/).

**Experimento executado em 24/09:** esbuild.transform em cópias dos bundles, sem executar o resultado:

| Entrada | Antes, bytes | Depois, bytes | Redução |
|---|---:|---:|---:|
| Main | 3.447.237 | 2.379.599 | 31,0% |
| Host | 3.331.286 | 2.134.142 | 35,9% |
| Renderer inicial | 10.546.922 | 5.918.610 | 43,9% |
| CSS inicial | 403.900 | 327.851 | 18,8% |

Os alvos foram node24 e chrome146. O experimento mediu transformação/bytes, **não compatibilidade ou performance do bundle transformado**. O resultado original era minification.json; o script de repetição minify-bundles.cjs e as cópias usadas não foram recuperados.

**Proposta de configuração, ilustrativa:** manter as demais opções e acrescentar minify: "esbuild", com target: "node24" para main/preload e target: "chrome146" para renderer enquanto Electron 41 for a versão suportada. Revalidar nomes de classes/funções usados por bibliotecas antes de minificar main; se necessário, preservar nomes seletivamente. Gerar mapas privados para diagnóstico.

**Validação:** build completo com a versão Bun fixada; startup, workers, módulos nativos, chat, terminal e erros Sentry com simbolização correta. Comparar tempo de compile/evaluate de JS no trace, tamanho e cold/warm. Não adicionar polyfills: modulePreload.polyfill já é false na ferramenta auditada.

### P02 — Remover source maps do artefato distribuído

**Evidência:** 406.458.119 bytes de .map no ASAR. Os mapas de dist somam 147.907.965 bytes; outros 258.550.154 vêm de node_modules. O builder aceita dist/**/* e cópias amplas, sem exclusão geral de mapas.

**Proposta:** manter mapas no build/CI e upload autenticado para os dois projetos Sentry, mas excluí-los do pacote depois do upload. sourcemap: "hidden" sozinho apenas omite a referência no JS; ainda gera os arquivos e **não os remove do pacote**. Os IDs do Sentry devem corresponder exatamente aos bundles distribuídos, após minificação.

**Validação:** inventário ASAR não contém mapas; um erro intencional em build diagnóstico continua simbolicado em main, renderer e host. Comparar .app, DMG e update; não esperar que essa redução de disco apareça integralmente em RSS, pois mapas não são necessariamente carregados durante execução normal.

### P03 — Empacotar apenas o grafo necessário em runtime

**Evidência medida:** há 80,68 MiB de react-icons não-map, 47,69 MiB de emojibase-data, 22,90 MiB de prebuilds Windows de node-pty, 9,07 MiB de sqlite3.c e 7,05 MiB de tsbuildinfo. Também há testes e demos. copyWholeModule usa filtro **/*, e o pacote contém muito mais módulos que os explicitamente externalizados pelo main.

**Proposta:** definir um manifesto/grafo de runtime do aplicativo empacotado; excluir bibliotecas puramente de renderer já presentes no bundle, fontes de compilação, caches, testes e prebuilds de outras plataformas. Substituir cópias integrais de nativos por subárvores realmente usadas, com seus package.json, loaders e dependências transitivas. Auditar também resources de build duplicados.

O executável Claude arm64 de aproximadamente **221 MiB** não foi classificado como lixo: [createClaudeAdapter:1](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/chat-runtime/src/harness/claude/createClaudeAdapter/createClaudeAdapter.ts:1) usa o SDK. Removê-lo cegamente pode quebrar chat. O mesmo cuidado vale para loaders de bindings, detect-libc, keyring, watcher e spawn-helper.

**Validação:** instalação limpa, máquina sem node_modules do checkout no caminho de resolução, testes de spawn/upgrade/handoff, Git/watch, keychain e agentes suportados. Comparar inventários e testar tanto arm64 quanto x64 se ambos forem distribuídos. Preferir artefatos por arquitetura quando compatíveis com a política de distribuição; o app observado já é arm64 nativo.

### P04 — Encurtar o caminho crítico do main

**Evidência:** abertura/migração SQLite ocorre ao importar local-db; todos os routers são importados por windows/main; antes da criação da janela há awaits e provisionamento síncrono. [setupAgentIntegrations:39](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/agent-setup/src/index.ts:39) percorre configurações/wrappers usando fs síncrono; [shim:146](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/lib/bundled-cli.ts:146) apaga e recria o shim mesmo em lançamentos normais.

**Proposta:** bootstrap pequeno capaz de abrir uma janela com shell visual e diagnóstico; carregar handlers pesados sob demanda. Adiar provisionamento/reconciliações que não sejam requisito do primeiro conteúdo e usar escrita apenas quando o conteúdo mudou. Operações de banco e CPU realmente longas podem ir a worker ou processo já existente, com contrato explícito de prontidão. Transformar uma função em async sem mover seu trabalho síncrono não resolve bloqueio.

Preservar dependências reais: browser bridge precisa estar pronto antes de hosts que o usam; configuração de agentes precisa estar pronta antes do lançamento do agente; banco precisa migrar antes de consultas dependentes. O plano não consiste em remover awaits indiscriminadamente. A recomendação de manter o main responsivo é coerente com o [guia de performance do Electron](https://www.electronjs.org/docs/latest/tutorial/performance).

**Validação:** instrumentar cada fase, medir event-loop delay e abrir um workspace enquanto a manutenção está pendente. Conferir primeiro terminal, login, múltiplas janelas, migração de perfil antigo e erros recuperáveis.

### P05 — Revisar a persistência TanStack legada e seu VACUUM

**Evidência:** initTanstackDbPersistence abre tanstack-db.sqlite, configura busy_timeout=5000, faz wal_checkpoint(TRUNCATE) e, se freelist exceder 64 MiB, executa VACUUM síncrono. É chamada antes da janela. A busca em apps/packages encontrou exposição do serviço, mas nenhum consumidor createElectronSQLitePersistence; as collections auditadas usam localStorage.

O arquivo encontrado no perfil tinha **58.736.640 bytes**. Isso confirma sua existência, **não que VACUUM tenha rodado**: não foi consultado freelist nem executada migração. Com esse tamanho, não havia evidência de que o limiar de 64 MiB fosse atingido nessa instalação.

**Proposta:** confirmar o inventário de consumidores externos/legados e retirar a inicialização se o serviço estiver aposentado. Se ainda necessário, abrir quando solicitado e fazer compactação fora do caminho crítico, com exclusão mútua e limites. Preservar os dados existentes até definir sua política de migração/retensão.

**Validação:** perfil atualizado e antigo, contagem de IPCs desse serviço, startup com banco compacto e banco fragmentado. Verificar ausência de corrupção e de disputa com outros processos.

### P06 — Fazer o code splitting alcançar as dependências pesadas

**Evidência:** autoCodeSplitting já está habilitado, mas a entrada inicial continua grande. Pela atribuição aproximada de caracteres gerados usando mappings do source map, a entrada contém aproximadamente:

- PostHog: **742 mil caracteres**; aparecem tanto module.full.no-external quanto module.js.
- Mermaid: **724 mil**.
- Extensão Emoji do Tiptap: **647 mil**.
- TanStack DB: **459 mil**.
- highlight.js: **315 mil**, além de Tiptap/ProseMirror, parse5 e outros.

Essa atribuição mede trechos no arquivo gerado e é aproximada por colunas do source map; não foi usado o tamanho integral de sourcesContent como “bytes retidos”. Por exemplo, os ícones totalizam aproximadamente 165 mil caracteres retidos, apesar das fontes completas de ícones serem muito maiores.

A rota antiga de automações exporta AutomationsPageContent, importada pela rota Settings. Seu código aparece no bundle inicial apesar do redirect da rota antiga. Isso é um ponto concreto para separar conteúdo compartilhado do módulo de declaração de rota. A atribuição completa constava no anexo bundle-attribution.json.

**Proposta:** extrair componentes compartilhados de módulos de rota, carregá-los pela rota real, lazy-load de editores/modais não abertos, Mermaid somente em conteúdo que contenha diagramas e datasets de emoji somente quando necessários. Investigar uma única variante de import PostHog; dois módulos retidos não provam dois clientes inicializados. Evitar transformar tudo em centenas de pequenos chunks, que também custam I/O e avaliação.

**Validação:** comparar grafo de imports inicial e cobertura de JS na abertura, login e workspace de terminal. Garantir prefetch por intenção para não transferir toda a demora ao primeiro clique. Testar diagramas, paste, autocomplete e formulários.

### P07 — Separar shell interativo de telemetria e rede de autenticação

**Evidência:** PostHogProvider retorna null até seu primeiro efeito. AuthProvider faz refetchSession e depois authClient.token antes de liberar children, com Promise.race de 15 s. O layout autenticado possui outro timeout de sessão. Uma janela visível pode estar apenas exibindo splash.

**Proposta:** montar o shell visual sem depender da inicialização de telemetria. Para auth, permitir navegação/estados locais compatíveis com a política offline existente e renovar JWT de forma independente onde for seguro. Não usar cache para autorizar dados de outra organização, nem expor conteúdo autenticado antes das verificações necessárias. Essa é uma decisão de produto/contrato que requer aprovação na implementação.

**Validação:** online, offline, token expirado, troca de conta, servidor lento e falha parcial de JWT. Medir “shell responde” e “conteúdo autenticado pronto” como métricas distintas.

### P08 — Pool de diff sob demanda e proporcional ao uso

**Evidência:** o layout global configura poolSize:8. Na dependência instalada auditada, [WorkerPoolManager:56](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/node_modules/@pierre/diffs/dist/worker/WorkerPoolManager.js:56) agenda inicialização no construtor; [initializeWorkers:295](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/node_modules/@pierre/diffs/dist/worker/WorkerPoolManager.js:295) cria todos os workers. DiffThemeSync ainda chama setRenderOptions, que também garante inicialização. Não é apenas capacidade máxima de um pool preguiçoso.

**Proposta:** ativar o provider/pool ao primeiro uso de diff, começar com 1–2 workers e crescer com a fila até um teto baseado em hardware e carga. Avaliar descarte após inatividade. O singleton atual é por renderer: oito workers não são necessariamente oito processos no ps.

**Ganho estimável:** evitar a inicialização de oito isolates antes do primeiro diff; economia de MiB ainda não medida. Os caches AST e highlighters também contribuem, então contar workers sozinho não mede memória.

**Validação:** contar Worker targets no CDP, heap/footprint antes/depois do primeiro diff e após inatividade; comparar um diff e 20 diffs, tema claro/escuro e p95 do primeiro conteúdo.

### P09 — Controlar o custo fixo por organização

**Evidência:** reconcile inicia todos os IDs de organizações autorizadas com Promise.all. Cada host cria DB, serviços, observadores e runtimes. Na amostra havia três hosts e três daemons; dois pares tinham CPU próxima de zero, mas aproximadamente 247 MiB de RSS agregado.

**Proposta:** manter serviços por necessidade explícita: janelas, terminais vivos, automações, conexões de CLI/remotas e jobs pendentes. Iniciar primeiro o host da janela atual, limitar concorrência de boots e considerar suspensão apenas quando a ausência de consumidores estiver comprovada. Não confundir organização “fora da tela” com organização sem trabalho.

**Validação:** 1/3/10 organizações, presença/ausência de terminais e automações; reinício da UI sem perda de PTY, acesso CLI, evento remoto e uso offline. Ganho de 247 MiB é o tamanho observado dos pares pouco ocupados, não uma promessa de que ambos possam ser desligados.

### P10 — Política explícita para foco, oclusão, bateria e atividade de agentes

**Evidência:** setBackgroundThrottling(false) vale para toda janela macOS; disable-backgrounding-occluded-windows é global. Há justificativa de correção de corrupção visual no código. Não foi encontrada integração com powerMonitor no escopo examinado.

O Electron documenta que desabilitar backgroundThrottling altera também a visibilidade e pode manter frames da janela: [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window). Isso aumenta a necessidade de pausar trabalho de UI explicitamente; document.hidden pode não fornecer o sinal esperado. React Query já tem integração de focus/blur, que deve ser preservada.

**Proposta:** primeiro propagar estado explícito de visibilidade/oclusão e reduzir timers e animações decorativas, preservando trabalho dos agentes no host. Investigar a necessidade atual do workaround em uma matriz de OS/GPU/Electron e, se comprovado seguro, restringi-lo ao cenário afetado. Usar suspend/resume e estado de energia para escalonar trabalho não urgente: [powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor).

**Validação:** foreground, janela atrás de outra, minimizada, display apagado e sleep/wake, com e sem PTY produzindo output. Medir CPU, wakeups e energia por 5–10 min; verificar perda de frame, terminal em branco, screenshots de webview e reconnect.

### P11 — Reduzir polling de recuperação sem perder convergência

**Evidência:** LocalHostServiceProvider consulta conexão a cada 5 s mesmo tendo onStatusChange; enquanto desconectado, status a cada 1 s. Listas de workspaces/projetos mantêm fallback em background. O provider de status usa uma query por workspace, ainda que já centralize assinaturas e notificações por linha.

**Proposta:** fallback adaptativo ao estado do canal: cadência lenta quando WS está saudável e imediata em foco/reconnect. Agregar leitura inicial dos bindings por host com limite/paginação quando houver muitos workspaces. Deduplicação do React Query já existe para chaves iguais; contar consumidores não equivale a contar requests.

Nem todo polling deve parar: SandboxAccessProvider renova tokens/keepalive e pode manter um workspace acordado. A semântica precisa ser mantida. Oportunidade é reduzir verificações redundantes, não suspender obrigações de sessão.

**Validação:** contar IPC/HTTP por minuto em 1/100/1.000 workspaces, com dois renderers; derrubar/restaurar WS e verificar convergência, status de subagentes expirados e mudanças feitas pelo CLI.

### P12 — Orçamento real para terminais estacionados

**Evidência:** padrão de 5.000 linhas de scrollback e cap de 12 runtimes estacionados. selectRuntimesToEvict isenta alternate-screen; assim, 30 TUIs estacionados podem conservar 30 runtimes. Falha de persistência também impede eviction. O limite Chromium de contextos foi elevado para 256; ele evita evictions automáticas precoces, mas não é um orçamento de memória.

Já existe fechamento de WS no park para peers compatíveis, rAF coalescing e LRU. Não se propõe implementar novamente esses mecanismos. O comentário “55–70 MB por runtime” é informação histórica do código, **não uma medição desta auditoria**.

**Proposta:** orçamento por memória estimada/contextos e não só contagem. Para TUIs, começar por liberar somente recursos gráficos de panes ocultos, conservando o estado necessário; eviction completa exige recuperação fiel de alternate screen, dimensões e sequência. Considerar cap adaptado à máquina depois de medir o custo marginal real.

**Validação:** 1/4/8/16/32 terminais normais e TUIs, switches repetidos, resize, quota localStorage esgotada, captura de sequência/replay e estado visual. Não reduzir scrollback ou descartar conteúdo silenciosamente.

### P13 — Tirar gravações volumosas do caminho de interação

**Evidência:** collections por organização persistem estado de workspaces em localStorage. A dependência TanStack serializa o objeto da collection inteira antes de setItem. Ao estacionar um terminal, serializeAddon e localStorage.setItem ocorrem sincronicamente, antes de completar o detach. Isso compete com o orçamento de 16,67 ms/8,33 ms.

**Proposta:** migrar estado por entidade e snapshots volumosos para armazenamento assíncrono com escrita incremental, conforme a orientação do AGENTS.md desktop. Para scrollback, preservar atomicidade entre snapshot e seq anchor, e só desalocar runtime quando o commit estiver confirmado. Transações, batching e debounce precisam preservar a última alteração no fechamento; não basta trocar localStorage por uma Promise em torno do mesmo trabalho.

**Validação:** perfil pequeno e grande, 8 terminais saindo simultaneamente, quota pressionada, crash durante escrita, janela fechada, troca de organização e sincronização entre janelas. Medir duração de serialização e escrita separadamente.

### P14 — Coalescer output antes de atravessar o WebSocket

**Evidência:** cada onData do daemon envia um frame ao assinante; o host pode emitir um WS binário por chunk entregue. Só depois disso o renderer coalesce xterm.write por frame. As filas já possuem backpressure e limites: 8 MiB no WS/coalescer e buffering de replay.

**Proposta:** experimentar buffering por sessão no host/daemon, curto e limitado por bytes, preservando ordem dos controles. Começar com janelas de 2–4 ms e teto de bytes, e fazer flush imediato em input/exit/resize conforme o contrato. Comparar com o comportamento atual antes de escolher cadência: impor 16 ms pode prejudicar interação a 120 Hz.

MessagePort não é substituição automática aqui: o mesmo transporte atende host remoto. Só considerar um caminho local adicional se o perfil mostrar que serialização/transporte domina e o custo de manter dois caminhos for justificado.

**Validação:** harness de flood existente, eco do terminal vizinho, p50/p95 de input, frames/s, bytes/s, CPU de daemon/host/renderer, UTF-8 dividido, escapes, Sixel, alt screen, close e replay. Coalescing reduz envelopes/callbacks; não elimina bytes que o agente realmente produziu.

### P15 — Recuperar WebGL após perda transitória do contexto

**Evidência:** o callback de onContextLoss dispõe o addon, zera a referência e faz refresh. Não há nova tentativa de WebGL nesse runtime. Um pane ativo pode permanecer em DOM até recriação, embora novas montagens tentem WebGL normalmente.

**Proposta:** reativação com backoff, limite de tentativas e condição de pane visível, preservando fallback DOM. Integrar com orçamento de P12 para não gerar disputa incessante por contextos. O atlas já é limpo após 32 novas páginas; não atribuir crescimento ilimitado de atlas ao código auditado.

**Validação:** perda de contexto induzida em ambiente diagnóstico, GPU restart e muitas abas. Comparar CPU/fps antes/perda/recuperação, sem terminal em branco ou loop de reconstrução.

### P16 — Carregar addons opcionais por necessidade

**Evidência:** ImageAddon, SearchAddon e LigaturesAddon são imports estáticos; ImageAddon é instalado em cada runtime, e ligaturas são condicionalmente instanciadas. A importação antecipada ainda pode trazer código/dados mesmo quando a função não é usada.

**Proposta:** separar chunks de recursos opcionais, carregar busca ao abrir a busca e ligaturas quando habilitadas. Para imagens, qualquer ativação tardia precisa interceptar o protocolo antes de perder os primeiros bytes; pode ser mais seguro manter o parser mínimo e adiar decodificação pesada. Não é um quick win se sacrificar compatibilidade.

**Validação:** custo de criação de 16 terminais, retenção de heap, primeiro uso de busca/ligatura/imagem e fidelidade de clipboard. Ganho ainda não quantificado.

### P17 — Virtualizar a sidebar expandida

**Evidência:** flatItems.map monta todas as linhas/headers dentro de SortableContext. Há memoização e status por useSyncExternalStore, mas essas proteções não limitam DOM ou custo de layout ao viewport.

**Proposta:** lista virtual de linhas achatadas, com overscan e modelo explícito para grupos/pinned/seleção. Manter drop targets e coordenadas de drag para itens fora do viewport; considerar ativar virtualização só acima de um limiar para limitar risco.

**Validação:** 100/500/1.000 workspaces, busca, teclado, seleção múltipla, dragging entre grupos, autoscroll e áreas vazias. Medir DOM nodes, commits, Layout/Paint e quadros longos. Um arraste em lista pequena não valida essa mudança.

### P18 — Limitar coreografia de listas e animação de layout

**Evidência:** as listas animam height entre 0 e auto e aplicam staggerChildren de 30 ms para abrir e 18 ms para fechar. Para 100 filhos, apenas o atraso até o último começar pode chegar a **2,97 s** na abertura, se todos participarem. É consequência da configuração, não duração medida. Animar height também relayouta os irmãos.

**Proposta:** limitar o atraso total, animar apenas linhas próximas do viewport e preferir transform/opacity onde preservarem o resultado. Quando expandir realmente muda o layout, limitar a região e a quantidade de itens animados. Há suporte a Reduce Motion em SidebarRevealList; conferir também o motion.div externo do projeto.

**Validação:** lista extensa em 60/120 Hz, expansão durante stream e drag, Reduce Motion ligado. Medir Layout e duração total percebida. Não forçar translateZ/will-change em todas as linhas: pode trocar custo de layout por excesso de camadas.

### P19 — Seletores de estado focalizados

**Evidência:** FileDiffSection desestrutura duas propriedades de useChangesStore() sem selector, assinando o estado inteiro. Existem ocorrências semelhantes em InfiniteScrollView e ChangesView. Muitas estão na superfície legada, então sua prioridade depende de uso real.

**Proposta:** selecionar os valores necessários com referências estáveis/useShallow quando adequado; separar mutações voláteis de preferência visual. A sidebar nova já assina status por workspace — esse padrão é uma referência interna, não uma lacuna geral de memoização.

**Validação:** React Profiler e contadores de render antes/depois durante mudança de arquivo ativo, scroll e toggles. Conferir que mudanças relevantes continuam atualizando a UI; não adicionar memo em massa.

### P20 — Limitar variantes de cache Git em sessões longas

**Evidência:** GitStatusStore mantém um Map por workspace e outro por baseBranch, criando uma entrada por branch consultada. drop remove o workspace inteiro; não há LRU/limite explícito de variantes enquanto ele segue observado. Snapshots grandes podem ser retidos quando o usuário explora muitas bases.

**Proposta:** LRU por workspace ou retenção apenas das bases com consumidores, preservando a cache comum do status e sua atualização parcial. É uma oportunidade condicional de memória, não prova de vazamento.

**Validação:** alternar 50 bases num repo grande, medir heap retido e comandos Git por troca, comparar correção após checkout, alterações parciais e erro de watcher. O código já faz cache, atualização parcial, serialização por variante e remoção quando o watcher perde interesse.

### P21 — Coordenar timers de manutenção

**Evidência:** PortManager acorda a cada 2,5 s enquanto há sessões, mesmo quando a seleção interna reduz scans ociosos para 30 s. Atividade é inferida de output, portanto um agente escrevendo muito pode manter scans frequentes mesmo sem publicar servidor. PTYs adotados usam um setInterval de 1 s cada para liveness.

**Proposta:** agendar a próxima manutenção pelo deadline mais próximo, em vez de acordar para descobrir que não há trabalho; compartilhar o sweep de liveness dos adotados. Manter varredura periódica limitada para servidores silenciosos e proteção contra PID reutilizado. Não transformar apenas unref em “economia”: unref permite saída do processo, mas não cancela callbacks.

**Validação:** 0/1/32/100 sessões, agente falante sem servidor, servidor sem output, daemon após handoff, PID encerrado/reutilizado; medir wakeups, número de ps/lsof e atraso de detecção. Já existem scans em lote, exclusão de sobreposição e decay por ociosidade.

### P22 — Endurecer a remoção de listeners do bridge

**Evidência:** listenerMap é WeakMap<listener, wrappedListener>. Se o mesmo callback for registrado duas vezes ou em dois canais, a segunda entrada substitui a primeira, mas o ipcRenderer continua retendo ambos os wrappers. off não consegue recuperar todos. Não foi encontrada evidência de que esse padrão estivesse causando leak na sessão auditada.

**Proposta:** gerenciar registros por canal/callback ou retornar disposer para cada inscrição, mantendo compatibilidade dos consumidores. É uma correção preventiva pequena, de prioridade abaixo dos custos medidos.

**Validação:** inscrições repetidas, dois canais, mount/unmount e hot reload; comparar quantidade de listeners e retained objects antes/depois.

## 6. Áreas verificadas e proteções já existentes

### Main, IPC e processos

- Não foi encontrado sendSync no código próprio examinado de main/preload/renderer; o bridge expõe invoke e send assíncronos. Isso não é uma auditoria de cada dependência interna do Electron.
- Git pesado já usa worker threads, com coalescing/cancelamento e reap após 30 s ocioso. O teto do host é min(4, CPUs−1)+2: [host-worker-pool:27](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/workers/host-worker-pool.ts:27). Não se recomenda transferir novamente tudo para utilityProcess apenas por existir essa API.
- O fallback do pool pode executar inline quando o bundle falta ou workers falham: [host-worker-pool:171](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/workers/host-worker-pool.ts:171). Monitorar essa condição em validação de pacote; um host funcionando não comprova que esteja usando workers.
- Patches Git têm teto de 32 MiB e coleta limitada: [diff-patch:31](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/trpc/router/git/utils/diff-patch.ts:31). O pool avisa para resultados grandes, mas aviso não elimina cópias/serialização. Medir tamanho das respostas e parse/clone em traces de diffs grandes antes de desenhar paginação/MessagePort.
- Hosts possuem watchdog e shutdown; o reaper de terminais roda a cada 5 min, sem execução sobreposta: [reaper:14](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/terminal/reaper/reaper.ts:14), [reaper:366](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/terminal/reaper/reaper.ts:366). Daemons que sobrevivem ao fechamento fazem parte da persistência; não são automaticamente órfãos.

### Terminais

- xterm usa WebGL; em falha, o fallback auditado é **DOM**, não canvas.
- Coalescer usa rAF e callback de conclusão do parser, fila limitada e aviso de descarte. Há backpressure no daemon/WS e replay limitado. A proposta P14 é complementar.
- Runtimes estacionados têm LRU e sockets são fechados quando o peer permite retomada por sequência; o código conserva compatibilidade com peers antigos. [park:942](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/terminal-ws-transport.ts:942).
- O container de parking é offscreen/inert, com cleanup; sua existência não prova renderizações contínuas nem vazamento. [parking:14](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/lib/terminal/terminal-parking.ts:14).

### Git, arquivos e watchers

- Usa **@parcel/watcher** para worktrees e node:fs.watch recursivo para gitDir. A implementação instalada auditada escolhe FSEvents por padrão no macOS: [Backend.cc:31](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/node_modules/@parcel/watcher/src/Backend.cc:31). Não foram contados streams FSEvents ativos em runtime.
- Watchers de worktree são multiplexados por caminho. GitWatcher registra interesse por workspace e libera recursos quando o refcount chega a zero: [GitWatcher:305](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/events/git-watcher.ts:305).
- Há debounce de 75 ms no watcher, lotes de 500, intervalo de 200 ms e teto de 30.000 eventos no throttler; recuperação de overflow com backoff de 5–60 s e limite de 10.000 paths de arquivos: [watch:33](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/workspace-fs/src/watch.ts:33).
- .git é excluído do watcher geral; há descoberta de diretórios totalmente gitignored e repositórios aninhados. Para Git, diretórios de build/vendor com **arquivos tracked** não são simplesmente ignorados. Excluir node_modules indiscriminadamente poderia esconder alterações válidas nesse caso: [watch:314](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/workspace-fs/src/watch.ts:314).
- O manager de PR não força interesse em todos os workspaces. Faz sweep/refresh de 5 min e aproveita eventos de watchers com consumidores: [pull-requests:303](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/packages/host-service/src/runtime/pull-requests/pull-requests.ts:303). Não foi encontrado fundamento para afirmar “Git roda sem cache a cada segundo”.
- Cadastros/memória de diretórios no watcher, bursts de ignores e número total de raízes ainda merecem medição no protocolo de escala; limites teóricos não foram classificados como vazamentos comprovados.

### Renderer, assets e memória

- Tailwind é compilado; não foi encontrado uso próprio de Emotion/styled-components no escopo pesquisado. Framer/Motion atualiza estilos em runtime, o que não significa que todo CSS use CSS-in-JS.
- Fontes SF Mono são lidas do sistema por protocolo próprio, com font-display:swap: [bundled-fonts.css:10](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/styles/bundled-fonts.css:10). Não há motivo para propor baixar fontes remotas na abertura.
- Rotas já têm splitting automático. A recomendação é ajustar limites reais de chunks, não “adicionar lazy routing” genericamente.
- React Query sincroniza focus/blur e persiste um conjunto permitido de queries em IndexedDB: [ElectronTRPCProvider:25](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/providers/ElectronTRPCProvider/ElectronTRPCProvider.tsx:25), [persister:74](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/renderer/providers/ElectronTRPCProvider/ElectronTRPCProvider.tsx:74). Isso é diferente das collections de layout/terminal em localStorage de P13.
- O monitor de recursos monta o conteúdo com coleta quando o popover está aberto; não foi classificado como polling permanente só porque o hook tem open:true.
- Não há demonstração de leak por listeners/timers de produção além da fragilidade condicional P22. Para concluir leak, exigir crescimento retido após ciclos equivalentes e GC, não apenas aumento de RSS durante atividade.

### Integração macOS e flags

A janela usa titleBarStyle:hidden, frame:false, trafficLightPosition:{x:16,y:16}, backgroundColor, acceptFirstMouse e sessão persistente. Não há vibrancy configurado nessa janela principal. Não existe evidência de que a posição dos traffic lights seja um gargalo; preserve a interação nativa.

Há menu nativo, persistência/restauração de janelas, aplicação viva após fechar a última janela e reentrada via activate/Dock: [setup:31](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/lib/electron-app/factories/app/setup.ts:31), [window state:315](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/windows/main.ts:315). Reabrir pelo Dock quando o processo já existe é um cenário distinto de warm launch após encerrar o processo.

show:false e backgroundColor já evitam parte do flash. Avaliar ready-to-show ou um shell visível mais cedo em P04/P00; ready-to-show indica primeiro frame, **não disponibilidade de dados ou autenticação**. Esperar menos para mostrar uma tela vazia não basta para obter interatividade.

Flags encontradas: force-color-profile=srgb; disable-backgrounding-occluded-windows no Mac; max-active-webgl-contexts=256; disk-cache-size de 1 GiB. A última é um **limite de cache em disco**, não alocação imediata de 1 GiB de RAM: [main:391](/Users/luizsantos/.superset/worktrees/c5e5b895-0baf-465d-bf9e-c68286d2f714/mulher-afogada/apps/desktop/src/main/index.ts:391). Aceleração de hardware é desativada apenas no Linux no código de setup auditado.

Não há proposta de usar --no-sandbox, desabilitar GPU no Mac ou elevar o heap V8 como correção genérica. Essas alterações podem reduzir isolamento, trocar trabalho para CPU ou esconder retenção. Flags experimentais só entram após experimento focalizado; ver [switches suportados pelo Electron](https://www.electronjs.org/docs/latest/api/command-line-switches).

**V8 snapshots/code cache:** não foi encontrado custom snapshot, enableCompileCache ou v8CacheOptions configurados. Isso não significa ausência do snapshot interno de V8 ou do cache padrão de Chromium. Após P01/P04/P06 e perfil de compile/evaluate, avaliar cache de código compatível com Electron/arquitetura e um snapshot apenas de módulos puros. APIs Electron, fs, handles e dados de usuário não podem virar estado pré-inicializado estático. O benefício de warm start e o custo de manter artefatos por runtime precisam justificar essa mudança; ela não é quick win demonstrado.

**Binários/release:** executável e os cinco nativos principais inspecionados eram arm64. Havia prebuilds de outras plataformas no pacote, mas não evidência de Rosetta em execução. builder configura hardenedRuntime e notarize:true; a instalação observada tinha assinatura ad hoc. Medir a primeira abertura de release assinado/notarizado separadamente, sem atribuir eventuais atrasos do Gatekeeper ao React. Nenhuma alteração de assinatura foi realizada.

## 7. Protocolo para completar e repetir as medições

Os procedimentos abaixo são propostas preservadas da auditoria, não comandos executados durante a reconstrução deste arquivo. Conferir caminhos, flags e versões antes de uma nova rodada.

### 7.1 Preparação e cenários

Usar release do **mesmo SHA**, com versões de ferramenta registradas e dados representativos. Profiling em dev é útil para diagnóstico, mas HMR, source maps, API local, DevTools e dependências de desenvolvimento distorcem a comparação com release.

Fixar máquina, monitor/refresh rate, escala, dimensões da janela, brilho, alimentação, tema, versão de macOS/Electron e serviços externos. Anotar temperatura/pressão de memória. Guardar baseline antes de cada mudança; fazer um item por vez quando possível.

| Cenário | Conteúdo | Janela | Duração sugerida |
|---|---|---|---|
| R0 | App autenticado, sem output/jobs relevantes | Visível | 5 min depois da estabilização |
| R1 | Mesmo perfil | Encoberta, depois minimizada | 5 min por estado |
| R2 | 1/4/8/16 terminais, shells ociosos | Um workspace visível | 2 min por nível |
| R3 | Mesmo número, um produtor de output fixo | Um terminal visível, demais parked | 2 min |
| R4 | TUIs alternate-screen, mesmo histórico | Trocas de workspace | 50 ciclos |
| R5 | 100/500/1.000 workspaces | Sidebar expandida | Scroll/drag/expansão repetidos |
| R6 | 1/3/10 organizações | Mesma UI ativa | 5 min |
| R7 | Agentes em atividade real | Visível/background | Trabalho idêntico; contabilizar CLIs separadamente |

“App perto de 0%” aplica-se ao repouso definido em R0/R1; não à execução dos modelos, builds ou output contínuo de agentes.

### 7.2 CPU, memória e energia

O coletor original measure_runtime.py filtrava o app em /Applications/Superset.app e amostrava, a cada segundo, a saída de:

    ps -axo pid=,ppid=,rss=,time=,command=

Seu método pode ser refeito sem modificar o aplicativo: selecionar os processos pertencentes ao executável, salvar timestamps monotônicos e calcular, por PID:

    CPU (%) = 100 × delta(tempo de CPU acumulado) / delta(tempo monotônico)
    RSS (MiB) = RSS reportado em KiB / 1024

Usar pelo menos 300 segundos nos cenários de repouso, preservando amostras individuais e reportando mediana e dispersão. Ajustar o filtro se o build estiver em outro caminho. Rodar novamente minimizado e com os níveis de terminais; não mudar configuração durante cada amostra. O script temporário original não acompanha este arquivo restaurado.

Complementar RSS com Activity Monitor/footprint por PID; ps não dá memória exclusiva, VRAM ou heap por Worker. No Instruments, usar Time Profiler e métricas de energia/wakeups disponíveis para a versão do Xcode. Medir app e CLIs separadamente e guardar processos com PPID=1 que pertencem aos daemons persistentes. Evitar somar “app agregado” e filhos outra vez.

### 7.3 Cold/warm start e imports

1. Preparar uma sessão de medição que possa ser fechada; encerrar normalmente o app. Não matar a sessão de trabalho para padronizar carga.
2. Medir “lançar processo → janela mostrada”, “→ shell responde” e “→ workspace/terminal utilizável”, usando os marcadores P00. O instante do launcher deve ser monotônico; performance.timeOrigin por processo precisa ser alinhado antes de cruzar relógios.
3. Cold: primeira abertura após reboot, perfil já preparado. Warm: novas aberturas após encerramento normal, mantendo caches. Relatar primeira instalação/quarantine como cenário separado.
4. Para perfil de imports, iniciar uma execução **diagnóstica**, sem usar seu tempo com pausa do debugger como baseline de startup:

    /Applications/Superset.app/Contents/MacOS/Superset \
      --inspect-brk=127.0.0.1:19229 \
      --remote-debugging-port=19322

5. Conectar Chrome DevTools ao main via 19229, iniciar CPU Profiler antes de continuar, e salvar o perfil após o workspace aparecer. A depuração do main é suportada pelo Electron: [procedimento oficial](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process).
6. Uma instrumentação temporária de Module._load, instalada antes do entrypoint, pode registrar duração inclusiva/self de require; excluir cache hits, não somar tempos inclusivos aninhados, e combinar com source maps. Num bundle Rollup, muitos módulos já viraram um arquivo: CPU profile de avaliação do bundle é mais informativo que contar chamadas require. Para imports ESM, medir avaliação com profiler/marcos, não presumir que o hook CJS os capture.
7. Se for necessário instrumentar antes de app.whenReady, usar loader diagnóstico isolado ou inspector break-on-start. contentTracing só deve ser iniciado após ready e, sozinho, não cobre os imports que já aconteceram: [contentTracing](https://www.electronjs.org/docs/latest/api/content-tracing).

As portas são exemplos para uma sessão controlada; verificar que estão livres e que o PID/caminho/URL correspondem ao build em análise. Não misturar a instância instalada e uma instância de outro worktree.

### 7.4 Fluidez, React e transporte

No renderer correspondente, gravar Performance/Memory via DevTools/CDP: scripting, style/layout, paint, frames, long tasks, DOM nodes, heap e Worker targets. Fazer ações reais: abrir o seletor, digitar, trocar workspace, redimensionar terminal, scroll em diff e drag na sidebar. React Profiler exige build de profiling apropriado; seu overhead deve ser declarado.

Separar orçamento: **16,67 ms/frame em 60 Hz; 8,33 ms/frame em 120 Hz**. Reportar p50/p95/p99 de frame/latência e percentual de frames perdidos; média de fps sozinha pode esconder travadas. Long tasks acima de 50 ms não capturam toda falha a 120 Hz.

O repositório auditado já possuía um harness para saturar um PTY e medir o vizinho. Depois de iniciar a **instância dev deste checkout** com CDP e conferir os valores reais de .env:

    RENDERER_REMOTE_DEBUG_PORT=19322 bun --env-file=.env \
      apps/desktop/scripts/cdp-terminal-flood-profile.ts \
      --samples 120 --interval-ms 150 \
      --out-dir /tmp/superset-terminal-profile

Esse script cria/usa PTYs de diagnóstico, mede eco/health e coleta recursos. Não foi executado na auditoria original porque não havia instância correspondente. Não incluir --repair-local-auth em ambiente remoto/produção; o script documenta essa opção apenas para auth local. O harness não substitui um trace da renderização real do xterm.

Para leaks: guardar heap antes, fazer 50 ciclos de criar/fechar panes e trocar workspaces, aguardar tarefas pendentes e comparar retained size/objetos depois de GC diagnóstico. Verificar DOM desconectado, WebGL contexts, listeners, filas, sockets e processos. Uma subida que se estabiliza pode ser cache; crescimento retido por ciclo merece investigação.

### 7.5 Pacote e módulos nativos

Para repetir o inventário:

    du -sk /Applications/Superset.app \
      /Applications/Superset.app/Contents/Resources/app.asar \
      /Applications/Superset.app/Contents/Resources/app.asar.unpacked
    file /Applications/Superset.app/Contents/MacOS/Superset
    codesign -dv --verbose=4 /Applications/Superset.app
    ELECTRON_RUN_AS_NODE=1 /Applications/Superset.app/Contents/MacOS/Superset \
      -p 'JSON.stringify({arch:process.arch,versions:process.versions})'

Comparar também tamanho comprimido de DMG/ZIP e delta do updater. Guardar lista de módulos externos e carregar cada funcionalidade numa instalação sem dependências do desenvolvimento. Usar validate-native-runtime e check-pty-daemon-bundle do projeto quando executar o build aprovado.

## 8. Plano em fases

### Fase A — Horas: medir e reduzir bytes

1. **P00:** marcadores e coleta controlada de abertura/repouso.
2. **P01/P02:** minificação explícita e exclusão de mapas do pacote com simbolização preservada.
3. **P03, parte segura:** retirar tsbuildinfo, fontes de compilação, demos e prebuilds incompatíveis depois de conferir loaders.
4. **P05:** confirmar consumidores antes de retirar a inicialização legada; se houver dúvida, apenas mover compactação após a abertura.
5. **P19/P22:** seletores e lifecycle do bridge, se confirmada relevância nos fluxos utilizados.

São mudanças pequenas por item; empacotamento e ciclo completo de release podem ultrapassar algumas horas.

### Fase B — Dias: reduzir trabalho inicial e picos

1. **P06/P07:** fronteiras de rota/dependência e shell independente de telemetria; revisar contrato de auth.
2. **P08:** pool de diff sob demanda com capacidade medida.
3. **P04:** separar bootstrap de provisionamento mantendo gates de prontidão.
4. **P11/P14/P15/P16/P18/P20/P21:** experimentos focais, um mecanismo por comparação, priorizados pelo trace.
5. **P10, parte conservadora:** pausar trabalho de UI explicitamente enquanto oculto, mantendo o workaround gráfico até a matriz de validação.

### Fase C — Semanas: escala e orçamento de recursos

1. **P09:** lifecycle por demanda de hosts/organizações, incluindo CLIs e automações.
2. **P12/P13:** orçamento de memória dos terminais, restauração confiável de TUIs e persistência assíncrona por entidade.
3. **P17:** virtualização da sidebar com DnD, seleção e acessibilidade.
4. **P10 completo:** política de energia/oclusão e retirada seletiva de workarounds somente após evidência.
5. Cache de código/snapshot e transporte local especializado apenas se continuarem relevantes nos perfis após as fases anteriores.

Os itens alteram UX, contratos de persistência e lifecycle em graus diferentes. Aprovar um lote concreto antes de implementação; o relatório não autoriza todas essas mudanças.

## 9. Checklist comparativo

- [ ] Mesmo SHA/base de dados, Bun, Electron, macOS, arquitetura e tipo de assinatura.
- [ ] Cold launch: tempo até janela e até shell/workspace utilizável, com definição explícita de cold.
- [ ] Warm launch: p50/p95, dez ou mais execuções, sem tempo de pausa de debugger.
- [ ] Reativação pelo Dock e criação de segunda janela medidas separadamente.
- [ ] Tempo de avaliação dos imports, DB/migração, provisionamento, criação de hosts e startup de workers.
- [ ] .app/.asar/unpacked/DMG, contagem de arquivos, JS/CSS inicial e total, mapas ausentes do release.
- [ ] RSS por processo e physical footprint; heap/Worker/WebGL medidos separadamente.
- [ ] CPU por núcleo e wakeups em repouso visível, oculto, minimizado e após sleep/wake.
- [ ] Energia em bateria com brilho/refresh/carga fixos.
- [ ] Custo marginal por terminal, por TUI, por organização e por janela.
- [ ] p95/p99 de input→eco, switch e resize, com e sem flood de outro agente.
- [ ] Frames e layout/paint para 60/120 Hz; sem terminal em branco/context loss persistente.
- [ ] IPC/WS por segundo, bytes, backlog máximo e descartes/replay.
- [ ] Número de comandos Git/ps/lsof, raízes de watchers, eventos filtrados/overflow e tempo de recuperação.
- [ ] Cinquenta ciclos de abrir/fechar: retained heap, listeners, timers, sockets, PTYs e filhos.
- [ ] Offline, token expirado, mudança de conta/org, primeiro terminal e restauração de sessão.
- [ ] Instalação limpa arm64/x64 suportados, assinatura/notarização e update com simbolização.

## 10. Registro dos comandos e resultados da auditoria original

As buscas de código foram leituras com rg, rg --files, nl e sed nos caminhos citados. Não houve alteração de fonte. Os comandos e resultados abaixo são históricos, de 24/09/2026.

| Comando / ferramenta executada | Resultado |
|---|---|
| git rev-parse HEAD; git status --short | Commit registrado; árvore limpa |
| uname -m; sw_vers | arm64; macOS 27.0 / 26A428 |
| sysctl -n hw.memsize hw.physicalcpu hw.logicalcpu machdep.cpu.brand_string | 16 GiB; 10/10 CPUs; Apple M5 |
| bun --version; node --version | 1.4.2; v24.15.0 |
| ps -axo pid,ppid,%cpu,rss,etime,command, filtrado para Superset | Identificou app instalado, renderer/GPU, três hosts e três daemons |
| Coletor Python com ps -axo pid=,ppid=,rss=,time=,command= | 31 observações, CPU por delta e RSS; runtime-sample.json |
| Segunda leitura ps, usando comm e tty | Seis shells filhos de daemon, dois Codex e um Claude; process-counts.json |
| du -sk nas pastas do app | 1,57 GiB total; discriminação na seção 2 |
| Leitura Python do índice ASAR e source maps | Inventário, bytes por categoria, bundles e comparação de fontes; sem extrair o aplicativo sobre o original |
| analyze_asar.py e attribute_bundle.py | Totais e atribuição aproximada dos caracteres gerados; artefatos JSON |
| esbuild.transform, JS/CSS copiados para /tmp | Reduções de 31–44% JS e 19% CSS; não executou os bundles |
| ELECTRON_RUN_AS_NODE=1 ... -p process.versions | Electron/Node/Chromium/V8 e arm64 registrados; o sandbox produziu também um aviso task_name_for_pid, mas retornou as versões |
| sample 89611 5 10 -file .../renderer.sample.txt | Perfil nativo coletado; footprint 599,5M, pico 1,0G |
| file em app e cinco módulos .node principais | arm64 |
| codesign -dv --verbose=4 | Signature=adhoc, TeamIdentifier ausente, hardened runtime flag |
| xattr -p com.apple.quarantine | Atributo inexistente |
| Busca seletiva por marcos nos logs de startup | Nenhum marco utilizável encontrado; não foi derivada latência desses logs |
| stat dos arquivos locais relevantes | local.db 12.353.536 B; tanstack-db.sqlite 58.736.640 B; app-state.json 40.276 B; sem abrir bancos |

Na auditoria original, as primeiras leituras de ps/sysctl foram bloqueadas pelo sandbox; foram repetidas com a permissão de leitura necessária e concluídas. Não restou bloqueio de aprovação automática. Buscas em alguns caminhos presumidos não existentes foram corrigidas pelo inventário real do projeto.

**Limite da conclusão:** esta é uma auditoria estática ampla com medições de pacote, recursos da sessão encontrada e transformação de bundles. Não demonstra que todos os gargalos dinâmicos foram encontrados, não comprova 60/120 fps e não substitui a baseline controlada de abertura/repouso. O próximo passo depende de aprovar os itens a implementar ou uma rodada adicional de profiling controlado.

**Nota de reconstrução:** somente o relatório foi recriado em 28/09/2026. Não foram repetidas medições, implementadas recomendações ou restaurados os anexos temporários.
