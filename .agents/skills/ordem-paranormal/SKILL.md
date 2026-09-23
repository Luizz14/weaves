---
name: ordem-paranormal
description: Guide for developing, extending, testing, and troubleshooting the Ordem Paranormal RPG worktree naming and Pokédex feature in Superset. Covers character catalog schemas, branch generation precedence, persistent Pokédex storage (~/.superset/ordem_pokedex.json), real-time discovery events, desktop tRPC routers, holographic Pokémon card reveals, and Pokédex UI components.
---

# Ordem Paranormal Worktree & Pokédex Architecture Guide

This skill guides agents working on the **Ordem Paranormal** feature in the Superset monorepo. This feature automatically names new Git worktrees using characters, creatures, and relics from *Ordem Paranormal RPG*, records persistent discoveries globally in the user's machine profile across all organizations, manifests holographic Pokémon-style collectible cards on discovery, and provides a full interactive Pokédex (Arquivo Paranormal da Ordo Realitas).

---

## Read only what the task needs

- Use [architecture.md](references/architecture.md) to locate affected layers or understand cross-process dependencies.
- Use [workflows.md](references/workflows.md) for the specific implementation recipe or validation commands needed. Select affected tests; command examples are not a mandatory full-suite checklist.

## Key Invariants & Rules

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
   - Run `bun run generate:routes` (`tsr generate`) when adding, removing, renaming, or changing route definitions; edits to nested components alone do not require regeneration.
