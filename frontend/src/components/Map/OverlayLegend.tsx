import './OverlayLegend.css';

interface OverlayLegendProps {
	weatherEnabled: boolean;
	gnssEnabled: boolean;
	weatherLastUpdated: number | null;
	minutes: number;
	onMinutesChange: (minutes: number) => void;
}

const WINDOW_OPTIONS = [15, 30, 60] as const;

const weatherScale = [
	{ label: 'Low', color: '#2f855a' },
	{ label: 'Guarded', color: '#d69e2e' },
	{ label: 'Elevated', color: '#f97316' },
	{ label: 'High', color: '#ef4444' },
	{ label: 'Severe', color: '#991b1b' },
];

const gnssScale = [
	{ label: 'Low', color: '#0ea5e9' },
	{ label: 'Guarded', color: '#6366f1' },
	{ label: 'Elevated', color: '#8b5cf6' },
	{ label: 'High', color: '#d946ef' },
	{ label: 'Severe', color: '#be123c' },
];

function ScaleRow(props: { items: Array<{ label: string; color: string }> }) {
	return (
		<div className="overlay-legend__scale-items">
			{props.items.map((item) => (
				<span key={item.label} className="overlay-legend__scale-item">
					<span className="overlay-legend__swatch" style={{ background: item.color }} />
					<span>{item.label}</span>
				</span>
			))}
		</div>
	);
}

function formatUpdatedAt(updatedAt: number | null): string {
	if (!updatedAt) return 'Waiting for data';

	return new Date(updatedAt).toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

export default function OverlayLegend(props: OverlayLegendProps) {
	if (!props.weatherEnabled && !props.gnssEnabled) {
		return null;
	}

	return (
		<div className="overlay-legend" role="note" aria-label="Risk overlay legend">
			<div className="overlay-legend__header">
				<span className="overlay-legend__title">Live Risk Overlays</span>
			</div>

			{props.weatherEnabled && (
				<section className="overlay-legend__section">
					<div className="overlay-legend__section-header">
						<span className="overlay-legend__section-title">Weather (Open-Meteo)</span>
						<span className="overlay-legend__meta">Source Open-Meteo</span>
					</div>
					<div className="overlay-legend__meta-row">
						<span>Last update {formatUpdatedAt(props.weatherLastUpdated)}</span>
					</div>
					<ScaleRow items={weatherScale} />
					<p className="overlay-legend__disclaimer">
						Weather data sourced from Open-Meteo forecast models and visualized for situational awareness. Not a certified aviation weather briefing source.
					</p>
				</section>
			)}

			{props.gnssEnabled && (
				<section className="overlay-legend__section">
					<div className="overlay-legend__section-header">
						<span className="overlay-legend__section-title">GNSS Jamming (ADS-B inferred)</span>
					</div>
					<div className="overlay-legend__window-picker" aria-label="GNSS overlay time window">
						{WINDOW_OPTIONS.map((minutes) => (
							<button
								key={minutes}
								type="button"
								className={`overlay-legend__window-btn ${props.minutes === minutes ? 'overlay-legend__window-btn--active' : ''}`}
								onClick={() => props.onMinutesChange(minutes)}
							>
								{minutes}m
							</button>
						))}
					</div>
					<ScaleRow items={gnssScale} />
					<p className="overlay-legend__disclaimer">
						GNSS risk is inferred from ADS-B behavior and should be treated as situational awareness only.
					</p>
				</section>
			)}
		</div>
	);
}
