/** @returns {'walk' | 'drive'} */
export function defaultTransportMode(distanceMeters) {
  return distanceMeters <= 2000 ? 'walk' : 'drive'
}
