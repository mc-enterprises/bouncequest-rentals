import type { AddressDetails, AddressSuggestion } from '@louez/types'

/**
 * BounceQuest: free address lookup used when no Google Places key is configured.
 * Photon (komoot, OpenStreetMap data) serves search-as-you-type; the suggestion's
 * placeId carries the resolved details so no second lookup is needed.
 */

const PHOTON_URL = process.env.PHOTON_URL || 'https://photon.komoot.io/api/'
const USER_AGENT = 'bouncequest-rentals/1 (+https://github.com/mc-enterprises/bouncequest-rentals)'
export const OSM_PLACE_PREFIX = 'osm:'

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: {
    osm_id?: number
    name?: string
    housenumber?: string
    street?: string
    city?: string
    town?: string
    village?: string
    county?: string
    state?: string
    postcode?: string
    country?: string
    countrycode?: string
  }
}

function featureToDetails(feature: PhotonFeature): AddressDetails | null {
  const [longitude, latitude] = feature.geometry?.coordinates ?? []
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  const p = feature.properties ?? {}
  const city = p.city || p.town || p.village || p.county
  const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name || ''
  const formattedAddress = [streetLine, city, [p.state, p.postcode].filter(Boolean).join(' '), p.country]
    .filter((part) => part && String(part).trim().length > 0)
    .join(', ')
  const details: AddressDetails = {
    placeId: '',
    formattedAddress,
    latitude,
    longitude,
    streetNumber: p.housenumber,
    street: p.street || p.name,
    city,
    postalCode: p.postcode,
    country: p.country,
    countryCode: p.countrycode?.toUpperCase(),
  }
  details.placeId = OSM_PLACE_PREFIX + Buffer.from(JSON.stringify(details)).toString('base64url')
  return details
}

async function photonSearch(query: string, limit: number): Promise<AddressDetails[]> {
  const url = new URL(PHOTON_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('lang', 'en')
  const biasLat = process.env.BQ_WAREHOUSE_LAT
  const biasLng = process.env.BQ_WAREHOUSE_LNG
  if (biasLat && biasLng) {
    url.searchParams.set('lat', biasLat)
    url.searchParams.set('lon', biasLng)
  }
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(6_000),
  })
  if (!response.ok) return []
  const data = (await response.json()) as { features?: PhotonFeature[] }
  return (data.features ?? [])
    .map(featureToDetails)
    .filter((details): details is AddressDetails => details !== null)
}

export async function osmAutocomplete(query: string): Promise<{ suggestions: AddressSuggestion[] }> {
  const results = await photonSearch(query, 5)
  return {
    suggestions: results.map((details) => {
      const [mainText, ...rest] = details.formattedAddress.split(', ')
      return {
        placeId: details.placeId,
        description: details.formattedAddress,
        mainText: mainText ?? details.formattedAddress,
        secondaryText: rest.join(', '),
      }
    }),
  }
}

export async function osmResolveQuery(query: string): Promise<{ details: AddressDetails | null }> {
  const [first] = await photonSearch(query, 1)
  return { details: first ?? null }
}

export function osmDetailsFromPlaceId(placeId: string): AddressDetails | null {
  if (!placeId.startsWith(OSM_PLACE_PREFIX)) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(placeId.slice(OSM_PLACE_PREFIX.length), 'base64url').toString('utf8'),
    ) as AddressDetails
    if (typeof parsed.latitude !== 'number' || typeof parsed.longitude !== 'number') return null
    return { ...parsed, placeId }
  } catch {
    return null
  }
}

/** Driving distance is longer than straight line; used only when no routing API is set. */
export const ROAD_DISTANCE_FACTOR = Number(process.env.BQ_ROAD_DISTANCE_FACTOR || 1.25)
