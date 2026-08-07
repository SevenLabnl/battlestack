// Stands in for a stale/corrupt plugin in the store: default export exists
// but is not a battlestack plugin (no `register` function). `loadPlugins`
// must skip this when discovered (non-required) and throw when explicitly
// configured (required).
export default { notAPlugin: true }
