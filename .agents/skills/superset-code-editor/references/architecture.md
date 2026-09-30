# Mapa de arquitetura e contratos

Todos os caminhos abaixo são relativos à raiz do repo. Use estas abreviações apenas para localizar arquivos:

- `D = apps/desktop/src`
- `W = D/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId`
- `G = W/components/WorkspaceSidebar/hooks/useChangesTab`
- `S = D/renderer/routes/_authenticated/settings`

Os diretórios contêm `$workspaceId` literalmente; coloque caminhos entre aspas simples no shell.

## Editor e documentos compartilhados

| Responsabilidade | Ponto de entrada |
| --- | --- |
| Aquisição, release e assinatura do documento | `W/state/fileDocumentStore/useSharedFileDocument.ts` |
| Conteúdo, revision, saves serializados e transforms | `W/state/fileDocumentStore/fileDocumentStore.ts` e `types.ts` |
| Providers do documento e automação | `W/state/fileDocumentStore/FileDocumentStoreProvider.tsx` |
| Pane e seleção do renderer de arquivo | `W/hooks/usePaneRegistry/components/FilePane/` |
| Editor CodeMirror, adapter, tema e linguagens | `FilePane/registry/views/CodeView/components/CodeEditor/` |
| Opções de edição e hints | `W/state/lsp/editorExtensions.ts`, `inlayHints.ts` |

`CodeEditor` usa compartments para reconfigurar linguagem, tema e preferências sem recriar a view a cada render. `CodeEditorAdapter` mantém o contrato com o pane. Um texto visível numa view não substitui a autoridade do store: use as operações do documento para edits e saves.

A escrita mantém precondições de revision (`ifMatch`), conflict/orphan state e dirty state em falhas. O save transform recebe um snapshot de conteúdo/caminho; aplique seu resultado apenas se ainda corresponder ao documento. Não use formatadores para escrever o arquivo diretamente, contornando esse pipeline.

`EditorAutomation` em `W/state/lsp/EditorAutomation/` liga transforms e autosave a documentos referenciados do workspace. Autosave por foco identifica o pane por `data-editor-document-id`. Delay autosave usa `skipFormatting`; foco/window podem formatar conforme as preferências. Mudanças de configuração precisam reconfigurar documentos já abertos, não somente novas aquisições.

## LSP: renderer → host → processo

- Contratos, server IDs, aliases e schemas: `packages/shared/src/lsp.ts`.
- Documento/versionamento/workspace CodeMirror: `W/state/lsp/LspWorkspace.ts`.
- Sessões, bindings, transporte, capability updates, diagnósticos e navegação: `coordinator.ts`, `transport.ts`, `extensions.ts`, `LspProvider/` no mesmo diretório.
- Resolução de executável/root e configuração persistida: `packages/host-service/src/lsp/adapters.ts`, `settings.ts`.
- Processos stdio, JSON-RPC, requests reversos, cancelamento e WebSocket autenticado: `sessions.ts`, `routes.ts` no host; confira o registro no router/server ao adicionar protocolos.
- Controles de servidor: `S/editor/components/CodeEditorSettings/components/LspSettings/`.

Bindings de splits compartilham um cliente por servidor/root no renderer. Diferentes janelas têm ownership próprio. O host resolve o comando; mensagens WebSocket não podem escolher outro executável. O root de projeto pode variar por linguagem, respeitando limites do workspace.

Snapshots read-only/históricos não devem abrir sessões LSP nem emitir saves como se fossem documentos editáveis do workspace.

Offsets/versions são UTF-16. Synchronize o buffer antes de requests dependentes do texto. Ignore respostas obsoletas tanto no gutter quanto nos badges do painel. Hints são decorações do viewport, com filtros por categoria; não alteram o conteúdo. Respeite capabilities e registro dinâmico: a existência de um servidor não comprova suporte a um método.

## Configurações, importação e formatação

| Camada | Arquivo/diretório |
| --- | --- |
| Defaults, validação e herança por linguagem | `packages/shared/src/editor-settings.ts` |
| Conversão e aplicação seletiva do Zed | `packages/shared/src/zed-editor-import.ts` |
| SQLite desktop e colunas legadas de fonte | `packages/local-db/src/schema/schema.ts` |
| RPC desktop get/set/preview/apply/picker | `D/lib/trpc/routers/settings/editor/editor.ts` |
| Cache/query de preferências e fontes | `D/renderer/hooks/useEditorSettings/`, `D/renderer/lib/font-settings.ts` |
| Página e controles | `S/editor/components/CodeEditorSettings/` |
| Sidebar e busca nas configurações | `S/layout.tsx`, `S/utils/settings-search/`, `D/renderer/stores/settings-state.ts` |
| RPC de formatação e subprocessos | `packages/host-service/src/editor/format.ts` |

Preferências visuais/editoriais ficam no SQLite desktop. Configurações de executáveis LSP ficam no SQLite do host. São escopos diferentes; não troque um pelo outro ao adicionar uma opção.

Overrides usam campos opcionais sem defaults internos que apaguem a herança. Use `resolveEditorSettings`, mantendo valores explícitos e diferenças entre `undefined`, `null` e `false`. O router sincroniza JSON de preferências e colunas legadas de fonte; setters devem invalidar os caches correspondentes.

A prévia do Zed lê JSON/JSON5 e traduz apenas um whitelist. O hash do arquivo/tema protege a aplicação contra mudanças desde a prévia. Ativação do tema e palette são selecionadas juntas; valores não escolhidos continuam iguais. Um tema não encontrado ou fonte ausente não exige substituir preferências existentes nem instalar arquivos.

Formatação automática procura ferramentas instaladas do projeto: Biome configurado/disponível, Prettier configurado/disponível, depois LSP. Dart usa o SDK detectado; um comando customizado de servidor pode ser wrapper e não um executável `dart`. O subprocesso usa stdin/stdout, cwd/env resolvidos, timeout, limites de saída e término da árvore. Falha salva o buffer com aviso; não substitua texto novo por resposta atrasada.

## Painel de projeto e assets

- Implementação: `W/components/WorkspaceSidebar/components/FilesTab/`, especialmente o bridge, actions e bookkeeping/path helpers.
- Tokens, filtros e loader de ícones: `D/renderer/lib/zedProjectPanel/`.
- Fontes e CSS: `D/renderer/globals.css`, `D/resources/public/project-fonts/`.
- Ícones fonte/associações/licença: `D/resources/zed-icons/`; sprites gerados em `D/resources/public/zed-icons/` por `apps/desktop/scripts/generate-zed-icons.ts`.

Pierre renderiza em shadow DOM. Seleção, paths de diretório com barra final, paths compactados e nomes truncados são representações de UI; use os helpers existentes para chegar ao caminho real. Filtros de ocultos/ignored também precisam valer em refresh, watchers, reveal e rename.

Mudanças estruturais podem recriar o modelo: preserve paths, expansão, seleção e scroll e espere o rename ativo terminar. Não remova ações de criar/buscar/refresh/collapse apenas porque o cabeçalho fica oculto. Ícones por associação e SVGs default devem funcionar nos dois temas, com ids de defs isolados por instância e tint de ícones monocromáticos. Não edite sprites gerados nem descarte notices de licença.

## Painel Git local

- Entrada, filtro/scope e migração: `G/useChangesTab.tsx`, `migrateGitPanelPreferences.ts`.
- Modelo/filtragem/virtualização da lista local: `G/components/LocalChangesList/`.
- Rows, menus, checkbox, estatísticas e seções: `G/components/ChangesFileList/`.
- Comparações/ref de diff compartilhadas: `W/hooks/useChangeset/`, `useSidebarDiffRef/`.
- Preferências: `D/renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema.ts`; collapse das seções em `D/renderer/stores/v2-changes-sections/`.
- Operações/status Git: `packages/host-service/src/trpc/router/git/git.ts` e seus helpers/tests.

`LocalChangeEntry` agrega staged/unstaged por caminho sem alterar `ChangesetFile`. Default primary = unstaged quando existe; filtro staged usa sua própria fonte/stats. Não some os dois lados nem suprima a referência staged de um arquivo parcial. Renomes mantêm `oldPath`; paths diferentes não são duplicatas só porque têm o mesmo basename.

O cabeçalho usa operações em lote do repositório, não operações limitadas aos resultados de busca. Preserve labels e confirmações explícitos ao mudar seu escopo. O marker de apresentação migra defaults uma vez; o update em lote evita reserializar todas as workspaces a cada linha. Não reaplique defaults em cada montagem nem apague escolhas posteriores.

O tooltip pode sobrescrever `data-state` do checkbox. Use `aria-checked` para os estilos vazio/marcado/mixed de `.git-stage-checkbox`, mantendo o componente compartilhado intacto. Keyboard/focus e controles visíveis precisam continuar funcionando quando o virtualizer desmonta linhas.

Para descartar só unstaged de arquivo tracked, restaure do index (`git restore --worktree -- path`). `checkout HEAD -- path` também reescreve o index e perde stage. Descarte total/staged tem semântica distinta e confirmação própria. Arquivo unmerged deve falhar sem escolher ours/theirs ou apagar os stages do conflito.
