# Plano de Implementação: Página da Pokédex de Ordem Paranormal (Arquivo Paranormal da Ordo Realitas)

Este documento estabelece o plano de ação detalhado para implementar a interface completa da **Pokédex de Ordem Paranormal** no Superset Desktop IDE, transformando a descoberta de worktrees em uma experiência visual colecionável com estética de *Pokémon TCG* e dossiê sigiloso da *Ordo Realitas*.

---

## 1. Contexto & Objetivos

Já implementamos o sorteio de nomes de worktrees com 35+ entidades de Ordem Paranormal, a persistência global do usuário em `~/.superset/ordem_pokedex.json`, a ponte de eventos cross-process entre `host-service` e o Electron, e o pop-up holográfico (`OrdemPokemonCardReveal`).

O objetivo agora é **construir a página completa da Pokédex** para que o usuário possa:
1. Acompanhar seu progresso global de manifestação de entidades (barra de progresso, percentual, total descoberto).
2. Filtrar o catálogo por Elemento (*Sangue, Morte, Conhecimento, Energia, Medo*), Categoria (*Personagens, Criaturas, Relíquias*) ou buscar por texto.
3. Interagir com os cards colecionáveis holográficos 3D (efeito de inclinação e reflexo prismático ao passar o cursor).
4. Visualizar cards ainda confidenciais marcados como `[CLASSIFICADO]` com teasers misteriosos.
5. Clicar em qualquer entidade desbloqueada para abrir o **Dossiê Confidencial** completo, contendo biografia, citação, classe/papel, VD (Nível de Ameaça) e linha do tempo de todas as worktrees em que o personagem já foi usado na máquina.
6. Navegar facilmente para a Pokédex a partir de múltiplos pontos do app (ícone no rodapé da barra lateral, menu de configurações e Command Palette `Cmd+K`).

---

## 2. Decisões de Design & User Review

> [!IMPORTANT]
> **Conformidade com AGENTS.md**:
> Todos os componentes seguirão a regra estrita do repositório:
> - **Uma pasta por componente**: `NomeComponente/NomeComponente.tsx` + `index.ts`.
> - **Co-locação de dependências**: subcomponentes usados apenas em um local ficam aninhados na pasta `components/` do pai.
> - **Testes co-locados**: `NomeComponente.test.tsx` ao lado do componente.
> - Sem comentários supérfluos; nomes autoexplicativos e tipagem rigorosa com Zod / TypeScript.

> [!NOTE]
> **Resiliência a Imagens Externas**:
> Como as imagens provêm de wikis externas que podem impor restrições de hotlink (403) ou sofrer falha de rede offline, todos os componentes que renderizam fotos contarão com fallback automático para selos sigilares com o glifo e cores do Elemento correspondente.

---

## 3. Arquitetura de Componentes

```
apps/desktop/src/renderer/routes/_authenticated/settings/pokedex/
├── page.tsx                                  # Rota TanStack Router (/settings/pokedex)
└── components/
    ├── PokedexPage/                          # Orquestrador principal da tela
    │   ├── PokedexPage.tsx
    │   ├── PokedexPage.test.tsx
    │   └── index.ts
    ├── PokedexHeader/                        # Cabeçalho com progresso e estatísticas
    │   ├── PokedexHeader.tsx
    │   ├── PokedexHeader.test.tsx
    │   ├── index.ts
    │   └── components/
    │       └── ProgressStat/                 # Pílula de contagem por elemento/status
    │           ├── ProgressStat.tsx
    │           └── index.ts
    ├── PokedexFilterBar/                     # Barra de busca, categorias e elementos
    │   ├── PokedexFilterBar.tsx
    │   ├── PokedexFilterBar.test.tsx
    │   └── index.ts
    ├── PokedexGrid/                          # Grid responsivo de cards
    │   ├── PokedexGrid.tsx
    │   ├── PokedexGrid.test.tsx
    │   └── index.ts
    ├── PokedexCard/                          # Card holográfico desbloqueado
    │   ├── PokedexCard.tsx
    │   ├── PokedexCard.test.tsx
    │   ├── index.ts
    │   └── components/
    │       └── CardFoilEffect/               # Shader CSS holográfico 3D tilt
    │           ├── CardFoilEffect.tsx
    │           └── index.ts
    ├── PokedexConfidentialCard/              # Card [CLASSIFICADO] com silhueta e teaser
    │   ├── PokedexConfidentialCard.tsx
    │   ├── PokedexConfidentialCard.test.tsx
    │   └── index.ts
    ├── PokedexDetailModal/                   # Modal do dossiê completo da Ordo Realitas
    │   ├── PokedexDetailModal.tsx
    │   ├── PokedexDetailModal.test.tsx
    │   ├── index.ts
    │   └── components/
    │       ├── DossierHeader/                # Cabeçalho com selo e status
    │       │   ├── DossierHeader.tsx
    │       │   └── index.ts
    │       └── DossierTimeline/              # Log de worktrees onde foi invocado
    │           ├── DossierTimeline.tsx
    │           └── index.ts
    └── ElementBadge/                         # Badges dos 5 elementos paranormais
        ├── ElementBadge.tsx
        ├── ElementBadge.test.tsx
        └── index.ts
```

---

## 4. Etapas de Execução

### Fase 1: Atualização dos Tipos e Catálogo com Teasers Confidenciais
- **Arquivo:** `packages/shared/src/ordem-paranormal/types.ts`
  - Adicionar campo opcional `teaser?: string` no schema `ordemCharacterSchema`.
- **Arquivo:** `packages/shared/src/ordem-paranormal/characters.json`
  - Adicionar teasers enigmáticos da Ordo Realitas para os personagens (pistas sutis para quem ainda não os manifestou).
- **Testes:**
  - `bun test packages/shared/src/ordem-paranormal`

---

### Fase 2: Componentes de Topo (Header, Progresso e Filtros)
- **`ElementBadge/`**:
  - Exibição de ícones e cores para Sangue (vermelho), Morte (preto/cinza), Conhecimento (ouro/âmbar), Energia (roxo) e Medo (ciano).
- **`PokedexHeader/`**:
  - Barra de progresso dinâmica calculando `${totalDiscovered} / ${totalCharacters}` e percentual (`discoveryPercentage%`).
  - Indicador em tempo real de worktrees ativas no momento (`🟢 X Worktrees Ativas`).
  - Botão de ação rápida `✨ Testar Carta Pokémon` (chama `electronTrpc.ordemParanormal.triggerTestReveal`).
- **`PokedexFilterBar/`**:
  - Campo de busca instantânea com debouncing para filtrar por nome, classe ou citação.
  - Abas de alternância de categoria: *Todos*, *Personagens*, *Criaturas*, *Relíquias*.
  - Filtro por elemento único ou todos.

---

### Fase 3: Cards Colecionáveis com Efeito Holográfico 3D
- **`PokedexCard/`**:
  - Renderiza o card no estilo Pokémon TCG.
  - **Shader 3D Tilt:** Leve rotação 3D ao mover o cursor sobre o card (`perspective(1000px) rotateX(...) rotateY(...)`).
  - **Reflexo Metálico (Foil Layer):** Camada de gradiente em `mix-blend-mode: color-dodge` criando o reflexo cintilante característico de cartas raras.
  - Exibe VD (Valor de Dificuldade), nome, classe, citação, badges e pílula de worktree ativa se em uso.
- **`PokedexConfidentialCard/`**:
  - Visual de pasta confidencial censurada com carimbo `[CLASSIFICADO]`.
  - Silhueta misteriosa e teaser textual para instigar o usuário a descobrir o personagem criando novas worktrees.
- **`PokedexGrid/`**:
  - Layout CSS Grid auto-responsivo (`grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`) com scroll suave e estados vazios caso a busca não retorne resultados.

---

### Fase 4: Modal de Dossiê Detalhado (`PokedexDetailModal`)
- **Visual:** Estilo terminal confidencial da Ordo Realitas com acabamento dark, bordas translúcidas e acentos no elemento da entidade.
- **Conteúdo:**
  - Arte em alta resolução com moldura elemental.
  - Ficha técnica completa: VD, Temporada, Papel/Ocupação, Elemento e Filosofia.
  - Biografia canônica e citações originais.
  - **Linha do Tempo de Worktrees (`DossierTimeline`):**
    - Exibe cada aparição registrada na máquina do usuário com nome da branch, projeto vinculado, organização e data de manifestação.

---

### Fase 5: Pontos de Entrada & Navegação
- **Rodapé da Barra Lateral:**
  - Componente `PokedexButton/` inserido em `apps/desktop/src/renderer/screens/main/components/WorkspaceSidebarFooter.tsx` com ícone de escudo e tooltip "Arquivo Paranormal".
- **Menu de Configurações:**
  - Item "Pokédex Ordem Paranormal" adicionado na navegação de Settings.
- **Command Palette (`Cmd+K`):**
  - Comando registrado com atalho para abrir `/settings/pokedex`.

---

## 5. Plano de Verificação

### 5.1. Testes Automatizados
1. **Testes Unitários do Módulo Compartilhado**:
   ```bash
   bun test packages/shared/src/ordem-paranormal
   ```
2. **Testes do Router tRPC Desktop**:
   ```bash
   bun --cwd apps/desktop test src/lib/trpc/routers/ordem-paranormal.test.ts
   ```
3. **Testes dos Novos Componentes**:
   ```bash
   bun --cwd apps/desktop test src/renderer/routes/_authenticated/settings/pokedex
   ```
4. **Verificação de Lint & Tipagem**:
   ```bash
   bunx biome check apps/desktop/src/renderer/routes/_authenticated/settings/pokedex
   ```

### 5.2. Verificação Manual / CDP
1. Abrir a rota `/settings/pokedex` no Desktop.
2. Confirmar que a barra de progresso reflete os personagens já descobertos (`guizo`, `amigo-imaginario`, `xande`).
3. Clicar nos filtros por elemento e categoria para verificar a filtragem dinâmica.
4. Passar o mouse sobre os cards para conferir o brilho holográfico e inclinação 3D.
5. Clicar em um card desbloqueado para abrir o dossiê e verificar o histórico de worktrees.
6. Clicar em `✨ Testar Carta Pokémon` para ver a revelação no canto da tela.
