import { OTeluxLogo, XIcon } from '@otelux/ui';
import { type JSX, useEffect, useRef } from 'react';

export interface AboutRuntimeInfo {
	readonly electron: string;
	readonly chromium: string;
	readonly node: string;
	readonly platform: string;
}

interface AboutModalProps {
	readonly version: string;
	readonly runtime: AboutRuntimeInfo;
	readonly onClose: () => void;
}

/** Build and runtime diagnostics, following the desktop proxy's About surface. */
export function AboutModal({ version, runtime, onClose }: AboutModalProps): JSX.Element {
	const okRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		okRef.current?.focus();
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			previouslyFocused?.focus();
		};
	}, [onClose]);

	return (
		<div className="modal-backdrop">
			<button
				type="button"
				className="modal-backdrop__hit"
				aria-label="Close About OTelux"
				onClick={onClose}
			/>
			<dialog
				open
				className="about-modal"
				aria-labelledby="about-modal-title"
				aria-describedby="about-modal-subtitle"
			>
				<header className="about-modal__header">
					<div className="about-modal__brand">
						<OTeluxLogo size={42} />
						<div>
							<h2 id="about-modal-title">OTelux</h2>
							<p id="about-modal-subtitle">Local-first OpenTelemetry workbench</p>
						</div>
					</div>
					<button
						type="button"
						className="about-modal__close"
						aria-label="Close About OTelux"
						onClick={onClose}
					>
						<XIcon size={17} />
					</button>
				</header>
				<dl className="about-modal__details">
					<DiagnosticRow label="Version" value={version} testId="about-version" />
					<DiagnosticRow label="Electron" value={runtime.electron} />
					<DiagnosticRow label="Chromium" value={runtime.chromium} />
					<DiagnosticRow label="Node.js" value={runtime.node} />
					<DiagnosticRow label="Platform" value={runtime.platform} />
				</dl>
				<footer className="about-modal__footer">
					<button ref={okRef} type="button" className="about-modal__ok" onClick={onClose}>
						OK
					</button>
				</footer>
			</dialog>
		</div>
	);
}

function DiagnosticRow(props: {
	readonly label: string;
	readonly value: string;
	readonly testId?: string;
}): JSX.Element {
	return (
		<div className="about-modal__row">
			<dt>{props.label}</dt>
			<dd {...(props.testId !== undefined ? { 'data-testid': props.testId } : {})}>{props.value}</dd>
		</div>
	);
}
