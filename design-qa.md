# Azure DevOps task board design QA

**Source visual truth**

- Board: `/var/folders/nn/kts40_8d12g1q102mn9lwrgc0000gn/T/codex-clipboard-Vu6Swv.png`
- Drag state: `/var/folders/nn/kts40_8d12g1q102mn9lwrgc0000gn/T/codex-clipboard-Jf5pKb.png`
- Empty states: `/var/folders/nn/kts40_8d12g1q102mn9lwrgc0000gn/T/codex-clipboard-Hwam7h.png`
- Work item detail: `/var/folders/nn/kts40_8d12g1q102mn9lwrgc0000gn/T/codex-clipboard-ywp0ma.png`
- Azure reference: `/var/folders/nn/kts40_8d12g1q102mn9lwrgc0000gn/T/codex-clipboard-PV9hfa.png` and `/var/folders/nn/kts40_8d12g1q102mn9lwrgc0000gn/T/codex-clipboard-yfAwzc.png`

**Implementation evidence**

- Screenshot path: unavailable
- Intended viewport: 1324 x 720 CSS px for the board; 1368 x 1029 CSS px for work item detail
- Source pixels: 1324 x 720 for the primary board; 1368 x 1029 for work item detail
- Implementation pixels: unavailable
- Density normalization: not applicable because the implementation could not be captured
- State: authenticated desktop app, Azure DevOps source selected, configured current sprint

**Findings**

- [P0] Browser-rendered implementation could not be captured
  Location: authenticated desktop app startup.
  Evidence: the isolated local stack starts, but `bun run db:migrate` selects the Neon serverless WebSocket driver for `DATABASE_URL_UNPOOLED=postgres://postgres:postgres@localhost:3189/main` and fails against `wss://localhost/v2` with `ECONNREFUSED`. The following seed then fails because `auth.users` does not exist.
  Impact: without the seeded dev account, the authenticated Tasks route cannot be opened, so no visual comparison or safe interaction test can be performed.
  Fix: repair the repository's local migration path so Drizzle Kit connects to the direct local Postgres port or correctly configures the local Neon WebSocket proxy before migration, then rerun `.superset/setup.local.sh` and capture the authenticated board.

**Required fidelity surfaces**

- Fonts and typography: not visually verifiable without an implementation capture.
- Spacing and layout rhythm: not visually verifiable without an implementation capture.
- Colors and visual tokens: not visually verifiable without an implementation capture.
- Image quality and asset fidelity: the target contains no required raster artwork beyond provider/avatar references; icon fidelity still requires a rendered comparison.
- Copy and app-specific content: source strings are implemented and i18n catalogs compile, but wrapping and truncation cannot be visually verified.

**Full-view comparison evidence**

Blocked. The source images were available, but no browser-rendered implementation image could be produced in the matching authenticated state.

**Focused region comparison evidence**

Blocked for the same reason. The planned focus regions were the sprint/filter toolbar, work-item cards, drag target slot, worktree section, and PR actions.

**Primary interactions tested**

- Browser interaction testing: blocked before authentication.
- Safe non-mutating Azure reads: covered by the host runtime tests and prior CLI probes.
- Mutating Azure actions were intentionally not exercised against the Banese organization during visual QA.

**Console errors checked**

Not available because the authenticated renderer state could not be reached.

**Open Questions**

- None about the requested UI. The blocker is the repository's local database setup, not an unresolved product decision.

**Implementation Checklist**

1. Fix the local Drizzle migration transport.
2. Seed the local dev account.
3. Open the Azure task source at 1324 x 720 and capture the configured board.
4. Compare the full board and the focused interaction regions against the supplied images.
5. Exercise filters, item navigation, worktree dialog, and PR dialog without submitting mutations to Azure.

**Comparison History**

- No visual iteration was possible because the first implementation capture was blocked before authentication.

**Follow-up Polish**

- Revisit only after the first matched-state capture; no visual polish claims are made from code inspection alone.

final result: blocked
