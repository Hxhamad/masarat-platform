import { cellToBoundary, cellToLatLng, polygonToCells } from 'h3-js';

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface HexCell {
  cellId: string;
  centerLat: number;
  centerLng: number;
  polygon: number[][][];
}

function zoomToBaseResolution(zoom: number): number {
  if (zoom >= 12) return 5;
  if (zoom >= 10) return 4;
  if (zoom >= 8) return 3;
  if (zoom >= 6) return 2;
  if (zoom >= 4) return 1;
  return 0;
}

function viewportPolygon(bounds: Bounds): number[][][] {
  return [[
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ]];
}

export function resolveHexResolution(bounds: Bounds, zoom: number, maxCells: number): number {
  const polygon = viewportPolygon(bounds);
  let resolution = zoomToBaseResolution(zoom);
  let cells = polygonToCells(polygon, resolution, true);

  while (cells.length > maxCells && resolution > 0) {
    resolution -= 1;
    cells = polygonToCells(polygon, resolution, true);
  }

  return resolution;
}

export function hexCellToPolygon(cellId: string): number[][][] {
  const boundary = cellToBoundary(cellId, true);
  const first = boundary[0];
  const last = boundary[boundary.length - 1];
  const ring = first && last && (first[0] !== last[0] || first[1] !== last[1])
    ? [...boundary, first]
    : boundary;

  return [ring.map(([lng, lat]) => [lng, lat])];
}

export function viewportToHexCells(bounds: Bounds, zoom: number, maxCells: number): HexCell[] {
  const polygon = viewportPolygon(bounds);
  const resolution = resolveHexResolution(bounds, zoom, maxCells);
  const cellIds = [...new Set(polygonToCells(polygon, resolution, true))];

  return cellIds.map((cellId) => {
    const [centerLat, centerLng] = cellToLatLng(cellId);
    return {
      cellId,
      centerLat,
      centerLng,
      polygon: hexCellToPolygon(cellId),
    };
  });
}