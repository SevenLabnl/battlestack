# battlestack documentation

battlestack is a scaffolding CLI for Nuxt 4. It assembles a project from
versioned features instead of copying a frozen template, and it keeps helping
after the scaffold: a generated project records which feature versions produced
which files, so upstream fixes can be pulled into a project you created months
ago.

New here? Read [Requirements](requirements.md), then
[Getting started](getting-started.md). Those two cover the whole happy path.

## Setting up

| Page | What it answers |
| --- | --- |
| [Requirements](requirements.md) | Which software you need installed, per operating system, and which parts are optional. |
| [Installation](installation.md) | Running battlestack without installing it, installing it globally, prereleases, updating. |
| [Getting started](getting-started.md) | Scaffold, start, and log into your first project. |

## Using it

| Page | What it answers |
| --- | --- |
| [Templates](templates.md) | The three starting points and how to choose between them. |
| [Features](features.md) | The full feature catalog, and adding or removing one after scaffolding. |
| [Command reference](commands.md) | Every command and flag, in both scaffold mode and project mode. |
| [Configuration](configuration.md) | `.env`, the port scheme, and the environment variables each feature adds. |
| [Local development](local-development.md) | Services, the shared gateway and HTTPS hostnames, mail, database tooling, traffic inspection. |
| [Plugins](plugins.md) | Extending battlestack: features, templates, commands, and how plugins are discovered and loaded. |

## Living with it

| Page | What it answers |
| --- | --- |
| [Keeping a project current](keeping-projects-current.md) | `pull`, `bump`, `sync`, `doctor`, drift, and file ownership. |
| [Deployment](deployment.md) | The production image, the compose stack, and the health endpoint. |
| [Troubleshooting](troubleshooting.md) | Symptoms, causes, fixes. |

## Internals and contributing

| Page | What it answers |
| --- | --- |
| [Architecture](architecture.md) | Internals of the plugin system: the package split, how ids are resolved, feature stages and execution order. [Plugins](plugins.md) is the practical guide; this is the reference behind it. |
| [Contributing](../CONTRIBUTING.md) | Local development of battlestack itself, and what CI verifies. |
| [Releasing](releasing.md) | How a release is cut. |
| [Code of conduct](../CODE_OF_CONDUCT.md) | What we expect of each other. |
| [Security policy](../SECURITY.md) | Reporting a vulnerability, and what is in scope. |

## Getting help

Open an issue on the [repository](https://github.com/SevenLabnl/battlestack/issues),
or reach SevenLab at [hello@sevenlab.ai](mailto:hello@sevenlab.ai).

Found a security problem? Email
[security@sevenlab.nl](mailto:security@sevenlab.nl) rather than opening an issue.
[SECURITY.md](../SECURITY.md) covers what is in scope.
