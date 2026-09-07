# Command reference

battlestack has two modes, and it picks between them by looking at where you are.

**Scaffold mode** is what you get outside a battlestack project: creating a new
project, and a few project-agnostic builtins.

**Project mode** is what you get inside one, detected by walking up from the
current directory looking for a manifest. Here the commands are maintenance
commands, and the available set is built from your project's manifest, so it
reflects the features you actually installed.

```bash
battlestack --help     # help for whichever mode you are in
battlestack            # inside a project: list every command it has
```

`bstack` is an alias for `battlestack` everywhere below.

## Scaffold mode

```
battlestack [name] [template] [options]
```

```bash
battlestack my-app                                   # prompts for template + features
battlestack my-app nuxt4-fullstack                   # template given, prompts for the rest
battlestack my-app nuxt4-fullstack --pm bun -y       # fully non-interactive
battlestack my-app --disable nuxt4:storage,nuxt4:rag # opt out at scaffold time
```

### Options

| Flag | Effect |
| --- | --- |
| `-t, --template <id>` | Same as the positional template. Wins if both are given. |
| `-f, --framework <id>` | Select the framework explicitly. |
| `--pm <pm>` | Package manager for the generated project: `pnpm` (default), `bun`, `npm`. |
| `--features <a,b>` | Force-enable optional features. |
| `--disable <a,b>` | Force-disable optional features. |
| `--gateway` | Opt into the Traefik gateway and `https://<name>.battlestack.test`. |
| `--cwd <dir>` | Parent directory to create the project in. Defaults to the current one. |
| `-y, --yes` | Accept every prompt default. The flag for CI. |
| `--skip-install` | Skip the dependency install. |
| `--force` | Recreate the directory if a project of the same name is already there. |
| `--dry-run` | Print the plan and write nothing. |
| `-V, --verbose` | Per-feature progress lines and maintenance hints. |
| `-d, --debug` | Full debug logging. Implies `--verbose`. |
| `-q, --quiet` | Less output. |
| `-h, --help` | Help. |
| `--version` | Print the version. |

Two flag traps worth knowing:

- **`-v` is not `--version`.** It is short for `--volumes`, used by
  `battlestack down`. Spell out `--version`.
- **Value flags take the next token.** `--pm bun` is correct; the parser knows
  `bun` is the value and not a positional.

### Project-agnostic builtins

These work anywhere, project or not:

| Command | What it does |
| --- | --- |
| `battlestack templates` | List available templates. |
| `battlestack features` | List the feature catalog. |
| `battlestack plugins` | List loaded plugins and where each came from. |
| `battlestack skills` | List available AI-agent skills. |
| `battlestack init -t <template>` | Adopt the current directory into project mode by writing a manifest. |
| `battlestack self-update` | Update the globally-installed CLI. `--force` bypasses the release-age gate. |
| `battlestack plugin add <pkg>` | Install a plugin into the per-machine plugin store. Accepts a local path. |
| `battlestack plugin remove <pkg>` | Remove one. |
| `battlestack plugin list` | List what is in the store. |

## Project mode

### Discovery

| Command | What it does |
| --- | --- |
| `battlestack` | List every command available in this project. |
| `battlestack describe` | Running services, their ports, and gateway state. |
| `battlestack doctor` | Diagnose drift, stale features and missing config. Read-only. |
| `battlestack cleanup [old-name]` | Interactive cleanup: pull artefacts, stale records, detached Docker resources. |

### Lifecycle

| Command | What it does |
| --- | --- |
| `battlestack install` | Post-clone bootstrap: write `.env`, install dependencies, apply the schema. |
| `battlestack add <feature>` | Enable an optional feature. |
| `battlestack remove <feature>` | Disable a feature. |
| `battlestack own <path...>` | Claim a file as yours. `pull` will skip it from now on. |
| `battlestack disown <path...>` | Hand it back. `pull` manages it again. |

### Sync with upstream

| Command | What it does |
| --- | --- |
| `battlestack pull` | Re-apply template and config changes, drift-aware. |
| `battlestack upgrade` | Alias for `pull`. Named for the common case of picking up feature version bumps. |
| `battlestack bump` | Bump npm dependencies to latest. |
| `battlestack sync` | `pull`, then `bump`, then `doctor`. |

`pull` has precision flags, because overwriting a file you edited is the one
thing it must never do by accident:

| Flag | Effect |
| --- | --- |
| `--force` | Overwrite drifted files, saving each as `.battlestack/pull/<path>.bak` first. |
| `--overwrite` | Overwrite every shipped file with no artefacts kept. Confirms first if any are owned. |
| `--skills-only` | Refresh only the AI-agent skills, and nothing else. |
| `--no-skills` | Skip the AI-agent skill refresh. |
| `--no-format` | Skip the trailing formatting pass. |
| `--skip-install` | Skip the dependency install. |

See [Keeping a project current](keeping-projects-current.md) for the drift model
behind these.

### Gateway and traffic inspection

| Command | What it does |
| --- | --- |
| `battlestack gateway:up` | Start the shared Traefik gateway. One instance serves every project. |
| `battlestack gateway:down` | Stop it. |
| `battlestack gateway:status` | Its state, plus the registered routes. |
| `battlestack mitm` | Launch mitmweb for HTTPS inspection. |
| `battlestack mitm:stop` | Tear it down. |

Details in [Local development](local-development.md).

## Feature commands

Everything below comes from a feature, so a command exists in your project only
if the feature that contributes it is enabled. That is why
`battlestack --help` inside a project is the authoritative list, not this page.

### Development, from `nuxt4:scaffold`

| Command | What it does |
| --- | --- |
| `battlestack dev` | Start the Nuxt dev server. On a project with a database, starts Postgres and applies the schema first. |
| `battlestack build` | Build for production. |
| `battlestack preview` | Preview the production build. |
| `battlestack prepare` | `nuxt prepare`, to regenerate types. |

### Testing, from `nuxt4:vitest`

| Command | What it does |
| --- | --- |
| `battlestack test` | Run Vitest. Warns when the dev server is down, since the end-to-end tests need it. |

### Auth, from `nuxt4:auth`

| Command | What it does |
| --- | --- |
| `battlestack login [email]` | Open a browser signed in as the seed admin, or as `email`. Dev only. |
| `battlestack uli [email]` | Alias for `login`. |

### Database, from `nuxt4:database`

| Command | What it does |
| --- | --- |
| `battlestack up` | Alias for `db:up`. |
| `battlestack down` | Alias for `db:down`. `-v` also drops the volumes. |
| `battlestack db:up` | Start Postgres and apply the schema. |
| `battlestack db:down` | Stop Postgres. `-v` drops the volumes. |
| `battlestack db:logs` | Tail the Postgres logs. |
| `battlestack db:psql` | Open a psql shell. |
| `battlestack db:push` | `drizzle-kit push`: apply the schema directly. Runs `extensions/*.sql` first. |
| `battlestack db:generate` | `drizzle-kit generate`: create a migration from schema changes. |
| `battlestack db:migrate` | `drizzle-kit migrate`: apply migrations. |
| `battlestack db:studio` | Drizzle Studio, in the browser. |
| `battlestack db:seed` | Run all seeds. Idempotent, and ensures Postgres and the schema first. |
| `battlestack db:fresh` | Drop the Postgres volume and re-push the schema. `--seed` also seeds; `--force` skips the prompt. |

`db:push` versus `db:generate` plus `db:migrate`: push is for iterating on a
schema nobody else has, migrations are for a schema that is deployed somewhere.
Migrations track what has already been applied, so re-running one is a no-op
rather than a second attempt at the same change.

`db:fresh` destroys data. It asks first unless you pass `--force`.

### Production, from `shared:docker`

| Command | What it does |
| --- | --- |
| `battlestack prod` | Build the production image and start the stack. |
| `battlestack production` | Alias for `prod`. |
| `battlestack prod:up` | Start the stack without rebuilding. |
| `battlestack prod:down` | Stop it. |
| `battlestack prod:build` | Build the image without running it. |
| `battlestack prod:logs` | Tail the app logs. |
| `battlestack prod:ps` | Stack status. |

See [Deployment](deployment.md).

### AI, from `nuxt4:mastra`

| Command | What it does |
| --- | --- |
| `battlestack mastra:studio` | Start Mastra Studio. Dev only. |

### Supply chain, from `shared:package-policy`

| Command | What it does |
| --- | --- |
| `battlestack policy:status` | Show release-age policy status. |
| `battlestack policy:tick` | Force a release-age ramp check. |

## Plugin commands

A plugin can contribute its own commands, and they appear in `--help` grouped
under the plugin that owns them. Built-in names win a collision, so a plugin can
never shadow `battlestack dev`.
