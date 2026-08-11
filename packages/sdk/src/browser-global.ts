declare global {
  var __PPDOCLAYOUT_SCRIPT_URL__: string | undefined;
}

if (typeof document === "object" && document.currentScript instanceof HTMLScriptElement) {
  globalThis.__PPDOCLAYOUT_SCRIPT_URL__ = document.currentScript.src;
}

export * from "./index";
