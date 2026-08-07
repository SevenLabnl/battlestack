# @battlestack/tui

The shared terminal-UI layer for
[`battlestack`](https://www.npmjs.com/package/battlestack): banner, spinner,
colors, prompts, and the scaffold-selection helpers used by both the CLI and
its presets.

Install `battlestack` to use it — it depends on this package already. Depend
on this one directly only if you are writing a plugin that prompts the user
and wants to match the CLI's look and its non-interactive behaviour.

```bash
npm install @battlestack/tui
```

## Non-interactive behaviour

Every prompt helper here honours `--yes`, `CI`, and the other
non-interactive signals through one shared check, so a plugin that uses these
helpers keeps working unattended in CI instead of hanging on a prompt nobody
is there to answer. That consistency is the main reason to reach for this
package rather than calling a prompt library directly.

## License

MIT © SevenLab
