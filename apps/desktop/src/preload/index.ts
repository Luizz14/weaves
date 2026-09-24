/**
 * Tauri renderers do not run an Electron preload script. The desktop bridge
 * is initialized from `renderer/index.tsx` and talks to Rust through Tauri
 * commands/events, so this entry intentionally has no Electron imports or
 * side effects.
 */
export {};
