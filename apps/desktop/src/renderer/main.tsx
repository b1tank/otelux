import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
import '@otelux/ui/workbench.css';

const container = document.getElementById('root');
if (!container) {
	throw new Error('OTelux: #root element missing from index.html');
}

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
