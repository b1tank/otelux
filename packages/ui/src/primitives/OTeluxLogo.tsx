import type { JSX, SVGProps } from 'react';

/**
 * OTelux brand mark.
 *
 * Three horizontal arrows pointing right, with tails indenting from the
 * left and tips cascading slightly to the right. The shape reads as both:
 *   - flux / smooth flow (the data the app receives — OTel + flux)
 *   - a trace waterfall (root span on top, child spans indenting and
 *     getting shorter top-to-bottom, same visual contract as the
 *     workbench waterfall)
 *
 * The stroke uses a violet → blue gradient anchored to the same accent
 * tokens as the workbench (`--otelux-accent-2` → `--otelux-accent`), so
 * the mark stays visually consistent with the rest of the UI regardless
 * of theme. The gradient is inlined (not driven by CSS vars) because the
 * same SVG is rasterized to PNG for the packaged app icon, where CSS
 * variables aren't resolvable.
 *
 * Master copy of this artwork lives at `apps/desktop/build/icon.svg` and
 * is rasterized to PNG by `scripts/build-icons.sh`. Keep the two in sync:
 * any geometry change here should be mirrored there.
 */
export interface OTeluxLogoProps extends SVGProps<SVGSVGElement> {
	/** Pixel size; sets both width and height. Defaults to 28. */
	size?: number;
	/** Unique id suffix for the gradient `<defs>`. Required when multiple
	 * instances render on the same page to avoid `<linearGradient>` id
	 * collisions. Defaults to `'default'`. */
	idSuffix?: string;
}

export function OTeluxLogo(props: OTeluxLogoProps): JSX.Element {
	const { size = 28, idSuffix = 'default', ...rest } = props;
	const gradientId = `otelux-logo-${idSuffix}`;
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 256 256"
			fill="none"
			aria-hidden="true"
			focusable="false"
			{...rest}
		>
			<defs>
				<linearGradient
					id={gradientId}
					x1="40"
					y1="72"
					x2="216"
					y2="184"
					gradientUnits="userSpaceOnUse"
				>
					<stop offset="0%" stopColor="#bb9af7" />
					<stop offset="100%" stopColor="#7aa2f7" />
				</linearGradient>
			</defs>
			<g
				fill="none"
				stroke={`url(#${gradientId})`}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={20}
			>
				<path d="M 40 72 L 220 72 M 196 58 L 220 72 L 196 86" />
				<path d="M 80 128 L 212 128 M 188 114 L 212 128 L 188 142" />
				<path d="M 120 184 L 204 184 M 180 170 L 204 184 L 180 198" />
			</g>
		</svg>
	);
}
