---
name: ordem-paranormal
description: Guide for developing, extending, testing, and troubleshooting the Ordem Paranormal RPG worktree naming and Pokédex feature in Superset. Covers character catalog schemas, branch generation precedence, persistent Pokédex storage (~/.superset/ordem_pokedex.json), real-time discovery events, desktop tRPC routers, holographic Pokémon card reveals, and Pokédex UI components.
---

# Ordem Paranormal Worktree & Pokédex Architecture Guide

This skill guides agents working on the **Ordem Paranormal** feature in the Superset monorepo. This feature automatically names new Git worktrees using characters, creatures, and relics from *Ordem Paranormal RPG*, records persistent discoveries globally in the user's machine profile across all organizations, manifests holographic Pokémon-style collectible cards on discovery, and provides a full interactive Pokédex (Arquivo Paranormal da Ordo Realitas).

---

## 1. System Overview & Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Git Worktree / Branch Creation                                           │
│    Desktop (`git.ts`) & Host-Service (`workspaces.ts`)                       │
│    └─► `generateFriendlyBranchName(existing)`                                │
│        └─► `generateOrdemBranchName(existing)`                              │
│            └─► Random unused character from `characters.json`                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ calls recordDiscoveryByBranch(branch)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 2. Global Persistent Storage & Events (packages/shared/src/ordem-paranormal)│
│    `storage.ts`: Loads/Saves `~/.superset/ordem_pokedex.json` (User-wide)   │
│    `events.ts`: `ordemDiscoveryEmitter.emit("discovery", ...)`              │
│    Persists: firstDiscoveredAt, timesUsed, appearances (branch, org, proj) │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Observable tRPC Subscription
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 3. Desktop tRPC Router (apps/desktop/src/lib/trpc/routers/ordem-paranormal) │
│    `ordemParanormal.getSummary` (summary, stats, active branches in localDb)│
│    `ordemParanormal.onDiscovery` (real-time stream of newly unlocked cards) │
│    `ordemParanormal.triggerTestReveal` (dev/testing card animation)         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ React Hooks (electronTrpc)
┌──────────────────────────────────────▼──────────────────────────────────────┐
│ 4. Desktop UI Surfaces (apps/desktop/src/renderer/)                         │
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
  - `ordemCharacterSchema`: Zod schema for character objects (`id`, `name`, `category`, `element`, `season`, `role`, `description`, `imageUrl`, `quote`).
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
  - `components/PokedexPage/`: Main Pokédex view with `electronTrpc.ordemParanormal.getSummary` query and auto-refetch.
  - `components/PokedexHeader/`: Header displaying total count, progress bar, search input, category buttons, element badges, and the `✨ Testar Carta Pokémon` button.
  - `components/PokedexCard/`: Individual card with discovered state (photo, element, role, quotes, active branch badge) and undiscovered state (`[CLASSIFICADO]` confidential card).
  - `components/PokedexDetailModal/`: Detailed dossier modal opened upon clicking a discovered card. Shows full lore, quote, element info, and appearance history.
  - `components/ElementBadge/`: Badges for Sangue, Morte, Conhecimento, Energia, and Medo.
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

---

## 3. Key Invariants & Rules

1. **Global User Scope (Cross-Organization)**:
   - The Pokédex is stored at `~/.superset/ordem_pokedex.json`. It is **never** tied to a single organization or workspace ID. Worktrees created in any organization contribute to the user's permanent collection.
2. **Permanent Discovery History**:
   - Deleting a worktree **must not** remove a character from the Pokédex. Once discovered, the character remains unlocked with its historical timestamps preserved.
   - Deleting a worktree only clears its active status (`isActiveNow: false`), freeing that character to be drawn again if desired.
3. **Collision Safety in Git**:
   - `isCharacterNameUsed` verifies existing Git branches.
   - Branch names sanitize slashes, prefixes (e.g., `luiz/arthur-cervero`), and numeric suffixes (`arthur-cervero-1`).
4. **Graceful Fallbacks for External Images**:
   - Fandom/Wikia URLs may experience hotlink restrictions (Cloudflare 403). `PokedexCard` and `PokedexDetailModal` **must** handle `onError` on image elements and fallback to stylized element seals with character names.
5. **Component Architecture Rules (from AGENTS.md)**:
   - One folder per component (`ComponentName/ComponentName.tsx` + `index.ts`).
   - Co-locate subcomponents and dependencies.
   - Run `bun run generate:routes` (`tsr generate`) whenever touching files under `routes/`.

---

## 4. How-To Guides

### Adding a New Character / Creature / Relic
1. Open `packages/shared/src/ordem-paranormal/characters.json`.
2. Add an entry matching `OrdemCharacter`:
   ```json
   {
     "id": "novo-personagem",
     "name": "Nome Completo",
     "category": "personagem",
     "element": "Sangue",
     "season": "Desconjuração",
     "role": "Marcado / Ocultista",
     "description": "Biografia resumida do personagem...",
     "imageUrl": "https://...",
     "quote": "Frase de efeito marcante."
   }
   ```
3. Run `bun test packages/shared/src/ordem-paranormal` to ensure schema validation passes.

### Testing the Real-Time Card Reveal Popup
1. In Superset Desktop, navigate to Settings > **Pokédex Ordem Paranormal** (`/settings/pokedex`).
2. Click the **`✨ Testar Carta Pokémon`** button in the header.
3. The holographic Pokémon card popup will slide up in the bottom-right corner with foil reflections and element-specific lighting.
4. Alternatively, create any new worktree—if an Ordem character is picked, the card triggers automatically.

### Running Tests & Route Generation
```bash
# Run Ordem Paranormal unit tests
bun test packages/shared/src/ordem-paranormal

# Regenerate TanStack router route tree (in apps/desktop)
bun run generate:routes

# Run Biome code check on new components
bunx biome check apps/desktop/src/lib/trpc/routers/ordem-paranormal.ts apps/desktop/src/renderer/routes/_authenticated/settings/pokedex apps/desktop/src/renderer/routes/_authenticated/components/OrdemPokemonCardReveal
```
