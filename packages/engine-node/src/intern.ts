import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { InstrumentationScope, Resource } from '@otelux/types';
import { encodeAttributes } from './attributes.js';
import { serviceNameOf, sourceNameOf } from './resource.js';

/**
 * Interns resources and scopes: identical bags collapse to one row shared by
 * every span/log/metric that carries them. A chatty exporter repeats the same
 * resource on every export, so this keeps the fact tables narrow (an integer
 * FK instead of a duplicated JSON blob per row) and lets `service.name` /
 * meter filters resolve against a tiny dimension table.
 *
 * Identity is the canonical (sorted-key) JSON of the bag. Resources and scopes
 * are small, so the canonical string doubles as the unique key — no hashing,
 * hence no collision risk. A process-lifetime in-memory cache avoids a DB
 * round-trip for the common case of a handful of distinct resources/scopes.
 */
export class Interner {
	private readonly resourceCache = new Map<string, number>();
	private readonly scopeCache = new Map<string, number>();
	private readonly insertResource: StatementSync;
	private readonly selectResource: StatementSync;
	private readonly insertScope: StatementSync;
	private readonly selectScope: StatementSync;

	constructor(db: DatabaseSync) {
		this.insertResource = db.prepare(
			'INSERT OR IGNORE INTO resources (hash, service_name, source_name, attributes) VALUES (?, ?, ?, ?)',
		);
		this.selectResource = db.prepare('SELECT id FROM resources WHERE hash = ?');
		this.insertScope = db.prepare(
			'INSERT OR IGNORE INTO scopes (hash, name, version, attributes) VALUES (?, ?, ?, ?)',
		);
		this.selectScope = db.prepare('SELECT id FROM scopes WHERE hash = ?');
	}

	/**
	 * Drop the in-memory hash→id caches. Must be called whenever the underlying
	 * `resources`/`scopes` rows are deleted (e.g. clearing the store): a stale
	 * cache would otherwise hand out ids for rows that no longer exist, producing
	 * dangling foreign keys on the next write.
	 */
	reset(): void {
		this.resourceCache.clear();
		this.scopeCache.clear();
	}

	internResource(resource: Resource): number {
		const serviceName = serviceNameOf(resource);
		const sourceName = sourceNameOf(resource);
		const hash = canonicalJson({ service: serviceName, attributes: resource.attributes });
		const cached = this.resourceCache.get(hash);
		if (cached !== undefined) {
			return cached;
		}
		this.insertResource.run(hash, serviceName, sourceName, encodeAttributes(resource.attributes));
		const row = this.selectResource.get(hash) as { id: number };
		this.resourceCache.set(hash, row.id);
		return row.id;
	}

	internScope(scope: InstrumentationScope): number {
		const hash = canonicalJson({
			name: scope.name,
			version: scope.version ?? null,
			attributes: scope.attributes ?? {},
		});
		const cached = this.scopeCache.get(hash);
		if (cached !== undefined) {
			return cached;
		}
		this.insertScope.run(
			hash,
			scope.name,
			scope.version ?? null,
			scope.attributes ? encodeAttributes(scope.attributes) : null,
		);
		const row = this.selectScope.get(hash) as { id: number };
		this.scopeCache.set(hash, row.id);
		return row.id;
	}
}

/**
 * Deterministic JSON with object keys sorted at every level, so two bags that
 * differ only in key order produce the same identity string. bigint values
 * are tagged so they survive as distinct from the same numeric double.
 */
function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (typeof value === 'bigint') {
		return { $bigint: value.toString() };
	}
	if (Array.isArray(value)) {
		return value.map(sortKeys);
	}
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			out[key] = sortKeys((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}
