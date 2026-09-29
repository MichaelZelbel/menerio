import "@testing-library/jest-dom";

if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom has no top layer, so `:modal`, `:popover-open` and `:fullscreen` never
// match. nwsapi 2.2.27 (what an install without the lockfile resolves to; the
// lockfiles pin 2.2.23) answers them by calling element.matches() again, which
// under jsdom is nwsapi itself, and recurses until the stack overflows.
// floating-ui asks both on every Radix popover, dropdown and tooltip open
// (isTopLayer), so each open cost ~30 s and the suites that open one timed out
// under load (EditorToolbar, ContactTopicsPanel). Answer them directly.
if (typeof Element !== "undefined") {
  const nativeMatches = Element.prototype.matches;
  const TOP_LAYER = /^\s*:(modal|popover-open|fullscreen)\s*$/;
  Element.prototype.matches = function matches(this: Element, selector: string) {
    if (TOP_LAYER.test(selector)) return false;
    return nativeMatches.call(this, selector);
  };
}
