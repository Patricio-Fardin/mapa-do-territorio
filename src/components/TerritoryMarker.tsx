import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

type SituacaoMarcacao = 'concluida' | 'refazer'
type Props = {
  enabled: boolean
  situacao: SituacaoMarcacao
  clearVersion: number
  onComplete: (points: Array<[number, number]>) => void
}

export default function TerritoryMarker({ enabled, situacao, clearVersion, onComplete }: Props) {
  const map = useMap()
  const layerRef = useRef<L.Polyline | null>(null)
  const callbackRef = useRef(onComplete)

  useEffect(() => {
    callbackRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (!enabled) return
    const container = map.getContainer()
    const previousTouchAction = container.style.touchAction
    const previousCursor = container.style.cursor
    container.style.touchAction = 'none'
    container.style.cursor = 'crosshair'
    let pointerId: number | null = null
    let points: L.LatLng[] = []
    let wasDraggingEnabled = map.dragging.enabled()
    let wasDoubleClickEnabled = map.doubleClickZoom.enabled()

    const clearLayer = () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
        layerRef.current = null
      }
    }

    const pointFromEvent = (event: PointerEvent) => map.mouseEventToLatLng(event)

    const start = (event: PointerEvent) => {
      if (pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return
      const target = event.target
      if (target instanceof Element && target.closest('button, a, input, .leaflet-control, .territory-marking-panel')) return
      event.preventDefault()
      event.stopPropagation()
      pointerId = event.pointerId
      points = [pointFromEvent(event)]
      clearLayer()
      if (wasDraggingEnabled) map.dragging.disable()
      if (wasDoubleClickEnabled) map.doubleClickZoom.disable()
      try { container.setPointerCapture(event.pointerId) } catch { /* captura pode não estar disponível em alguns navegadores */ }
      layerRef.current = L.polyline(points, {
        color: situacao === 'concluida' ? '#16a34a' : '#d97706',
        weight: 26,
        opacity: 0.34,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(map)
    }

    const move = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const point = pointFromEvent(event)
      const last = points[points.length - 1]
      if (!last || map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(point)) >= 3) {
        points.push(point)
        layerRef.current?.setLatLngs(points)
      }
    }

    const finish = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const finalPoint = pointFromEvent(event)
      const last = points[points.length - 1]
      if (!last || !last.equals(finalPoint)) points.push(finalPoint)
      pointerId = null
      if (wasDraggingEnabled) map.dragging.enable()
      if (wasDoubleClickEnabled) map.doubleClickZoom.enable()
      if (points.length >= 2) {
        callbackRef.current(points.map((point) => [point.lat, point.lng]))
      } else {
        clearLayer()
      }
    }

    const cancel = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return
      pointerId = null
      points = []
      clearLayer()
      if (wasDraggingEnabled) map.dragging.enable()
      if (wasDoubleClickEnabled) map.doubleClickZoom.enable()
    }

    container.addEventListener('pointerdown', start, { passive: false, capture: true })
    container.addEventListener('pointermove', move, { passive: false, capture: true })
    container.addEventListener('pointerup', finish, { passive: false, capture: true })
    container.addEventListener('pointercancel', cancel, true)
    return () => {
      container.removeEventListener('pointerdown', start, true)
      container.removeEventListener('pointermove', move, true)
      container.removeEventListener('pointerup', finish, true)
      container.removeEventListener('pointercancel', cancel, true)
      if (pointerId !== null) {
        if (wasDraggingEnabled) map.dragging.enable()
        if (wasDoubleClickEnabled) map.doubleClickZoom.enable()
      }
      container.style.touchAction = previousTouchAction
      container.style.cursor = previousCursor
    }
  }, [enabled, map, situacao])

  useEffect(() => {
    if (!layerRef.current) return
    map.removeLayer(layerRef.current)
    layerRef.current = null
  }, [clearVersion, map])

  return null
}
