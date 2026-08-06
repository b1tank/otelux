import type { DatabaseSync, StatementSync } from 'node:sqlite';

export type SqlExecutionKind = 'all' | 'exec' | 'get' | 'iterate' | 'run';

export interface SqlExecution {
	readonly kind: SqlExecutionKind;
	readonly sql: string;
	readonly parameters: readonly unknown[];
}

export type SqlExecutionObserver = (execution: SqlExecution) => void;

const EXECUTION_METHODS = new Set<SqlExecutionKind>(['all', 'get', 'iterate', 'run']);

/**
 * Add execution observation without changing the native SQLite objects seen by
 * storage code. Constructor-time preparation is intentionally not reported;
 * one event means one statement execution (or one explicit `DatabaseSync.exec`).
 */
export function observeDatabase(
	database: DatabaseSync,
	observer: SqlExecutionObserver,
): DatabaseSync {
	return new Proxy(database, {
		get(target, property) {
			if (property === 'prepare') {
				return (sql: string): StatementSync => observeStatement(target.prepare(sql), sql, observer);
			}
			if (property === 'exec') {
				return (sql: string): void => {
					observer({ kind: 'exec', sql, parameters: [] });
					target.exec(sql);
				};
			}
			const value = Reflect.get(target, property, target) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as DatabaseSync;
}

function observeStatement(
	statement: StatementSync,
	sql: string,
	observer: SqlExecutionObserver,
): StatementSync {
	return new Proxy(statement, {
		get(target, property) {
			const value = Reflect.get(target, property, target) as unknown;
			if (typeof property === 'string' && EXECUTION_METHODS.has(property as SqlExecutionKind)) {
				return (...parameters: unknown[]): unknown => {
					observer({ kind: property as SqlExecutionKind, sql, parameters });
					return (value as (...args: unknown[]) => unknown).apply(target, parameters);
				};
			}
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as StatementSync;
}
