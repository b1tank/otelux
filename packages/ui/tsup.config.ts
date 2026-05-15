import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.tsx', 'src/workbench.css', 'src/tokens.css'],
	format: ['esm', 'cjs'],
	dts: { entry: 'src/index.tsx' },
	sourcemap: true,
	clean: true,
	target: 'es2022',
	external: ['react', 'react-dom'],
	loader: { '.css': 'copy' },
});
