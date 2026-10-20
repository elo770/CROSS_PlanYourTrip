export function publicPoi(poi) {
  return {
    id: poi.id,
    name: poi.name,
    city: poi.city || '',
    district: poi.district || '',
    address: poi.address || '',
    coordinates: poi.coordinates,
    sourceLabel: '高德'
  }
}
