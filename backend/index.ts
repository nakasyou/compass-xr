import { Hono } from 'hono'
import { html } from 'hono/html'
const app = new Hono()
const overpassEndpoint = 'https://overpass-api.de/api/interpreter'

type OverpassElement = {
  id: number
  type: 'node' | 'way' | 'relation'
  lat?: number
  lon?: number
  center?: { lat: number, lon: number }
  tags?: Record<string, string>
}

const toAddress = (tags: Record<string, string>) => {
  if (tags['addr:full']) return tags['addr:full']
  const street = tags['addr:street']
  const number = tags['addr:housenumber']
  if (street && number) return `${street} ${number}`
  if (street) return street
  return undefined
}

app.get('/', (c) => {
  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>What Should I Say?</title>
        
        <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
        <script>eruda.init();</script>
      </head>
      <body>
        <div id="root"></div>
        <script src="/src/index.tsx" type="module"></script>
      </body>
    </html>
  `)
})

app.get('/api/buildings', async (c) => {
  const { lat, lng, radius } = c.req.query()
  const latNum = Number(lat)
  const lngNum = Number(lng)
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return c.json({ error: 'Invalid coordinates.' }, 400)
  }

  const radiusNum = Number(radius)
  const radiusMeters = Number.isFinite(radiusNum) ? radiusNum : 200
  const clampedRadius = Math.min(Math.max(radiusMeters, 50), 1000)

  const query = [
    '[out:json][timeout:25];',
    '(',
    `way["building"](around:${clampedRadius},${latNum},${lngNum});`,
    `relation["building"](around:${clampedRadius},${latNum},${lngNum});`,
    ');',
    'out center tags;'
  ].join('')

  const response = await fetch(overpassEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: `data=${encodeURIComponent(query)}`
  })

  if (!response.ok) {
    return c.json({ error: 'Failed to fetch OSM data.' }, 502)
  }

  const data = await response.json() as { elements?: OverpassElement[] }
  const buildings = (data.elements ?? [])
    .map((element) => {
      const tags = element.tags ?? {}
      const latValue = element.lat ?? element.center?.lat
      const lngValue = element.lon ?? element.center?.lon
      if (latValue === undefined || lngValue === undefined) {
        return null
      }
      return {
        id: element.id,
        label: tags.name || tags['addr:housename'] || tags.building || '建物',
        type: tags.building || 'building',
        address: toAddress(tags),
        lat: latValue,
        lng: lngValue
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return c.json({ buildings, radius: clampedRadius })
})

export default app
