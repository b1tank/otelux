/**
 * @otelux/engine — pure-TS ingest, query, layout, live subscription.
 *
 * The engine is the only consumer of `Storage`. Storage is intentionally
 * narrow: span writes + indexed reads. Higher-level concerns
 * (subscriptions, Trace computation, waterfall layout) live in the engine
 * so every storage backend gets them for free.
 */

export {
	createEngine,
	type Engine,
	type EngineOptions,
	OTELUX_ENGINE_VERSION,
} from './engine.js';
export { createMemoryStorage, type Storage } from './storage.js';
export {
	computeWaterfallLayout,
	type WaterfallLayout,
	type WaterfallRow,
} from './layout.js';
export { traceFromSpans } from './trace.js';
