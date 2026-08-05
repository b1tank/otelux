/**
 * @vitest-environment jsdom
 */

import { DEFAULT_SETTINGS } from '@otelux/protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal.js';

function renderSettings(onClose = vi.fn(), includeStoragePath = false) {
	const onSave = vi.fn(() => Promise.resolve({ ok: false as const, error: 'unused' }));
	const result = render(
		<SettingsModal
			settings={DEFAULT_SETTINGS}
			{...(includeStoragePath
				? {
						storagePath: {
							activePath: '/tmp/otelux.db',
							defaultPath: '/tmp/otelux.db',
						},
					}
				: {})}
			onSave={onSave}
			onClose={onClose}
		/>,
	);
	return { ...result, onClose, onSave };
}

beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe('SettingsModal interactions', () => {
	it('switches categories by keyboard and preserves edited values', () => {
		const { container } = renderSettings();
		const connections = screen.getByRole('tab', { name: 'Connections' });
		const storage = screen.getByRole('tab', { name: 'Storage' });

		expect(screen.getAllByRole('button', { name: 'Close settings' })).toHaveLength(1);
		const backdrop = container.querySelector('.modal-backdrop__hit');
		expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
		expect(backdrop?.tagName).toBe('DIV');
		expect(backdrop?.getAttribute('tabindex')).toBeNull();
		expect(document.activeElement).toBe(connections);
		fireEvent.keyDown(connections, { key: 'ArrowDown' });
		expect(storage.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(storage);
		expect(screen.getByRole('tabpanel', { name: 'Storage' }).hidden).toBe(false);

		const maximumSize = screen.getByRole('spinbutton', {
			name: 'Maximum database size in megabytes',
		}) as HTMLInputElement;
		fireEvent.change(maximumSize, { target: { value: '256' } });
		fireEvent.click(connections);
		fireEvent.click(storage);
		expect(maximumSize.value).toBe('256');
	});

	it('states the local trust posture without adding configuration friction', () => {
		renderSettings();
		const otlp = screen.getByLabelText('OTLP receiver trust posture');
		const mcp = screen.getByLabelText('MCP server trust posture');
		expect(otlp.textContent).toContain('Local write-only · no authentication');
		expect(otlp.textContent).toContain('127.0.0.1 · browser origins blocked');
		expect(mcp.textContent).toContain('Authenticated · read-only tools');
		expect(mcp.textContent).toContain('Per-install bearer token · owner-only file');
	});

	it('reveals and focuses Storage when a hidden retention value is invalid', () => {
		const { onSave } = renderSettings();
		const connections = screen.getByRole('tab', { name: 'Connections' });
		const storage = screen.getByRole('tab', { name: 'Storage' });
		fireEvent.click(storage);
		const maximumSize = screen.getByRole('spinbutton', {
			name: 'Maximum database size in megabytes',
		}) as HTMLInputElement;
		fireEvent.change(maximumSize, { target: { value: '1.5' } });
		fireEvent.click(connections);

		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(storage.getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('tabpanel', { name: 'Storage' }).hidden).toBe(false);
		expect(document.activeElement).toBe(maximumSize);
		expect(screen.getByRole('alert').textContent).toBe(
			'Retention size must be between 0 and 1048576 MB (0 = unlimited).',
		);
		expect(onSave).not.toHaveBeenCalled();
	});

	it('keeps the MCP port editable when the server is off', () => {
		renderSettings();
		const enabled = screen.getByRole('switch', { name: 'MCP server enabled' });
		const port = screen.getByRole('spinbutton', { name: 'MCP server port' }) as HTMLInputElement;

		fireEvent.click(enabled);

		expect(enabled.getAttribute('aria-checked')).toBe('false');
		expect(port.disabled).toBe(false);
	});

	it('announces successful database-path copying', async () => {
		renderSettings(vi.fn(), true);
		fireEvent.click(screen.getByRole('tab', { name: 'Storage' }));
		const copy = screen.getByRole('button', { name: 'Copy active database path' });

		fireEvent.click(copy);

		await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBe(copy));
	});

	it('closes from the pointer-only backdrop', () => {
		const onClose = vi.fn();
		const { container } = renderSettings(onClose);
		const backdrop = container.querySelector('.modal-backdrop__hit');
		expect(backdrop).not.toBeNull();

		fireEvent.click(backdrop as Element);

		expect(onClose).toHaveBeenCalledOnce();
	});

	it('wraps focus around controls in the selected category', () => {
		renderSettings();
		const connections = screen.getByRole('tab', { name: 'Connections' });
		const storage = screen.getByRole('tab', { name: 'Storage' });
		const save = screen.getByRole('button', { name: 'Save' });
		fireEvent.keyDown(connections, { key: 'ArrowDown' });

		fireEvent.keyDown(storage, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(save);
		fireEvent.keyDown(save, { key: 'Tab' });
		expect(document.activeElement).toBe(storage);
	});

	it('restores focus to the opener after Escape closes and unmounts the dialog', () => {
		const opener = document.createElement('button');
		opener.textContent = 'Open settings';
		document.body.append(opener);
		opener.focus();
		const onClose = vi.fn();
		const { unmount } = renderSettings(onClose);

		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledOnce();
		unmount();
		expect(document.activeElement).toBe(opener);
		opener.remove();
	});
});
