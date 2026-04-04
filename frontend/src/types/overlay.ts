export type RiskOverlayKind = 'weather' | 'gnss';

export interface RiskCellProperties {
	cellId: string;
	score: number;
	confidence: number;
	factors: string[];
	updatedAt: number;
	sampleSize: number;
	category: 'Low' | 'Guarded' | 'Elevated' | 'High' | 'Severe';
	source?: string;
	stale?: boolean;
}

export interface RiskCellFeature {
	type: 'Feature';
	geometry: {
		type: 'Polygon';
		coordinates: number[][][];
	};
	properties: RiskCellProperties;
}

export interface RiskFeatureCollection {
	type: 'FeatureCollection';
	features: RiskCellFeature[];
}
