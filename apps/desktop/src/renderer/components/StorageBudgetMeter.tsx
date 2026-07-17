import type { StorageUsageInfo } from '@otelux/protocol';
import type { CSSProperties, JSX } from 'react';

const BYTES_PER_MB = 1024 * 1024;
const STORAGE_TICKS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;

interface StorageBudgetMeterProps {
	readonly usage?: StorageUsageInfo;
	readonly maxSizeMb: number;
	readonly maxAgeHours: number;
}

export function StorageBudgetMeter(props: StorageBudgetMeterProps): JSX.Element {
	const { usage, maxSizeMb, maxAgeHours } = props;
	const maxBytes = maxSizeMb * BYTES_PER_MB;
	const percentage = usage && maxBytes > 0 ? (usage.retentionBytes / maxBytes) * 100 : undefined;
	const fillPercentage = Math.min(100, Math.max(0, percentage ?? 0));
	const pressure = !usage
		? 'loading'
		: maxBytes === 0
			? 'unlimited'
			: pressureLevel(percentage ?? 0);
	const meterProps =
		usage && maxBytes > 0
			? {
					role: 'meter',
					'aria-label': 'SQLite retention budget',
					'aria-valuemin': 0,
					'aria-valuemax': maxBytes,
					'aria-valuenow': Math.min(usage.retentionBytes, maxBytes),
					'aria-valuetext': `${formatStorageBytes(usage.retentionBytes)} of ${formatStorageBytes(maxBytes)} (${Math.round(percentage ?? 0)}%)`,
				}
			: {
					'aria-label': usage
						? 'SQLite retention budget with no size limit'
						: 'Measuring SQLite retention budget',
				};

	return (
		<section className={`storage-budget storage-budget--${pressure}`}>
			<header className="storage-budget__head">
				<div>
					<span className="storage-budget__eyebrow">SQLite budget</span>
					<div className="storage-budget__value">
						{usage ? formatStorageBytes(usage.retentionBytes) : 'Measuring...'}{' '}
						<span>{maxBytes > 0 ? `/ ${formatStorageBytes(maxBytes)}` : '/ No size limit'}</span>
					</div>
				</div>
				<span className="storage-budget__age">{formatAgeLimit(maxAgeHours)}</span>
			</header>

			<div className="storage-budget__rail">
				<div className="storage-battery" {...meterProps}>
					<div
						className="storage-battery__fill"
						style={{ width: `${fillPercentage}%` } as CSSProperties}
					/>
					<div className="storage-battery__ticks" aria-hidden="true">
						{STORAGE_TICKS.map((tick) => (
							<span key={tick} />
						))}
					</div>
				</div>
				<span className="storage-budget__percent">
					{!usage ? '...' : percentage === undefined ? '\u221e' : `${Math.round(percentage)}%`}
				</span>
			</div>

			<div className="storage-budget__foot">
				<span>On disk {usage ? formatStorageBytes(usage.totalBytes) : '...'}</span>
				<span className="storage-budget__dot" aria-hidden="true" />
				<span>DB {usage ? formatStorageBytes(usage.databaseFileBytes) : '...'}</span>
				<span className="storage-budget__dot" aria-hidden="true" />
				<span>WAL {usage ? formatStorageBytes(usage.walBytes) : '...'}</span>
				<span className="storage-budget__dot" aria-hidden="true" />
				<span>SHM {usage ? formatStorageBytes(usage.sharedMemoryBytes) : '...'}</span>
			</div>
		</section>
	);
}

function pressureLevel(percentage: number): 'normal' | 'warning' | 'critical' {
	if (percentage >= 90) {
		return 'critical';
	}
	if (percentage >= 70) {
		return 'warning';
	}
	return 'normal';
}

export function formatStorageBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < BYTES_PER_MB) {
		return `${formatQuantity(bytes / 1024)} KB`;
	}
	if (bytes < BYTES_PER_MB * 1024) {
		return `${formatQuantity(bytes / BYTES_PER_MB)} MB`;
	}
	return `${formatQuantity(bytes / (BYTES_PER_MB * 1024))} GB`;
}

function formatQuantity(value: number): string {
	return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function formatAgeLimit(maxAgeHours: number): string {
	return maxAgeHours > 0 ? `${maxAgeHours}h window` : 'No age limit';
}
