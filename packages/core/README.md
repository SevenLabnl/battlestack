# @battlestack/core

The plugin SDK behind [`battlestack`](https://www.npmjs.com/package/battlestack),
a plugin-based scaffolding CLI for Nuxt 4: types, registries, and the plugin
loader.

You need this package if you are **writing a battlestack plugin**. If you just
want to scaffold an app, install `battlestack` instead — it depends on this
one already.

```bash
npm install @battlestack/core
```

## What a plugin can do

A plugin registers frameworks, templates and features into sealed registries.
Ids are fully qualified with the plugin's name, so two plugins can ship a
feature called `storage` without colliding.

`extendTemplate` lets a plugin inject files and workflows into a template it
does not own — which is how a private plugin adds its own deployment surface
to the public `nuxt4-fullstack` template without the public preset knowing it
exists.

Registries are sealed after load: a plugin cannot mutate another plugin's
contributions after the fact.

## Stability

This is a `0.x` package and the plugin API may change between minor versions.
Pin it if you depend on it.

Architecture notes and the full plugin authoring guide:
<https://github.com/SevenLabnl/battlestack>

## License

MIT © SevenLab
