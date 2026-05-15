import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		// `globals: true` enables vitest's globals on globalThis, which
		// @testing-library/react v16 detects to install its automatic
		// per-test cleanup. Without it, DOM from prior renders leaks into
		// subsequent tests in the same file.
		globals: true,
		include: ['src/**/*.test.{ts,tsx}'],
	},
});
