# @battlestack/cli

The battlestack CLI engine. Users don't install this package directly — the
unscoped [`battlestack`](https://www.npmjs.com/package/battlestack) wrapper
(published in version lockstep) is the entry point that provides the
`battlestack`/`bstack` commands and makes `npx battlestack` resolve.

battlestack is a plugin-based scaffolding CLI for Nuxt 4. Answer a few
prompts and it hands you a running app — not a folder of TODOs you still
have to wire together.

```bash
npx battlestack@latest my-app
```

That works from a bare Node install. `pnpm dlx battlestack@latest my-app`
and `bunx battlestack@latest my-app` do the same thing if you already have
those on `PATH`. Requires Node >=24.

`--pm <pnpm|npm|bun>` sets the package manager for the *generated* project —
independent of whichever one ran the command above. Node 25 dropped bundled
Corepack, so a fresh machine commonly has npm and nothing else: if
`pnpm dlx` isn't available yet, `npm install -g pnpm`, or just add `--pm npm`
and skip pnpm entirely.

Non-interactive (CI, scripts): add `--yes`.

## Templates

| Template | Gets you |
| --- | --- |
| `nuxt4-minimal` | Nuxt 4 + UI v4 + Tailwind v4 only. No backend, no auth. |
| `nuxt4-fullstack` | Nuxt + UI + i18n + Postgres + Drizzle + custom auth + Mastra + Docker. |
| `nuxt4-ai` | Full stack + Mastra agents + HTTP streaming chat via an OpenAI-compatible AI gateway ([sluis.ai](https://sluis.ai) preset, 50k free tokens) + Docker. RAG opt-in. |

Each also prompts for optional features on top — storage, PWA, CI workflows,
passkeys, and more, depending on the template.

## This package

`battlestack` is the CLI entry point. It composes three siblings:

- [`@battlestack/core`](https://www.npmjs.com/package/@battlestack/core) — the
  plugin SDK: types, registries, plugin loader.
- [`@battlestack/preset-nuxt4`](https://www.npmjs.com/package/@battlestack/preset-nuxt4)
  — the Nuxt 4 framework definition and its open-source features.
- [`@battlestack/tui`](https://www.npmjs.com/package/@battlestack/tui) — the
  shared terminal-UI layer.

Installing `battlestack` pulls all three; you don't need to depend on them
directly unless you're writing a plugin.

Full documentation, architecture notes and contribution guide:
<https://github.com/SevenLabnl/battlestack>

## License

MIT © SevenLab
