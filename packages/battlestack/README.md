# battlestack

battlestack is a plugin-based scaffolding CLI for Nuxt 4. Answer a few
prompts and it hands you a running app — not a folder of TODOs you still
have to wire together.

```bash
npx battlestack@latest my-app
```

`pnpm dlx battlestack@latest my-app` and `bunx battlestack@latest my-app` do
the same thing. Requires Node >=24.

This package is a thin launcher: it exists so the unscoped `npx battlestack`
command resolves. The implementation lives in
[`@battlestack/cli`](https://www.npmjs.com/package/@battlestack/cli) — see
that package (or the [repository](https://github.com/SevenLabnl/battlestack))
for full documentation, templates, and options. The two are published
together in version lockstep; installing or updating `battlestack` always
gives you the matching CLI.
