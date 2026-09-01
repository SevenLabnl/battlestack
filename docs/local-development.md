# Local development

Everything below runs on your machine, in containers battlestack manages. You do
not install Postgres, Redis, a mail server or an object store yourself.

## Starting and stopping

```bash
battlestack dev      # dev server, plus whatever it depends on
battlestack up       # just the services, no dev server
battlestack down     # stop the services
battlestack down -v  # stop them and drop the volumes
```

`battlestack dev` on a project with a database starts Postgres and applies the
schema before the dev server comes up, so a fresh clone has no separate migrate
step.

`down -v` deletes your local data. That is sometimes exactly what you want, but
it is not reversible.

```bash
battlestack describe
```

Running services, their ports, and gateway state. The fastest answer to "what is
up right now and where".

## The gateway and HTTPS hostnames

By default `battlestack dev` serves on a localhost port. With
[mkcert](requirements.md#mkcert-optional) installed you can have something nicer:
a single shared Traefik proxy that serves every project at
`https://<project>.battlestack.test`, with certificates your machine trusts.

```bash
battlestack gateway:up      # start it (one instance serves every project)
battlestack gateway:status  # state, plus the registered routes
battlestack gateway:down    # stop it
```

The gateway is a singleton. Starting it from one project serves all of them, and
you do not run one per project.

To opt a new project in at scaffold time:

```bash
npx battlestack@latest my-app --gateway
```

What it buys you beyond nicer URLs:

- Real HTTPS locally, which matters for anything that behaves differently on a
  secure origin: passkeys, service workers, secure cookies.
- Stable hostnames instead of remembering which port belongs to which project.
- Several projects reachable at once without port juggling.

The first run calls `mkcert -install` once to trust the local certificate
authority, records that it did, and does not repeat it.

### Per-platform behaviour

| Host | HTTPS | Hosts file |
| --- | --- | --- |
| macOS | Yes | Written for you, with `sudo`. |
| Windows | Yes | Written for you, via an elevation prompt. |
| Linux | Yes | Not automated. Add `<project>.battlestack.test` to `/etc/hosts` yourself. |
| WSL2 | Not available | Use the localhost port that `battlestack dev` prints. |

Entries battlestack adds to your hosts file are marked as managed by it, so
cleanup can find and remove exactly its own lines and nothing else.

Without mkcert nothing breaks. The gateway step is skipped with a note telling
you why, and `battlestack dev` falls back to a plain port.

## Inspecting HTTPS traffic

```bash
battlestack mitm       # launch mitmweb in front of the gateway
battlestack mitm:stop  # tear it down
```

This puts [mitmproxy](https://mitmproxy.org) in front of the gateway so you can
read decrypted request and response bodies in a browser UI. It is the tool for
"the webhook says it sent something, and my handler disagrees".

mitmproxy runs in a container, so there is nothing to install. It requires the
gateway and TLS to be working, and the web UI is password-protected with a
per-run token rather than left open.

## Mail

Projects with auth send mail: verification, password recovery. Locally that goes
to [Mailpit](https://mailpit.axllent.org) rather than to the internet, so a
verification mail to a made-up address is fine.

Mailpit runs as part of `battlestack up`. `battlestack describe` prints its web
UI port (the `MAIL_UI_PORT` in `.env`); open that in a browser to read anything
the app has sent.

Nothing you send locally can reach a real inbox, which is the point.

## Database work

```bash
battlestack db:studio    # Drizzle Studio in the browser
battlestack db:psql      # a psql shell
battlestack db:logs      # tail the Postgres logs
```

Changing the schema:

```bash
battlestack db:push       # apply the schema directly, no migration file
battlestack db:generate   # create a migration from your changes
battlestack db:migrate    # apply migrations
```

Use `db:push` while iterating on a schema nobody else has. Switch to
`generate` plus `migrate` once the schema is deployed somewhere, because
migrations track what has already been applied and re-running one is a no-op
rather than a second attempt at the same change.

Seeding and resetting:

```bash
battlestack db:seed             # idempotent; ensures Postgres and schema first
battlestack db:fresh            # drop the volume, re-push the schema
battlestack db:fresh --seed     # and seed it
battlestack db:fresh --force    # skip the confirmation
```

`db:fresh` destroys data and asks first unless you pass `--force`.

## Logging in

```bash
battlestack login                     # as the seeded admin
battlestack login other@example.com   # as somebody else
```

This opens your browser already signed in, so you never look up a seeded
password. `uli` is a shorter alias.

It is locked down in two independent ways rather than one: it refuses to run
unless the environment is non-production, *and* the request host has to resolve
to a local hostname. A dev-tagged server exposed through a tunnel still refuses.
Tokens are short-lived.

On a machine without a browser, `--no-browser` prints the URL instead of opening
it.

## Working on AI features

```bash
battlestack mastra:studio
```

Mastra Studio, for exercising agents outside your app's UI. Dev only.

The agent itself lives in `server/mastra/agents/default.ts`. That is where the
system prompt, model and tools are, and editing it is the intended way to change
behaviour.

Chat is at `/chat`, driven by a `useChatAgent()` composable. The default
transport is a Nitro WebSocket handler at `/_ws`.

## Running several projects at once

This is a designed-for case, not a coincidence. Ports are derived per project
and frozen into `.env`, and the gateway is shared, so:

```bash
cd ~/work/project-a && battlestack dev    # https://project-a.battlestack.test
cd ~/work/project-b && battlestack dev    # https://project-b.battlestack.test
```

Both work at once. Each has its own Postgres container and volume.

## Cleaning up

```bash
battlestack cleanup
```

Interactive, and worth knowing about before you go hunting manually. It finds
leftovers: `pull` artefacts (`*.battlestack.bak`, `*.battlestack.patch`), stale
records in the manifest, and Docker resources detached from any current project.

Renamed a project directory? Pass the old name so it can reconcile what was
registered under it:

```bash
battlestack cleanup old-name
```

## Health checks locally

```
GET /api/health
```

Real output: a database ping and required-config checks, bounded by a timeout.
Useful while developing precisely because it fails when the database is down,
rather than reporting a cheerful 200.

## Debugging the CLI itself

```bash
battlestack dev -V        # per-feature progress lines and maintenance hints
battlestack dev -d        # full debug logging
battlestack doctor        # what battlestack thinks is wrong, read-only
```

If a command behaves unexpectedly, `battlestack doctor` first and `-d` second.
Doctor is read-only, so it is always safe.
