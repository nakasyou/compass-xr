import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'

type Building = {
  id: number
  label: string
  type: string
  address?: string
  lat: number
  lng: number
}

function App () {
  const [status, setStatus] = createSignal('現在地周辺の建物を取得します。')
  const [error, setError] = createSignal('')
  const [buildings, setBuildings] = createSignal<Building[]>([])
  const [radius, setRadius] = createSignal(200)
  const [coords, setCoords] = createSignal<{ lat: number, lng: number } | null>(null)
  const [hasSearched, setHasSearched] = createSignal(false)
  const [heading, setHeading] = createSignal<number | null>(null)
  const [rawHeading, setRawHeading] = createSignal<number | null>(null)
  const [orientationError, setOrientationError] = createSignal('')
  const fallbackCoords = { lat: 35.65702, lng: 139.70311 }
  const headingHistory: number[] = []
  const headingHistorySize = 12
  let orientationActive = false
  let headingAnimationId: number | null = null

  const fetchBuildings = async (lat: number, lng: number, radiusMeters: number) => {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius: String(radiusMeters)
    })
    const response = await fetch(`/api/buildings?${params.toString()}`)
    if (!response.ok) {
      throw new Error('建物データの取得に失敗しました。')
    }
    return response.json() as Promise<{ buildings: Building[] }>
  }

  const searchAround = async (lat: number, lng: number) => {
    setCoords({ lat, lng })
    setStatus('周辺の建物を検索しています…')
    try {
      const data = await fetchBuildings(lat, lng, radius())
      setBuildings(data.buildings ?? [])
      setStatus(`周辺の建物 ${data.buildings?.length ?? 0} 件`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '建物データの取得に失敗しました。')
      setStatus('取得に失敗しました。')
    }
  }

  const fallbackToDefault = (message: string) => {
    setError(message)
    setStatus('位置情報の取得に失敗したため、代替地点で検索します…')
    void searchAround(fallbackCoords.lat, fallbackCoords.lng)
  }

  const requestLocation = () => {
    setError('')
    setBuildings([])
    setHasSearched(true)

    if (!navigator.geolocation) {
      fallbackToDefault('このブラウザは位置情報に対応していません。')
      return
    }

    setStatus('現在地を取得しています…')
    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      await searchAround(lat, lng)
    }, (err) => {
      fallbackToDefault(`位置情報を取得できませんでした: ${err.message}`)
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    })
  }

  const startOrientation = async () => {
    setOrientationError('')
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      setOrientationError('この端末は向き取得に対応していません。')
      return
    }
    if (orientationActive) {
      return
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const compass = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
      const alpha = event.alpha
      const usingCompass = Number.isFinite(compass)
      const value = usingCompass
        ? compass!
        : (alpha === null ? null : (360 - alpha + 360) % 360)
      if (value === null) {
        return
      }
      setRawHeading(value)
      if (heading() === null) {
        setHeading(value)
      }
      if (orientationError()) {
        setOrientationError('')
      }
    }

    const needsPermission = typeof (DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }).requestPermission === 'function'

    if (needsPermission) {
      const result = await (DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission: () => Promise<'granted' | 'denied'>
      }).requestPermission()
      if (result !== 'granted') {
        setOrientationError('向きの取得が許可されていません。ボタンから許可してください。')
        return
      }
    }

    orientationActive = true
    headingHistory.length = 0
    window.addEventListener('deviceorientationabsolute', handleOrientation, true)
    const updateHeading = () => {
      const value = rawHeading()
      if (value !== null) {
        headingHistory.push(value)
        if (headingHistory.length > headingHistorySize) {
          headingHistory.shift()
        }
        let sinSum = 0
        let cosSum = 0
        for (const deg of headingHistory) {
          const rad = (deg * Math.PI) / 180
          sinSum += Math.sin(rad)
          cosSum += Math.cos(rad)
        }
        const avg = Math.atan2(sinSum / headingHistory.length, cosSum / headingHistory.length)
        setHeading(((avg * 180) / Math.PI + 360) % 360)
      }
      headingAnimationId = window.requestAnimationFrame(updateHeading)
    }
    headingAnimationId = window.requestAnimationFrame(updateHeading)
    onCleanup(() => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true)
      orientationActive = false
      if (headingAnimationId !== null) {
        window.cancelAnimationFrame(headingAnimationId)
        headingAnimationId = null
      }
    })
  }

  const bearingBetween = (from: { lat: number, lng: number }, to: { lat: number, lng: number }) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const lat1 = toRad(from.lat)
    const lat2 = toRad(to.lat)
    const deltaLng = toRad(to.lng - from.lng)
    const y = Math.sin(deltaLng) * Math.cos(lat2)
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
    const brng = (Math.atan2(y, x) * 180) / Math.PI
    return (brng + 360) % 360
  }

  const distanceBetween = (from: { lat: number, lng: number }, to: { lat: number, lng: number }) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const radiusMeters = 6371000
    const lat1 = toRad(from.lat)
    const lat2 = toRad(to.lat)
    const deltaLat = toRad(to.lat - from.lat)
    const deltaLng = toRad(to.lng - from.lng)
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return radiusMeters * c
  }

  const BuildingsList = () => (
    <section class="space-y-3">
      <Show
        when={buildings().length > 0}
        fallback={
          <div class="text-sm text-slate-400">
            {hasSearched() ? '建物が見つかりませんでした。' : '検索ボタンを押してください。'}
          </div>
        }
      >
        <div class="grid gap-3">
          <For each={buildings()}>
            {(building) => (
              <div class="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                <div class="text-base font-semibold">
                  {building.label}
                </div>
                <div class="mt-1 text-xs uppercase tracking-widest text-emerald-300">
                  {building.type}
                </div>
                <Show when={building.address}>
                  <div class="mt-2 text-sm text-slate-300">{building.address}</div>
                </Show>
                <div class="mt-2 text-xs text-slate-500">
                  {building.lat.toFixed(5)}, {building.lng.toFixed(5)}
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  )

  const beadings = createMemo(() => {
    return buildings().map((building) => {
      if (!coords()) {
        return null
      }
      const from = coords()!
      const bearing = bearingBetween(from, { lat: building.lat, lng: building.lng })
      return bearing
    })
  })

  const beadingRanks = createMemo(() => {
    const bearings = beadings()
    const sorted = [...bearings].sort((a, b) => a! - b!)
    return bearings.map((bearing) => {
      return sorted.indexOf(bearing!)
    })
  })

  return (
    <div class="min-h-screen bg-black text-slate-100">
      <Show
        when={coords() && buildings().length > 0}
        fallback={
          <>
            <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
              <section class="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-slate-950/40">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div class="flex items-center gap-3">
                    <label for="radius" class="text-sm text-slate-300">検索半径 (m)</label>
                    <input
                      id="radius"
                      type="number"
                      min="50"
                      max="1000"
                      value={radius()}
                      onInput={(event) => setRadius(Number(event.currentTarget.value) || 200)}
                      class="w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1 text-sm text-slate-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={requestLocation}
                    class="rounded-full bg-emerald-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
                  >
                    現在地から検索
                  </button>
                </div>
                <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <button
                    type="button"
                    onClick={startOrientation}
                    class="rounded-full border border-emerald-400/60 px-4 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
                  >
                    向きを取得
                  </button>
                  <Show when={heading() !== null}>
                    <div class="text-xs text-slate-400">
                      方位: {heading()!.toFixed(0)}°
                    </div>
                  </Show>
                  <Show when={orientationError()}>
                    <div class="text-xs text-rose-200">{orientationError()}</div>
                  </Show>
                </div>

                <div class="mt-4 text-sm text-slate-300">{status()}</div>
                <Show when={coords()}>
                  <div class="mt-1 text-xs text-slate-500">
                    現在地: {coords()!.lat.toFixed(5)}, {coords()!.lng.toFixed(5)}
                  </div>
                </Show>
                <Show when={error()}>
                  <div class="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    {error()}
                  </div>
                </Show>
              </section>

              <BuildingsList />
            </div>
          </>
        }
      >
        <section class="flex min-h-screen w-full items-center justify-center px-6 py-10">
          <div class="w-full max-w-5xl">
            <div
              class="relative w-full"
              style={{
                height: '60vh',
                'min-height': '260px'
              }}
            >
              <div class="absolute left-4 top-4 z-10 flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 backdrop-blur">
                <button
                  type="button"
                  onClick={startOrientation}
                  class="rounded-full border border-emerald-400/60 px-3 py-1 text-[10px] font-semibold text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
                >
                  向きを取得
                </button>
                <Show when={heading() !== null}>
                  <div class="text-[10px] text-slate-400">
                    方位: {heading()!.toFixed(0)}°
                  </div>
                </Show>
                <Show when={orientationError()}>
                  <div class="text-[10px] text-rose-200">{orientationError()}</div>
                </Show>
              </div>
              <For
                each={[
                  { label: 'N', angle: 0 },
                  { label: 'NE', angle: 45 },
                  { label: 'E', angle: 90 },
                  { label: 'SE', angle: 135 },
                  { label: 'S', angle: 180 },
                  { label: 'SW', angle: 225 },
                  { label: 'W', angle: 270 },
                  { label: 'NW', angle: 315 }
                ]}
              >
                {(dir) => {
                  const relative = () => {
                    const headingValue = heading() ?? 0
                    const rawRelative = dir.angle - headingValue
                    return ((rawRelative + 540) % 360) - 180
                  }
                  const relativeValue = () => relative()
                  return (
                    <div
                      class="absolute top-0 bottom-0 w-px bg-slate-700/60"
                      style={{
                        left: `calc(50% + ${(relativeValue()! / 180) * 50}%)`
                      }}
                    >
                      <span class="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] font-semibold text-slate-400">
                        {dir.label}
                      </span>
                    </div>
                  )
                }}
              </For>
              <div class="absolute left-1/2 top-1/2 h-12 w-px -translate-x-1/2 -translate-y-1/2 bg-emerald-300" />
              <div class="absolute left-1/2 top-1/2 mt-8 -translate-x-1/2 text-sm font-semibold text-emerald-200">
                前
              </div>
              <For each={buildings().filter(v => v.label !== 'yes')}>
                {(building, index) => {
                  const from = coords()!
                  const bearing = beadings()![index()]!
                  const relative = () => {
                    const headingValue = heading() ?? 0
                    const rawRelative = bearing - headingValue
                    return ((rawRelative + 540) % 360) - 180
                  }
                  const verticalOffset = () => {
                    const rank = beadingRanks()![index()]! % 20
                    const spacing = 24
                    const centerOffset = (spacing * 20) / 2
                    return rank * spacing - centerOffset
                  }
                  const relativeValue = () => relative()
                  const distanceMeters = () => distanceBetween(from, { lat: building.lat, lng: building.lng })
                  const isNear = () => distanceMeters() <= 100
                  return (
                    <div
                      class="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
                      classList={{
                        'scale-110 shadow-lg shadow-emerald-400/30': isNear(),
                        'scale-90 opacity-80': !isNear()
                      }}
                      style={{
                        left: `calc(50% + ${(relativeValue()! / 180) * 50}%)`,
                        top: `calc(50% + ${verticalOffset()}px)`,
                        transition: 'left 80ms linear, transform 150ms ease, opacity 150ms ease'
                      }}
                      title={`${building.label} (${relativeValue()!.toFixed(0)}°)`}
                    >
                      <div class="w-1 h-1 rounded-full bg-emerald-400/80 ring-2 ring-emerald-300/60" />
                      <div class="text-xs font-semibold text-white">{building.label}</div>
                      <div class="mt-0.5 text-[10px] text-slate-500">
                        {Math.round(distanceMeters())} m
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
            <div class="mt-8">
              <BuildingsList />
            </div>
          </div>
        </section>
      </Show>
    </div>
  )
}

export default App
