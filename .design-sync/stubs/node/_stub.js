// design-sync: browser-preview stand-in for a Node builtin.
//
// The DS bundle is Tau's whole app graph, which reaches Node-only code
// (@anthropic-ai/sdk's credential loaders, src/io/*'s filesystem readers,
// src/cli/*). esbuild targets the browser and cannot resolve `node:*`, so the
// build died on them. These stubs resolve, keep the graph intact, and throw a
// named error if anything ever actually calls one — which no preview card
// does: those paths need Tauri, a filesystem, or an API key.
//
// CommonJS on purpose: a static ESM stub would have to enumerate every named
// export its importers use. CJS lets esbuild defer the lookup to call time.
module.exports = function makeStub(name) {
  const boom = (prop) => (...args) => {
    void args;
    throw new Error(
      `[design-sync] node:${name}.${String(prop)} is not available in a browser preview bundle`,
    );
  };
  const stub = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === '__esModule') return false;
      if (prop === 'default') return stub;
      if (typeof prop === 'symbol') return undefined;
      return boom(prop);
    },
    apply() {
      throw new Error(`[design-sync] node:${name} is not callable in a browser preview bundle`);
    },
  });
  return stub;
};
