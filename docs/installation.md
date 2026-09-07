# Installation

There are two ways to run battlestack, and which you want depends on whether you
are scaffolding once or living in generated projects every day.

## Scaffolding needs no install

`npx` ships with Node, so this always fetches the newest release for that single
run and leaves nothing behind:

```bash
npx battlestack@latest my-app
```

The same works through other package managers:

```bash
pnpm dlx battlestack@latest my-app
bunx battlestack@latest my-app
```

Use `@latest` explicitly. Without it, `npx` may reuse an older copy it cached
earlier.

## For daily use, install it globally

A scaffolded project has maintenance commands (`battlestack dev`,
`battlestack pull`, `battlestack doctor`) that you run constantly. Having the
binary on your PATH is much nicer than prefixing every one with `npx`:

```bash
pnpm add -g battlestack
```

```bash
npm i -g battlestack
```

```bash
bun i -g battlestack
```

That gives you two command names for the same binary:

```bash
battlestack dev
bstack dev
```

`bstack` is a plain alias. Anything documented as `battlestack <x>` works as
`bstack <x>`.

## Verifying the install

```bash
battlestack --version
```

Note the capital: `--version` prints the version, while `-v` is short for
`--volumes` and is used by `battlestack down`. If you want the version, spell it
out.

```bash
battlestack --help
```

Outside a project this prints the scaffolding help. Inside a generated project
it prints that project's maintenance commands instead, and the list reflects the
features you actually installed rather than everything that exists.

## Trying a prerelease

Prereleases publish under the `next` dist-tag, so a plain install never picks
one up by accident:

```bash
npx battlestack@next my-app
```

```bash
pnpm add -g battlestack@next
```

## Updating the CLI

A global install can update itself:

```bash
battlestack self-update
```

Under pnpm this respects the release-age policy, which briefly holds back a
release published minutes ago. To bypass that and take the true latest right
now:

```bash
battlestack self-update --force
```

If you only ever scaffold through `npx`, there is nothing persistent to update.
`@latest` already fetches the newest release every time.

## Updating a project

Updating the CLI does not touch your existing projects, and it does not need to.
Projects are updated on their own schedule with `battlestack pull`. See
[Keeping a project current](keeping-projects-current.md).

## Uninstalling

```bash
pnpm remove -g battlestack     # or: npm rm -g battlestack
```

Generated projects are ordinary Nuxt projects. They keep working without the CLI
installed; you just lose the maintenance commands, and the underlying
`package.json` scripts remain.

## What gets installed where

battlestack publishes as five packages, and installing the unscoped
`battlestack` package pulls in the ones it needs:

| Package | Role |
| --- | --- |
| `battlestack` | The binary you run. A thin wrapper, and the `npx battlestack` entry point. |
| `@battlestack/cli` | Argument parsing, plugin loading, command dispatch. |
| `@battlestack/core` | The plugin SDK: types, registries, and the orchestrator. |
| `@battlestack/preset-nuxt4` | The Nuxt 4 preset: one framework, three templates, 39 features. |
| `@battlestack/tui` | Shared terminal UI. |

The five share one lockstep version. [architecture.md](architecture.md)
explains why the split exists.

Third-party plugins are installed per machine into a plugin store rather than
into your project, so adding a plugin does not add a dependency to the app you
ship.
