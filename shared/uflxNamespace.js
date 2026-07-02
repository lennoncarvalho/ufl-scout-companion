// Namespace bootstrap for all classic (non-module) content-script + options-page files.
// Runs first per the manifest content_scripts load order; idempotent.
globalThis.uflx = globalThis.uflx || {};
