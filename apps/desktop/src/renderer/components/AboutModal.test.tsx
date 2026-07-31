// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutModal } from './AboutModal.js';

afterEach(cleanup);

const runtime = {
	electron: '39.2.7',
	chromium: '142.0.7444.235',
	node: '22.21.1',
	platform: 'linux x64',
};

describe('AboutModal', () => {
	it('shows the packaged version and runtime diagnostics', () => {
		render(<AboutModal version="0.1.6" runtime={runtime} onClose={() => {}} />);

		expect(screen.getByRole('heading', { name: 'OTelux' })).toBeTruthy();
		expect(screen.getByTestId('about-version').textContent).toBe('0.1.6');
		expect(screen.getByText('39.2.7')).toBeTruthy();
		expect(screen.getByText('142.0.7444.235')).toBeTruthy();
		expect(screen.getByText('22.21.1')).toBeTruthy();
		expect(screen.getByText('linux x64')).toBeTruthy();
	});

	it('closes from the OK button and Escape', () => {
		const onClose = vi.fn();
		render(<AboutModal version="0.1.6" runtime={runtime} onClose={onClose} />);

		fireEvent.click(screen.getByRole('button', { name: 'OK' }));
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
