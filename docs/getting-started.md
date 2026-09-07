# Getting started

This walks through one project from nothing to logged in. It assumes Node 24+
and, if you pick a template with a database, a running Docker. See
[Requirements](requirements.md) if you are not sure.

## 1. Scaffold

```bash
npx battlestack@latest my-app
```

battlestack asks which template you want and which optional features to include,
then writes the project and installs its dependencies. Expect a few minutes.
Most of that is the dependency install, not the scaffold.

Before it writes anything it prints a preflight list: Node version, package
manager, and Docker if the template needs one. If a required check fails it
stops there, so a missing Docker never leaves you with a half-written project.

To skip the questions entirely, name the template and pass `--yes`:

```bash
npx battlestack@latest my-app nuxt4-fullstack --yes
```

`--yes` accepts every prompt default, which makes it the right flag for CI and
for repeat scaffolds.

Want to see what would happen without writing anything?

```bash
npx battlestack@latest my-app nuxt4-fullstack --dry-run
```

Not sure which template to pick? [Templates](templates.md) compares them. Short
version: `nuxt4-minimal` for a well-configured Nuxt app, `nuxt4-fullstack` when
you know you need users and a database, `nuxt4-ai` when the product is built
around agents. Nothing is a dead end, because `battlestack add` pulls in more
later.

## 2. Start it

```bash
cd my-app
battlestack dev
```

On a template with a database this does more than start Nuxt. It brings up
Postgres, applies the schema, and only then starts the dev server, so there is
no separate migrate step on a fresh project.

Open the URL it prints. If you have [mkcert](requirements.md#mkcert-optional)
installed and the gateway running, that is
`https://my-app.battlestack.test`. Otherwise it is a localhost port derived from
the project name.

Leave this running. Use a second terminal for everything below.

## 3. Log in

Templates with auth seed an admin user. Rather than hunting for its password:

```bash
battlestack login
```

That opens your browser already signed in as the seed admin. It is dev-only and
refuses to run against a production host. `battlestack uli` is a shorter alias,
and you can pass an email to log in as somebody else:

```bash
battlestack login someone@example.com
```

## 4. Look around

```bash
battlestack
```

With no arguments, this lists every command available in *this* project, built
from its manifest. The list reflects what you installed, so a project without a
database has no `db:*` commands.

```bash
battlestack describe
```

Shows the running services, their ports, and gateway state. This is the fastest
answer to "what is actually up right now, and on which port".

## 5. Make a change

The generated project is an ordinary Nuxt 4 app. Edit `app/pages/index.vue` and
the dev server reloads.

Some pointers into what was generated:

| Looking for | Where |
| --- | --- |
| Pages and components | `app/` |
| API routes | `server/api/` |
| Database schema | `server/database/schema/` |
| Mastra agents | `server/mastra/agents/` |
| Environment | `.env`, generated from the features you enabled |
| Conventions, for you and for your AI agent | `AGENTS.md` |

`AGENTS.md` is generated from the features you actually enabled rather than
copied from a static template, and `CLAUDE.md` is a one-line pointer at it, so
there is one source rather than two documents drifting apart.

## 6. Change the schema

On a template with a database:

```bash
battlestack db:generate    # create a migration from your schema changes
battlestack db:migrate     # apply it
```

`battlestack db:push` skips the migration file and pushes the schema directly,
which is what you want while iterating early. `battlestack db:studio` opens
Drizzle Studio in the browser, and `battlestack db:psql` drops you into a psql
shell.

## 7. Test and build

```bash
battlestack test     # vitest
battlestack build    # production build
```

Some end-to-end tests need the dev server up. `battlestack test` warns when it
is not.

## 8. Stop

```bash
battlestack down
```

Stops the services and leaves your data alone. Add `-v` to drop the volumes as
well, which resets the database to empty.

## Where to go next

- [Command reference](commands.md) for the full surface.
- [Features](features.md) to add something you skipped.
- [Local development](local-development.md) for the gateway, HTTPS hostnames,
  mail catching and traffic inspection.
- [Keeping a project current](keeping-projects-current.md) for pulling upstream
  fixes into this project later.
- [Deployment](deployment.md) when it is time to ship.

## Working on a project somebody else scaffolded

Cloned a battlestack project rather than creating one? Do not run the scaffold.
Run the post-clone bootstrap:

```bash
git clone <repo> && cd <repo>
battlestack install
```

That writes `.env`, installs dependencies, and applies the schema. Then
`battlestack dev` as usual.

## Adopting an existing project

Already have a Nuxt project and want battlestack to manage it?

```bash
battlestack init -t nuxt4-fullstack
```

This adopts the current directory into project mode by writing a manifest. From
then on the maintenance commands work against it.
