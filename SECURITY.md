# Security policy

## Reporting a vulnerability

**Do not open a public issue.**

Email [security@sevenlab.ai](mailto:security@sevenlab.ai). That address reaches
the maintainers directly and is the right channel for anything security-related,
including questions about whether something counts.

<!-- GitHub private vulnerability reporting is currently disabled for this repo,
     so no advisory link is offered: /security/advisories/new is not usable by an
     outside reporter while it is off. To add it, enable "Private vulnerability
     reporting" in Settings > Code security, then offer it here alongside the
     email address. -->

Include what you have: the affected version, what an attacker can do, and the
smallest reproduction you can manage. A rough report of something real is more
useful than a polished report of something theoretical, so send it even if it is
not fully worked out.

We will acknowledge within a few working days, tell you whether we can reproduce
it, and keep you informed while we work on a fix. If we disagree that something
is a vulnerability we will explain why rather than going quiet.

You are welcome to be credited when we publish the fix. Say so, and tell us how
you want to be named.

## Supported versions

battlestack is pre-1.0. Fixes land on the latest release, and there are no
backports to older ones. If you are on an older version, updating is the fix.

```bash
battlestack self-update
```

## Scope

battlestack is a scaffolding CLI, so there are two distinct things to consider
and they are worth naming separately.

**In scope: the CLI itself.**

- Arbitrary code execution through crafted input, a template, or a plugin
- Anything that writes outside the project directory it was asked to create
- Leaking credentials from the environment, `.env`, or your npm authentication
- A flaw in the plugin loading or discovery path
- Weak generation of the secrets battlestack creates for you

**In scope: what the scaffold emits.** Generated projects are the point of this
tool, so an insecure default in emitted code is a vulnerability here, not just a
bug in your project. For example:

- A missing or wrong authentication or authorisation check in a generated route
- A generated secret with insufficient entropy, or one committed by default
- A default that exposes something publicly that should be authenticated
- Security headers or session settings that are unsafe as shipped

**Out of scope.**

- Vulnerabilities in upstream dependencies with no battlestack-specific angle.
  Report those upstream. If our version constraint is what pins you to a
  vulnerable release, that part is ours, so tell us.
- Code you wrote in your own generated project.
- Configuration you changed. If `.env` values or `nuxt.config.ts` were edited,
  say what you changed.
- Development-only conveniences behaving as documented. `battlestack login`
  signs you in without a password, gated on a non-production environment **and**
  a local request host. If you find a way past either gate, that is very much in
  scope.
- Anything requiring an attacker to already control your machine or your
  package manager.

## What battlestack does about supply chain

Worth stating, since it shapes what counts as a finding.

Generated projects carry a release-age policy for dependencies: a package
published minutes ago is the one most likely to be compromised, so brand-new
releases are held back briefly and ramp in. `battlestack policy:status` shows
where a project sits, and `battlestack bump` respects it.

`battlestack self-update` under pnpm respects the same gate. `--force` opts out
deliberately.

Plugins install into a per-machine store using your existing npm
authentication, and must be named `battlestack-plugin*` or
`battlestack-preset*` to load at all. A plugin is code that runs with your
privileges, exactly like any other dependency: install ones you trust.
