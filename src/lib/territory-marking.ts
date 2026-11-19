import type { Geometry } from 'geojson'
import type { Map as LeafletMap } from 'leaflet'

type Ponto = [number, number]
type Anel = Ponto[]
type Poligono = Anel[]

function pontoDentroAnel(ponto: Ponto, anel: Anel): boolean {
  let dentro = false
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i]
    const [xj, yj] = anel[j]
    const cruza = (yi > ponto[1]) !== (yj > ponto[1])
      && ponto[0] < ((xj - xi) * (ponto[1] - yi)) / (yj - yi || Number.EPSILON) + xi
    if (cruza) dentro = !dentro
  }
  return dentro
}

function pontoDentroPoligono(ponto: Ponto, poligono: Poligono): boolean {
  if (!poligono.length || !pontoDentroAnel(ponto, poligono[0])) return false
  return !poligono.slice(1).some((anel) => pontoDentroAnel(ponto, anel))
}

function orientacao(a: Ponto, b: Ponto, c: Ponto): number {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1])
}

function noSegmento(a: Ponto, b: Ponto, p: Ponto): boolean {
  return p[0] >= Math.min(a[0], b[0]) - 1e-10
    && p[0] <= Math.max(a[0], b[0]) + 1e-10
    && p[1] >= Math.min(a[1], b[1]) - 1e-10
    && p[1] <= Math.max(a[1], b[1]) + 1e-10
}

function segmentosSeCruzam(a: Ponto, b: Ponto, c: Ponto, d: Ponto): boolean {
  const o1 = orientacao(a, b, c)
  const o2 = orientacao(a, b, d)
  const o3 = orientacao(c, d, a)
  const o4 = orientacao(c, d, b)
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0))
    && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true
  return (Math.abs(o1) < 1e-10 && noSegmento(a, b, c))
    || (Math.abs(o2) < 1e-10 && noSegmento(a, b, d))
    || (Math.abs(o3) < 1e-10 && noSegmento(c, d, a))
    || (Math.abs(o4) < 1e-10 && noSegmento(c, d, b))
}

function distanciaPontoSegmento(ponto: Ponto, inicio: Ponto, fim: Ponto): number {
  const dx = fim[0] - inicio[0]
  const dy = fim[1] - inicio[1]
  const comprimento = dx * dx + dy * dy
  if (comprimento === 0) return Math.hypot(ponto[0] - inicio[0], ponto[1] - inicio[1])
  const proporcao = Math.max(0, Math.min(1, ((ponto[0] - inicio[0]) * dx + (ponto[1] - inicio[1]) * dy) / comprimento))
  return Math.hypot(ponto[0] - (inicio[0] + proporcao * dx), ponto[1] - (inicio[1] + proporcao * dy))
}

function segmentosProximos(a: Ponto, b: Ponto, c: Ponto, d: Ponto, tolerancia: number): boolean {
  return segmentosSeCruzam(a, b, c, d)
    || Math.min(
      distanciaPontoSegmento(a, c, d),
      distanciaPontoSegmento(b, c, d),
      distanciaPontoSegmento(c, a, b),
      distanciaPontoSegmento(d, a, b),
    ) <= tolerancia
}

function poligonoCruzaTracado(poligono: Poligono, tracado: Ponto[], tracadoPixel?: Ponto[], mapa?: LeafletMap): boolean {
  if (tracado.some((ponto) => pontoDentroPoligono(ponto, poligono))) return true
  const anéisPixel = mapa
    ? poligono.map((anel) => anel.map(([longitude, latitude]) => {
      const ponto = mapa.latLngToContainerPoint([latitude, longitude])
      return [ponto.x, ponto.y] as Ponto
    }))
    : null

  for (let i = 1; i < tracado.length; i += 1) {
    const inicio = tracado[i - 1]
    const fim = tracado[i]
    for (let indiceAnel = 0; indiceAnel < poligono.length; indiceAnel += 1) {
      const anel = poligono[indiceAnel]
      for (let j = 1; j < anel.length; j += 1) {
        if (segmentosSeCruzam(inicio, fim, anel[j - 1], anel[j])) return true
        if (tracadoPixel && anéisPixel) {
          const anelPixel = anéisPixel[indiceAnel]
          if (segmentosProximos(tracadoPixel[i - 1], tracadoPixel[i], anelPixel[j - 1], anelPixel[j], 13)) return true
        }
      }
    }
  }
  return false
}

export function geometriaCruzaTracado(
  geometria: Geometry | undefined,
  tracadoLatLng: Array<[number, number]>,
  mapa?: LeafletMap | null,
): boolean {
  if (!geometria || tracadoLatLng.length < 2) return false
  const tracado: Ponto[] = tracadoLatLng.map(([latitude, longitude]) => [longitude, latitude])
  const tracadoPixel = mapa
    ? tracadoLatLng.map(([latitude, longitude]) => {
      const ponto = mapa.latLngToContainerPoint([latitude, longitude])
      return [ponto.x, ponto.y] as Ponto
    })
    : undefined
  if (geometria.type === 'Polygon') {
    return poligonoCruzaTracado(geometria.coordinates as Poligono, tracado, tracadoPixel, mapa ?? undefined)
  }
  if (geometria.type === 'MultiPolygon') {
    return (geometria.coordinates as Poligono[]).some((poligono) => poligonoCruzaTracado(poligono, tracado, tracadoPixel, mapa ?? undefined))
  }
  return false
}
