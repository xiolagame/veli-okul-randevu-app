// Express 5 permits array params in its types. Resource IDs must be scalar;
// an unexpected array is never joined into another resource identifier.
export function scalarRouteParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
