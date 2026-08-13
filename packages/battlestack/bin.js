#!/usr/bin/env node
// Launcher only — the CLI lives in @battlestack/core/tui/preset-nuxt4/cli.
// This unscoped package exists so `npx battlestack` resolves; @battlestack/cli
// runs its main() on import. `workspace:*` pins the dep to the exact sibling
// version at publish time, so both packages must be released together.
import '@battlestack/cli'
