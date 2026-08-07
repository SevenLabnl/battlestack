# @battlestack/preset-nuxt4

The public preset for [`battlestack`](https://www.npmjs.com/package/battlestack):
the Nuxt 4 framework definition, its three templates, and the open-source
features they compose from.

Install `battlestack` to use it — it depends on this package already. Depend
on this one directly only if you are writing a plugin that extends these
templates.

```bash
npm install @battlestack/preset-nuxt4
```

## What's in here

| Template | Gets you |
| --- | --- |
| `nuxt4-minimal` | Nuxt 4 + UI v4 + Tailwind v4 only. No backend, no auth. |
| `nuxt4-fullstack` | Nuxt + UI + i18n + Postgres + Drizzle + custom auth + Mastra + Docker. |
| `nuxt4-ai` | Full stack + Mastra agents + HTTP streaming chat + Docker. RAG opt-in. |

Plus the optional features those templates offer — storage, PWA, CI
workflows, passkeys, and more.

The package ships its `templates/` payload alongside the compiled output, so
the file content that lands in a scaffolded project comes from the installed
package rather than being fetched at scaffold time.

## Why the version is in the name

Nuxt-major coexistence. A future `@battlestack/preset-nuxt5` registers
alongside this one rather than replacing it, so a single CLI install can
scaffold either.

## License

MIT © SevenLab
