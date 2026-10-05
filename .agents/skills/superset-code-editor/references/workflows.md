# Evolução, diagnóstico e validação

Use apenas a receita e os checks relacionados ao pedido. Consulte [architecture.md](architecture.md) para expandir os prefixos de caminho. As instruções de escopo/ambiguidade do AGENTS.md continuam valendo; esta skill não autoriza publicação, instalações ou alterações no Git de projetos do usuário para testar a UI.

## Adicionar ou alterar preferência

1. Defina comportamento global e por linguagem no schema/resolver, incluindo ausência/herança e compatibilidade com dados já salvos. Não coloque `.default()` nos campos opcionais de override de modo que substituam o global.
2. Conecte a opção ao editor/automação/painel efetivo. Em CodeMirror, reconfigure o compartment apropriado; em automação, atualize os documentos já abertos e limpe o estado anterior.
3. Atualize controles, navegação/busca e invalidação dos caches pertinentes. Mantenha as colunas legadas de fontes sincronizadas se o campo for de aparência.
4. Se importável do Zed, traduza explicitamente unidade/alias/valor e inclua na prévia. Um valor sem equivalente deve ser indicado como incompatível, não aplicado por aproximação silenciosa.
5. Use Lingui e preencha en/pt-BR após extraction. Se exigir coluna/migration, siga o procedimento do pacote de destino; os arquivos Drizzle gerados não são editados manualmente.

A skin do editor e os tokens da aplicação são independentes. Corrigir a cor da sidebar normalmente envolve seu token/CSS, não importar uma nova palette nem alterar o tema pessoal do usuário.

## Adicionar linguagem ou capacidade LSP

Verifique separadamente: detecção da extensão (`D/shared/detect-language.ts`), suporte/highlighting de CodeMirror (`loadLanguageSupport.ts`), opções editoriais (`EDITOR_LANGUAGES`) e adapter/ID LSP (`packages/shared/src/lsp.ts`). Uma linguagem ter highlighting não implica ter um servidor.

No host, defina resolução de comando/args/env e root respeitando o workspace. Nos schemas/UI, declare instalação e capabilities reais. Se adicionar um método, trate capability ausente, erros, cancelamento e respostas obsoletas no coordinator/plugin; atualize a negociação do host quando necessária. Atualize mocks/fixtures de protocolo e docs. Kotlin/Android e XML/Android não ganham inteligência de projeto só por receber uma nova extensão de arquivo.

Não associe lifecycle de servidor diretamente a um único pane: abrir/fechar um split não pode fechar o documento dos outros. Verifique troca de arquivo/workspace, reload, reconexão e cleanup, além do request isolado.

## Modificar saves, autosave ou formatação

Siga o fluxo `SharedFileDocument → save transform → filesystem.writeFile → save notification`. Preserve serialization/dedup de saves e revision checks. Uma ferramenta que escreve o arquivo diretamente ou um edit aplicado só à view contorna a proteção contra conflitos e o buffer compartilhado.

Teste buffer editado/renomeado enquanto o formatter responde, falha da ferramenta, múltiplos saves concorrentes e divergência externa. Falha de formatação mantém o save com aviso; conflito de escrita não vira sucesso. Autosave deve respeitar dirty/pending/conflict/orphan state e não ocorrer por `dispose`. Não mude o comportamento do delay para formatar sem um pedido que estabeleça essa mudança.

## Modificar painéis ou ações Git

- Projeto: avalie carregamento lazy, compactação de diretórios, filtros, paths reais e eventos FS. Preserve rename e estado durante reconfiguração. Reuse assets/tokens; `--background` acompanha a sidebar nos dois temas.
- Git: mantenha dados de status/diff separados da apresentação agregada. Ao alterar uma ação, confira qual fonte ela opera e o alcance real do endpoint (arquivo, repo, staged ou unstaged).
- Para preservar stage no descarte, não valide apenas o texto do dialog: compare o conteúdo do index antes/depois e o worktree em repos reais temporários.
- Para ícones, altere SVGs/associações fonte e regenere os sprites com `bun run --cwd apps/desktop generate:icons`. Preserve licenças. Não use ImageGen para redesenhar SVGs do sistema existente.

## Checks focais

Execute os comandos a partir do diretório indicado. **Os testes desktop precisam do cwd `apps/desktop`**, onde `bunfig.toml` carrega os shims de Lingui e ambiente; executá-los a partir da raiz pode causar falhas de macros que não pertencem à feature.

Na raiz, para schemas/import e contratos LSP:

```sh
bun test packages/shared/src/editor-settings.test.ts packages/shared/src/lsp.test.ts
```

Em `packages/host-service`, escolha o slice:

```sh
bun test src/lsp
bun test src/editor/format.test.ts
bun test src/trpc/router/git/discard-changes.test.ts
```

Em `apps/desktop`, escolha os testes afetados:

```sh
bun test 'src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/fileDocumentStore'
bun test 'src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/state/lsp'
bun test src/renderer/lib/zedProjectPanel
bun test 'src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/hooks/useChangesTab'
bun test src/renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema.test.ts
bun test src/renderer/routes/_authenticated/settings/utils/settings-search
```

Para alteração de UI/settings, complemente com Biome nos arquivos do slice e `bun run check:i18n` na raiz quando houver strings. Gere rotas ao alterar arquivos de rota; nested components sozinhos não exigem codegen. Para changes cross-process ou packaging, use os builds/typechecks dos pacotes envolvidos (`build:host` no host; `compile:app`/`typecheck` no desktop), conferindo scripts atuais e destino dos artifacts antes de executá-los. Não transforme esta lista num full-suite obrigatório.

Logs antigos de `docs/lsp.md` descrevem um checkout passado. Se um check global falhar, identifique os arquivos/diagnósticos atuais e confira a base relevante; não reutilize uma contagem antiga como aprovação. Parse/transpile, teste focal e build completo são evidências diferentes.

## Verificação real e fixtures

Leia a [skill CDP](../../cdp-verification/SKILL.md). Confirme app/worktree, URL, portas, org e autenticação reais; várias instâncias Superset podem estar abertas. Descubra esses valores no ambiente atual, não copie portas, UUIDs ou paths de logs desta implementação.

Interações visíveis validam o produto; chamadas internas/API servem para setup e diagnóstico, não substituem clicar no checkbox, navegar entre panes ou abrir o menu. Se CDP não estiver habilitado na instância em uso, não feche uma janela com buffers do usuário para reabrir com debug. Use o controle nativo disponível quando suficiente e relate a diferença de evidência/lacuna. Em Vite, imports no console sem o query de HMR ativo podem criar outra instância do store/collection; confira efeito visível e estado canônico, não apenas o valor devolvido pelo módulo de diagnóstico.

Escolha os cenários relevantes:

- Editor: dirty buffer em splits, troca de linguagem, configuração com arquivo aberto, save/formatter atrasado, foco/window/delay, conflito de revision e servidor indisponível.
- Projeto: rename ativo, expansão/scroll/seleção após trocar densidade, diretórios compactados, hidden/ignored, watchers e root oculto sem perder ações.
- Git: arquivo parcial único, stage/unstage individual e em lote, filtros/diff dos dois lados, renomes/deletes/novos/binários, falha de operação e cancelamento do descarte. Use capturas e medidas para layout, indicadores mixed, duas palettes e sidebar estreita.

Use fixtures sem credenciais em repos temporários; operações Git de teste ficam neles. Ao comparar dados do index, `git show :path` e `git diff --cached` comprovam o que foi preservado. `simple-git.raw` pode devolver um thenable e saída de merge com conflito sem a rejeição esperada pelo matcher: valide stages não resolvidos com `git ls-files -u` em vez de considerar apenas a Promise de setup.

Guarde preferências/rota antes de alterá-las em QA; restaure-as e remova só registros de projeto/workspace comprovadamente pertencentes à fixture. Não copie secrets de host/auth para logs ou screenshots. Atualize os docs do comportamento afetado quando mudar o contrato ou a jornada.
