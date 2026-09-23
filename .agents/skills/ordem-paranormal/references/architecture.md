# Architecture and file map

## 1. System Overview & Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Git Worktree / Branch Creation                                           │
│    Desktop (`git.ts`) & Host-Service (`workspaces.ts`)                       │
│    └─► `generateFriendlyBranchName(existing)`                                │
│        └─► `generateOrdemBranchName(existing)`                              │
│            └─► Random unused character from `characters.json`                │
│    Host-Service broadcasts `workspace:changed` (type: created) over eventBus │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 2. Cross-Process Bridge (Renderer -> Electron Main)                          │
│    `useHostWorkspaces` & `useWorkspaceCreates` listen to created event/settle│
│    Calls `electronTrpcClient.ordemParanormal.recordDiscoveryByBranch`       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 3. Global Persistent Storage & Events (Electron Main & packages/shared)     │
│    `storage.ts`: Loads/Saves `~/.superset/ordem_pokedex.json` (User-wide)   │
│    Debounces repeat events for same branch within 15 seconds                 │
│    `events.ts`: `ordemDiscoveryEmitter.emit("discovery", ...)` in Main      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Observable tRPC Subscription
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 4. Desktop tRPC Router (apps/desktop/src/lib/trpc/routers/ordem-paranormal) │
│    `ordemParanormal.getSummary` (summary, stats, active branches in localDb)│
│    `ordemParanormal.onDiscovery` (real-time stream of newly unlocked cards) │
│    `ordemParanormal.recordDiscoveryByBranch` (cross-process trigger)        │
│    `ordemParanormal.triggerTestReveal` (dev/testing card animation)         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ React Hooks (electronTrpc)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 5. Desktop UI Surfaces (apps/desktop/src/renderer/)                         │
│    - `OrdemPokemonCardReveal`: Floating holographic foil card popup        │
│    - `PokedexPage` (/settings/pokedex & /pokedex): Interactive card gallery │
│    - `PokedexDetailModal`: Full dossier, lore, quote, and worktree history  │
│    - `PokedexButton`: Shield launcher in workspace sidebar footer           │
│    - `GeneralSettings` & Command Palette (`Cmd+K`): Global navigation links │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory & Key File Map

### Shared Library (`packages/shared/src/ordem-paranormal/`)
- **`characters.json`**: Canonical database containing 35+ agents, creatures, and relics. Each entry must conform to `ordemCharacterSchema`.
- **`types.ts`**:
  - `ordemElementSchema`: `"Sangue" | "Morte" | "Conhecimento" | "Energia" | "Medo" | "Nenhum"`.
  - `ordemCategorySchema`: `"personagem" | "criatura" | "reliquia"`.
  - `ordemCharacterSchema`: Zod schema for character objects (`id`, `name`, `category`, `element`, `season`, `role`, `description`, `imageUrl`, `quote`, `teaser`, `vd`).
  - `OrdemCharacterStatus`: Extended shape for worktree query status (`isUsed`, `activeBranch`).
- **`catalog.ts`**:
  - `getAllOrdemCharacters()`: Returns the parsed list of all characters.
  - `getOrdemCharacter(id)`: Looks up a character by case-insensitive ID/slug.
  - `isCharacterNameUsed(id, existingNames)`: Checks if a character is already claimed in active Git branches.
  - `getAvailableOrdemCharacters(existingNames)`: Returns only characters not currently in use.
  - `getRandomUnusedOrdemCharacter(existingNames)`: Draws an unused character at random.
  - `findCharacterByBranch(branchName)`: Detects if a branch name contains an Ordem character slug.
  - `getWorktreeOrdemStatus(existingNames)`: Maps all characters with their active branch if present.
- **`generator.ts`**:
  - `generateOrdemBranchName(existingNames)`: Core branch naming algorithm. Prioritizes unused Ordem characters; if all 35+ are in use, appends a numeric suffix (`<id>-2`), and falls back to friendly-words if exhausted.
- **`storage.ts`**:
  - `getPokedexStoragePath()`: Resolves `$SUPERSET_HOME_DIR/ordem_pokedex.json` or `~/.superset/ordem_pokedex.json`.
  - `loadPokedex()` & `savePokedex()`: Safe JSON loading and atomic writing.
  - `recordCharacterDiscovery(slug, metadata)`: Updates discovery count, timestamps, and appearance records; triggers `ordemDiscoveryEmitter`.
  - `recordDiscoveryByBranch(branch, metadata)`: Convenience method that resolves the character from branch string and records discovery.
  - `getOrdemPokedexSummary(activeBranches)`: Generates full summary with percentage, total discovered, and card states.
- **`events.ts`**:
  - `ordemDiscoveryEmitter`: Central `EventEmitter` broadcasting discovery events (`OrdemDiscoveryEvent`).
- **`catalog.test.ts` & `storage.test.ts`**: Unit tests verifying schema parsing, collision detection, storage persistence, and summary calculations.

### Branch Generation Hooks
- **`packages/shared/src/workspace-launch/friendly-branch-name.ts`**:
  - Calls `generateOrdemBranchName(existingNames)` as the first-priority generator.
- **`packages/host-service/src/trpc/router/workspaces/workspaces.ts`**:
  - In workspace creation flow, generates branch and calls `recordDiscoveryByBranch(resolvedBranch, { project })`.
- **`apps/desktop/src/lib/trpc/routers/workspaces/utils/git.ts`**:
  - In `createWorktree`, calls `recordDiscoveryByBranch(branch)` upon successful `git worktree add`.

### Desktop Backend (`apps/desktop/src/lib/trpc/routers/`)
- **`ordem-paranormal.ts`**:
  - Mounted in `index.ts` under `ordemParanormal`.
  - `getSummary`: Queries active branches from SQLite `localDb.select().from(workspaces)` and returns full Pokédex summary.
  - `getCharacter`: Fetches individual character dossier.
  - `recordDiscovery`: Manual unlock mutation.
  - `onDiscovery`: tRPC subscription streaming real-time discoveries to the renderer.
  - `triggerTestReveal`: Test mutation to preview the card animation immediately.

### Desktop Frontend UI (`apps/desktop/src/renderer/`)
- **`routes/_authenticated/settings/pokedex/`**:
  - `page.tsx`: Route `/_authenticated/settings/pokedex/`.
  - `components/PokedexPage/`: Main Pokédex orchestrator with `electronTrpc.ordemParanormal.getSummary` query and auto-refetch.
  - `components/PokedexHeader/`: Header with `ProgressStat/` pills (worktree activity, counts), progress bar, and test reveal button.
  - `components/PokedexFilterBar/`: Instant search with debouncing, category pills (Agentes, Criaturas, Relíquias), and element filters (Sangue, Morte, Conhecimento, Energia, Medo).
  - `components/PokedexGrid/`: Responsive CSS grid rendering discovered and confidential cards with empty state handling.
  - `components/PokedexCard/`: Collectible Pokémon TCG card with `CardFoilEffect/` (3D mouse tilt and color-dodge iridescent shimmer), VD badge, and element border styling.
  - `components/PokedexConfidentialCard/`: Redacted confidential dossier card with `[CLASSIFICADO]` stamp, mystery silhouette, and lore teaser.
  - `components/PokedexDetailModal/`: Detailed dossier modal with high-res portrait, canonical quote, lore description, active branch indicators, and `DossierTimeline/` listing historical worktrees.
  - `components/ElementBadge/`: Visual elemental badges with canonical glyphs and color styling.
- **`routes/_authenticated/pokedex/page.tsx`**:
  - Direct route redirecting to `/settings/pokedex`.
- **`routes/_authenticated/components/OrdemPokemonCardReveal/`**:
  - Mounted globally in `_authenticated/layout.tsx`.
  - Listens to `electronTrpc.ordemParanormal.onDiscovery.useSubscription`.
  - Renders a 3D-tilted, holographic foil-shimmering Pokémon-style card in the bottom-right corner when a new character is discovered.
- **`screens/main/components/PokedexButton/`**:
  - Shield icon button mounted in `WorkspaceSidebarFooter.tsx` next to Settings.
- **`commandPalette/modules/settings/commands.ts`**:
  - Registered in Command Palette with keywords: `pokedex`, `ordem`, `paranormal`, `cards`, `rpg`, `entidades`, `personagens`.
- **`settings-search.ts` & `GeneralSettings.tsx`**:
  - Registered under "Editor & Workflow" with full-width layout and settings search indexing.
