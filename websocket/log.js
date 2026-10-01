// Per-connection WebSocket logging, off by default. The connect/close and
// per-publish paths run on every socket and every comment event, so leaving
// them unconditional floods production logs (and costs a JSON-ish object per
// event). Set WS_LOG=1 to turn them back on when debugging locally.
const enabled = process.env.WS_LOG === "1";

export function wsLog(...args) {
  if (enabled) console.log(...args);
}

// Failures stay unconditional: they are rare and are the reason to read logs.
export function wsWarn(...args) {
  console.warn(...args);
}
