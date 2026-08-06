import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { type SqlExecution, observeDatabase } from './queryObserver.js';

describe('SQLite execution observer', () => {
	it('records executions and parameters without counting preparation', () => {
		const raw = new DatabaseSync(':memory:');
		const executions: SqlExecution[] = [];
		const database = observeDatabase(raw, (execution) => executions.push(execution));
		database.exec('CREATE TABLE values_table (value INTEGER NOT NULL)');
		executions.length = 0;
		const insert = database.prepare('INSERT INTO values_table (value) VALUES (?)');
		expect(executions).toEqual([]);

		insert.run(42);
		const select = database.prepare('SELECT value FROM values_table WHERE value = ?');
		select.setReadBigInts(true);
		expect(select.get(42)).toEqual({ value: 42n });

		expect(executions).toEqual([
			{ kind: 'run', sql: 'INSERT INTO values_table (value) VALUES (?)', parameters: [42] },
			{ kind: 'get', sql: 'SELECT value FROM values_table WHERE value = ?', parameters: [42] },
		]);
		database.close();
	});
});
