# Workflows and validation

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
