---
name: superset-code-editor
description: Manter, corrigir e evoluir o código do editor v2 do Superset, LSP, autosave/formatação, configurações e importação do Zed, painel de projeto e painel local de alterações Git. Use para implementar features ou investigar regressões nessas camadas deste monorepo. Não usar para Codex Chat, terminal, configuração pessoal via CLI ou gestão de PRs/Azure DevOps.
---

# Editor e painéis do Superset

Skill local deste projeto para desenvolvimento sobre as features do editor e seus painéis. Os arquivos e contratos atuais são a fonte de verdade; as referências ajudam a localizar o slice e preservar comportamentos existentes. A inspiração no Zed não implica substituir todo o IDE nem alterar automaticamente preferências pessoais.

## Encontrar a camada certa

- Leia a seção correspondente em [architecture.md](references/architecture.md): buffers/editor, LSP, preferências/formatação, projeto ou Git.
- Use [workflows.md](references/workflows.md) para adicionar uma preferência, linguagem ou ação e escolher verificações focais. Não carregue todas as referências nem execute todos os testes em uma mudança pequena.
- Consulte [docs/editor.md](../../../docs/editor.md), [docs/lsp.md](../../../docs/lsp.md) e [docs/git-panel.md](../../../docs/git-panel.md) quando precisar do comportamento do produto. Relatos antigos de validação nesses documentos não comprovam o estado do checkout atual.

## Contratos que precisam permanecer coerentes

1. **Buffer compartilhado:** `SharedFileDocument` é a autoridade sobre conteúdo, dirty state, revision e salvamento. Splits não podem criar cópias independentes nem duas escritas/streams LSP para o mesmo documento.
2. **Assíncrono e lifecycle:** respostas de formatação, hints e diagnósticos não podem sobrescrever versões novas, arquivos renomeados ou views descartadas. Limpe timers/listeners/requests; não transforme `dispose` em um callback de salvamento.
3. **Preferências:** overrides ausentes herdam o global; `false` explícito permanece `false`. Preserve sincronização com as colunas legadas de fonte. Importação do Zed é seletiva, com prévia; nunca importar credenciais ou configurações de agentes.
4. **Apresentação:** tema exclusivo do editor não muda terminal/sidebar. O fundo dos painéis de projeto e alterações acompanha o token de background da sidebar. Preserve estado da árvore, navegação e menu ao mudar sua estrutura.
5. **Git:** uma linha local por caminho pode conter duas fontes de diff. Checkbox parcial não é staging por hunk: marcá-lo adiciona o restante do arquivo. Descartar unstaged deve preservar o index; comparações históricas não recebem controles de staging.

## Limites e validação

LSP e formatação estão implementados para hosts locais no desktop v2. Ampliar para remoto/v1 exige revisar resolução, autenticação e lifecycle; trocar apenas um guard visual não implementa esse suporte. Servidores/formatadores ausentes deixam o editor utilizável e não provocam downloads automáticos.

Siga os AGENTS.md do repo/desktop para componentes, persistência, Lingui e migrations. Para UI, use a [skill de verificação](../cdp-verification/SKILL.md), confirme a instância/worktree e exercite interações reais. Mudanças Git devem ser verificadas em repositórios temporários, nunca usando stage/descarte no checkout com trabalho do usuário como fixture. Registre o que passou e eventuais lacunas; falhas antigas do monorepo precisam de evidência atual para serem classificadas como preexistentes.
