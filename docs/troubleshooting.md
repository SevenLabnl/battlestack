# Troubleshooting

Start here, in this order. The first two answer most things.

```bash
battlestack doctor      # drift, stale features, missing config, environment
battlestack describe    # what is running, on which ports, gateway state
```

`doctor` is read-only, so there is never a reason not to run it first.

For anything that behaves unexpectedly, re-run it with `-d` for full debug
logging.

## Installing and scaffolding

### `node: command not found`, or `node -v` prints below 24

Node 24 is the minimum. Install a newer Node from
[nodejs.org](https://nodejs.org) or a version manager.

Node 25 dropped bundled Corepack, so a freshly installed Node often has npm and
nothing else. That is fine: scaffold with `npx` and pass `--pm npm`.

### `pnpm not found`

Either install it, or do not use it:

```bash
npm i -g pnpm
```

```bash
npx battlestack@latest my-app --pm npm
```

You never need pnpm to *scaffold*. It is only needed when the generated project
is going to use pnpm, which is the default.

### A warning that pnpm is out of date

Non-blocking. battlestack is tested against a specific pnpm version and says so
when yours is older. `pnpm self-update` clears it.

### `npx` runs an old version

`npx` can reuse a cached copy. Always name the tag:

```bash
npx battlestack@latest my-app
```

### The scaffold stopped partway

Re-run the same command with `--force` to recreate the directory from scratch.
Nothing outside that directory is touched.

```bash
npx battlestack@latest my-app nuxt4-fullstack --force
```

If it fails in the same place, re-run with `-d` and include that output in an
issue.

### A directory already exists

`--force` recreates it. Without the flag, battlestack refuses rather than writing
into a directory it did not create.

### A prompt hangs in CI

Pass `--yes`. It accepts every prompt default, including feature-specific
follow-up questions.

## Docker and databases

### A Docker error, or Postgres will not start

Docker has to be installed **and running**. Check the daemon yourself:

```bash
docker ps
```

A table, even an empty one, means it is fine. An error means the daemon is down:
open Docker Desktop or start OrbStack.

battlestack checks the binary and the daemon separately, and a preflight failure
naming the daemon specifically means the binary is there but nothing is
listening.

### A port is already in use

Each project derives its ports from its name, probes them, and freezes the
working set into `.env` on first run, so two battlestack projects never collide.

If something outside battlestack holds a port, edit the relevant `*_PORT` in
`.env` and restart. Preflight names what is holding a port where it can tell.

```bash
battlestack describe    # what this project expects to use
```

If the holder is another battlestack stack:

```bash
battlestack down
battlestack prod:down
```

### The database is up but the schema is missing

```bash
battlestack db:push
```

`battlestack dev` normally does this for you. If you started the services alone
with `battlestack up`, the schema step did not run.

### A migration seems to run twice

It does not. Migrations track what is already applied, so re-running is a no-op.
Where several replicas start at once, an advisory lock ensures exactly one
applies each migration and the rest wait.

If you genuinely see a change applied twice, that is a bug worth an issue.

### I need to start the database over

```bash
battlestack db:fresh          # drop the volume, re-push the schema
battlestack db:fresh --seed   # and seed it
```

This destroys data and asks first unless you pass `--force`.

### Cannot connect to Postgres from a tool outside the project

Use the host port from `.env` (`DB_PORT`), not 5432. Ports are per project.
`battlestack describe` prints them.

## Auth and login

### `battlestack login` does nothing, or refuses

It is dev-only by design, and guarded twice over: the environment must be
non-production **and** the request host must resolve to a local hostname. A
dev-tagged server reached through a tunnel still refuses. That is intended.

On a machine without a browser, `--no-browser` prints the URL instead.

### Login says the session secret is too short

`NUXT_SESSION_PASSWORD` must be at least 32 characters. If it still holds a
placeholder, `battlestack pull` replaces it with a generated value, or set one
yourself and restart.

### Passkeys do not work

Passkeys need a secure origin and a matching relying-party id.

- Locally, use the gateway so you are on real HTTPS. See
  [Local development](local-development.md#the-gateway-and-https-hostnames).
- In production, `NUXT_WEBAUTHN_RP_ID` must match your actual domain. A mismatch
  fails quietly, which makes it easy to miss.

### Verification or recovery mail never arrives

Locally it is not supposed to leave your machine. It goes to the Mailpit catcher;
open its web UI on the `MAIL_UI_PORT` from `.env` to read it.
`battlestack describe` prints the port.

## Gateway and HTTPS

### `https://<project>.battlestack.test` does not resolve

Check the gateway is up:

```bash
battlestack gateway:status
```

Then, by platform:

- **macOS, Windows**: the hosts entry is written for you. If it is missing,
  `battlestack gateway:up` again and accept the elevation prompt.
- **Linux**: not automated. Add `<project>.battlestack.test` to `/etc/hosts`
  yourself.
- **WSL2**: not available. Use the localhost port `battlestack dev` prints.

### The browser warns about the certificate

mkcert's local certificate authority is not trusted yet. `battlestack gateway:up`
runs `mkcert -install` once; if it was installed after the gateway first came up,
stop and start the gateway again.

### Gateway skipped, with a note about mkcert

Expected when mkcert is not installed. Nothing is broken: `battlestack dev` falls
back to a localhost port. Install mkcert if you want the hostnames. See
[Requirements](requirements.md#mkcert-optional).

## Pull and drift

### pull says a file drifted and did not update it

Working as intended. It never overwrites your edits silently. Two files are
staged for you:

```
.battlestack/pull/<path>.new      what pull wanted to write
.battlestack/pull/<path>.patch    a diff from your version to that
```

Merge what you want and delete the artefacts, or:

```bash
battlestack pull --force    # take upstream, saving yours as .bak
```

### I keep getting drift on a file I intend to own

Say so once:

```bash
battlestack own path/to/file
```

`pull` skips it permanently after that. `battlestack disown` reverses it.

### pull did nothing at all

Then nothing changed. `pull` version-gates on feature versions: a feature whose
version has not moved is reported up to date and skipped. `battlestack doctor`
shows what it thinks the state is.

### A project never picks up a change I made to a feature

If you are developing a feature: bump the feature's `version`. Without a bump,
existing projects never see the change while new scaffolds do. See
[Plugins](plugins.md#versioning-a-feature-and-why-it-is-not-optional).

### Leftover artefact files everywhere

```bash
battlestack cleanup
```

They are gitignored, so they cannot land in a commit by accident.

## Commands and plugins

### A command is missing from `--help`

The project-mode command list is built from your manifest, so a command only
exists if the feature contributing it is enabled.

```bash
battlestack            # everything this project has
battlestack add <feature>
```

### `--version` printed something odd

`-v` is `--volumes`, not `--version`. Spell out `--version`.

### A plugin's features are not showing up

```bash
battlestack plugins    # what loaded, and from where
```

Then check the package name. A plugin **must** be named `battlestack-plugin*` or
`battlestack-preset*`, optionally scoped. A store entry that does not match is
skipped with a warning, because it can never load.

### Wrong CLI version on my PATH

```bash
battlestack --version
battlestack self-update
```

Under pnpm, `self-update` respects the release-age policy and briefly holds back
a very fresh release. `--force` takes the true latest now.

## Builds and tests

### Tests fail on end-to-end specs

Some need the dev server running. `battlestack test` warns when it is down. Start
`battlestack dev` in another terminal.

### It builds in dev and fails in the production image

That is what the local production stack is for:

```bash
battlestack prod
battlestack prod:logs
```

Usual suspects: a dev dependency used at runtime, an env var read at build time,
or something that worked under Vite and not under Nitro.

### A dependency bump was held back

Deliberate. The supply-chain release-age policy holds very fresh releases back,
because a package published minutes ago is the one most likely to be
compromised.

```bash
battlestack policy:status
```

## Cleaning up

### I renamed the project directory

```bash
battlestack cleanup old-name
```

Reconciles what was registered under the old name: Docker resources, hosts
entries, gateway routes.

### Removing everything for a project

```bash
battlestack down -v      # services and volumes
battlestack cleanup      # detached resources and artefacts
```

Then delete the directory. Hosts entries battlestack added are marked as managed
by it, so cleanup removes its own lines and leaves yours alone.

## Still stuck

Include this in an issue, and it will be answerable on the first reply:

```bash
battlestack --version
node -v
docker --version
battlestack doctor
```

Plus the command you ran with `-d`, and your OS. Report it at
[the issue tracker](https://github.com/SevenLabnl/battlestack/issues).
