import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Geometry, MultiPolygon, Polygon } from 'geojson'
import { supabase } from '../lib/supabase'
import {
  FormatoSituacaoQuadraInvalido,
  normalizarSituacaoQuadra,
  type SituacaoQuadra,
} from '../lib/quadra-status'
import { criarIdentificacaoQuadra } from '../lib/quadra-label'

type Situacao = SituacaoQuadra
type Quadra = { id: string; codigo: string; situacao: Situacao; updatedAt: string | null; geometria: Geometry; ativa: boolean }
type GeometriaEditada = { id: string; geometria: Geometry }
type RpcQuadra = { id?: string; codigo?: string; geometria?: Geometry }
type Props = { adminEmail: string; onUnauthorized: () => void }

const CORES: Record<Situacao, string> = { pendente: '#78858a', concluida: '#27ae60', refazer: '#e67e22' }
const NOMES: Record<Situacao, string> = { pendente: 'Pendente', concluida: 'Concluída', refazer: 'Refazer' }
const CENTRO: [number, number] = [-20.6353, -40.7498]
type AdminBasemap = 'osm' | 'carto'
const ADMIN_BASEMAP_STORAGE_KEY = 'mapa-territorios:admin-basemap:v1'
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const CARTO_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${import.meta.env.VITE_CARTO_BASEMAP_KEY ?? ''}`
const BASEMAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, &copy; <a href="https://carto.com/attribution/" target="_blank" rel="noopener noreferrer">CARTO</a>'

function carregarPreferenciaBaseMap(): AdminBasemap {
  if (!import.meta.env.VITE_CARTO_BASEMAP_KEY) return 'osm'
  try {
    return window.localStorage.getItem(ADMIN_BASEMAP_STORAGE_KEY) === 'carto' ? 'carto' : 'osm'
  } catch {
    return 'osm'
  }
}

function aplicarEstilo(layer: L.Layer, situacao: Situacao) {
  ;(layer as L.Path).setStyle({ color: CORES[situacao], fillColor: CORES[situacao], fillOpacity: .42, opacity: .95, weight: 2 })
}

function normalizarQuadras(rows: Array<{ id: string; codigo: string; geometria: Geometry; ativa: boolean; situacoes_quadras?: unknown }>): Quadra[] {
  return rows.map((row) => ({
    id: row.id,
    codigo: row.codigo,
    geometria: row.geometria,
    ativa: row.ativa,
    situacao: normalizarSituacaoQuadra(row.situacoes_quadras),
    updatedAt: (() => {
      const relacao = Array.isArray(row.situacoes_quadras) ? row.situacoes_quadras[0] : row.situacoes_quadras
      return relacao && typeof relacao === 'object' && 'updated_at' in relacao && typeof relacao.updated_at === 'string' ? relacao.updated_at : null
    })(),
  }))
}

function mensagemErroLeitura(error: unknown): string {
  return error instanceof FormatoSituacaoQuadraInvalido
    ? 'O Supabase retornou uma situação de quadra inválida. A situação não foi presumida.'
    : 'Não foi possível carregar as quadras. Verifique a conexão e tente novamente.'
}

async function lerQuadrasAtivas(): Promise<Quadra[]> {
  if (!supabase) throw new Error('Supabase não configurado.')
  const pageSize = 1000
  const quadras: Quadra[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('quadras')
      .select('id,codigo,geometria,ativa,situacoes_quadras(situacao,updated_at)')
      .eq('ativa', true)
      .order('id')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error('Não foi possível carregar as quadras ativas.')
    quadras.push(...normalizarQuadras(data ?? []))
    if ((data?.length ?? 0) < pageSize) return quadras
  }
}

async function lerTodosCodigos(): Promise<string[]> {
  if (!supabase) throw new Error('Supabase não configurado.')
  const pageSize = 1000
  const codes: string[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('quadras')
      .select('codigo')
      .order('codigo')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error('Não foi possível consultar os códigos existentes.')
    codes.push(...(data ?? []).map((row) => row.codigo))
    if ((data?.length ?? 0) < pageSize) return codes
  }
}

async function confirmarSessaoAdmin(adminEmail: string): Promise<boolean> {
  if (!supabase) return false
  try {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user?.email || data.user.email.trim().toLowerCase() !== adminEmail.trim().toLowerCase()) {
      await supabase.auth.signOut({ scope: 'local' })
      return false
    }
    const { data: profile, error: profileError } = await supabase
      .from('perfis')
      .select('papel')
      .eq('user_id', data.user.id)
      .maybeSingle()
    if (profileError || profile?.papel !== 'admin') {
      await supabase.auth.signOut({ scope: 'local' })
      return false
    }
    return true
  } catch {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      return false
    }
    return false
  }
}

function geometriaDaCamada(layer: L.Layer): Geometry {
  return (layer as L.Polygon).toGeoJSON().geometry as Geometry
}

function chaveGeometria(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(chaveGeometria).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${chaveGeometria(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function AdminDrawingMap({
  quadras,
  selectedId,
  busy,
  onSelect,
  onCreate,
  onGeometryEdit,
  onCancel,
}: {
  quadras: Quadra[]
  selectedId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onCreate: (geometry: Geometry) => void
  onGeometryEdit: (geometries: GeometriaEditada[]) => void
  onCancel: () => void
}) {
  const map = useMap()
  const editableGroup = useRef<L.FeatureGroup | null>(null)
  const selectedEditGroup = useRef<L.FeatureGroup | null>(null)
  const labelsGroup = useRef<L.LayerGroup | null>(null)
  const idsByLayer = useRef(new WeakMap<L.Layer, string>())
  const originalTypes = useRef(new Map<string, Geometry['type']>())
  const callbacks = useRef({ onSelect, onCreate, onGeometryEdit, onCancel })
  const busyRef = useRef(busy)
  const interactionActive = useRef(false)
  const pendingLayerSync = useRef(false)
  const syncedSelection = useRef<string | null>(null)
  const currentQuadras = useRef(quadras)
  const syncLayers = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    callbacks.current = { onSelect, onCreate, onGeometryEdit, onCancel }
  }, [onSelect, onCreate, onGeometryEdit, onCancel])
  useLayoutEffect(() => {
    busyRef.current = busy
    currentQuadras.current = quadras
  }, [busy, quadras])

  useEffect(() => {
    const group = L.featureGroup().addTo(map)
    const selectedGroup = L.featureGroup().addTo(map)
    const labels = L.layerGroup().addTo(map)
    editableGroup.current = group
    selectedEditGroup.current = selectedGroup
    labelsGroup.current = labels
    return () => {
      editableGroup.current = null
      selectedEditGroup.current = null
      labelsGroup.current = null
      map.removeLayer(selectedGroup)
      map.removeLayer(group)
      map.removeLayer(labels)
    }
  }, [map])

  useEffect(() => {
    const group = editableGroup.current
    const selectedGroup = selectedEditGroup.current
    if (!group || !selectedGroup) return
    const syncLabelLayers = (items: Quadra[]) => {
      const labelLayers = labelsGroup.current
      if (!labelLayers) return
      labelLayers.clearLayers()
      items.forEach((quadra) => {
        const label = criarIdentificacaoQuadra(map, quadra.geometria, quadra.codigo, quadra.situacao, CORES[quadra.situacao], true, quadra.situacao === 'concluida' ? quadra.updatedAt : null)
        if (label) labelLayers.addLayer(label)
      })
    }
    const sync = () => {
      // O grupo usado pelo Leaflet Draw contém somente a quadra selecionada.
      // Limpar primeiro dispara layerremove e retira os vértices da seleção anterior.
      selectedGroup.clearLayers()
      group.clearLayers()
      idsByLayer.current = new WeakMap()
      originalTypes.current.clear()
      currentQuadras.current.forEach((quadra) => {
        originalTypes.current.set(quadra.id, quadra.geometria.type)
        const polygons: Geometry[] = quadra.geometria.type === 'MultiPolygon'
          ? quadra.geometria.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }) as Polygon)
          : [quadra.geometria]
        polygons.forEach((polygon) => {
          const feature = L.geoJSON(polygon)
          feature.eachLayer((part) => {
            aplicarEstilo(part, quadra.situacao)
            idsByLayer.current.set(part, quadra.id)
            part.on('click', () => callbacks.current.onSelect(quadra.id))
            if (quadra.id === selectedId) selectedGroup.addLayer(part)
            else group.addLayer(part)
          })
        })
      })
      syncLabelLayers(currentQuadras.current)
      pendingLayerSync.current = false
      syncedSelection.current = selectedId
    }
    syncLayers.current = sync
    const atualizarRotulos = () => syncLabelLayers(currentQuadras.current)
    map.on('zoomend', atualizarRotulos)
    if (busyRef.current) pendingLayerSync.current = true
    else if (interactionActive.current && syncedSelection.current !== selectedId) sync()
    else if (interactionActive.current) pendingLayerSync.current = true
    else sync()
    return () => {
      map.off('zoomend', atualizarRotulos)
    }
  }, [map, quadras, selectedId])

  useEffect(() => {
    if (!busy && !interactionActive.current && pendingLayerSync.current) syncLayers.current()
  }, [busy, quadras])

  useEffect(() => {
    const group = editableGroup.current
    const selectedGroup = selectedEditGroup.current
    if (!group || !selectedGroup) return
    const control = new L.Control.Draw({
      position: 'topright',
      draw: {
        // Leaflet Draw's readableArea uses an undeclared variable in strict ESM; this crashes vertexChanged.
        polygon: { allowIntersection: false, showArea: false, maxPoints: 0, repeatMode: false },
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
      },
      edit: { featureGroup: selectedGroup, remove: false },
    })
    map.addControl(control)
    let editSaveRequested = false

    const created = (event: L.LeafletEvent) => {
      if (busyRef.current) return
      const layer = (event as L.DrawEvents.Created).layer
      callbacks.current.onCreate(geometriaDaCamada(layer))
    }
    const edited = (event: L.LeafletEvent) => {
      editSaveRequested = true
      if (busyRef.current) return
      const changed = new Set<string>()
      ;(event as L.DrawEvents.Edited).layers.eachLayer((layer) => {
        const id = idsByLayer.current.get(layer)
        if (id) changed.add(id)
      })
      if (!changed.size || !editableGroup.current) return
      const geometries = [...changed].flatMap((id) => {
        const parts: Geometry[] = []
        selectedEditGroup.current?.eachLayer((layer) => {
          if (idsByLayer.current.get(layer) === id) parts.push(geometriaDaCamada(layer))
        })
        if (!parts.length) return []
        const type = originalTypes.current.get(id)
        const geometry: Geometry = type === 'MultiPolygon'
          ? {
            type: 'MultiPolygon',
            coordinates: parts.flatMap((part) => {
              if (part.type === 'MultiPolygon') return part.coordinates
              if (part.type === 'Polygon') return [part.coordinates]
              return []
            }),
          } as MultiPolygon
          : parts[0]
        return [{ id, geometria: geometry }]
      })
      if (geometries.length) callbacks.current.onGeometryEdit(geometries)
    }
    const interactionStarted = () => {
      interactionActive.current = true
    }
    const interactionStopped = () => {
      interactionActive.current = false
      window.setTimeout(() => {
        if (!busyRef.current && pendingLayerSync.current) syncLayers.current()
      }, 0)
    }
    const doubleClickZoomWasEnabled = map.doubleClickZoom.enabled()
    const drawingStarted = () => {
      interactionStarted()
      if (doubleClickZoomWasEnabled) map.doubleClickZoom.disable()
    }
    const drawingStopped = () => {
      pendingLayerSync.current = true
      interactionStopped()
      if (doubleClickZoomWasEnabled) map.doubleClickZoom.enable()
    }
    const drawingCancelled = () => callbacks.current.onCancel()
    const editingStarted = () => {
      editSaveRequested = false
      interactionStarted()
    }
    const editingStopped = () => {
      pendingLayerSync.current = true
      interactionStopped()
      if (!editSaveRequested) callbacks.current.onCancel()
    }

    map.on(L.Draw.Event.CREATED, created)
    map.on(L.Draw.Event.EDITED, edited)
    map.on(L.Draw.Event.DRAWSTART, drawingStarted)
    map.on(L.Draw.Event.DRAWSTOP, drawingStopped)
    map.on('draw:canceled', drawingCancelled)
    map.on(L.Draw.Event.EDITSTART, editingStarted)
    map.on(L.Draw.Event.EDITSTOP, editingStopped)
    return () => {
      map.off(L.Draw.Event.CREATED, created)
      map.off(L.Draw.Event.EDITED, edited)
      map.off(L.Draw.Event.DRAWSTART, drawingStarted)
      map.off(L.Draw.Event.DRAWSTOP, drawingStopped)
      map.off('draw:canceled', drawingCancelled)
      map.off(L.Draw.Event.EDITSTART, editingStarted)
      map.off(L.Draw.Event.EDITSTOP, editingStopped)
      if (doubleClickZoomWasEnabled) map.doubleClickZoom.enable()
      map.removeControl(control)
    }
  }, [map])

  useEffect(() => {
    const container = map.getContainer()
    container.classList.toggle('admin-map-busy', busy)
    return () => container.classList.remove('admin-map-busy')
  }, [map, busy])

  useEffect(() => {
    const selectedGroup = selectedEditGroup.current
    if (!selectedId || !selectedGroup) return
    const bounds = selectedGroup.getBounds()
    if (bounds.isValid()) map.fitBounds(bounds.pad(.15), { maxZoom: 17 })
  }, [map, selectedId])

  return null
}

export default function AdminMap({ adminEmail, onUnauthorized }: Props) {
  const [quadras, setQuadras] = useState<Quadra[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null)
  const deleteDialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [baseMap, setBaseMap] = useState<AdminBasemap>(carregarPreferenciaBaseMap)
  const [toolsPanelOpen, setToolsPanelOpen] = useState(false)
  const operationLock = useRef(false)
  const selecionarBaseMap = useCallback((nextBaseMap: AdminBasemap) => {
    setBaseMap(nextBaseMap)
    try {
      window.localStorage.setItem(ADMIN_BASEMAP_STORAGE_KEY, nextBaseMap)
    } catch {
      // A preferência permanece ativa nesta sessão mesmo se o armazenamento estiver indisponível.
    }
  }, [])
  const loadVersion = useRef(0)
  const selected = quadras.find((quadra) => quadra.id === selectedId) ?? null
  const deleteTarget = quadras.find((quadra) => quadra.id === deleteTargetId) ?? null
  const counts = useMemo(() => ({
    total: quadras.length,
    pendente: quadras.filter((quadra) => quadra.situacao === 'pendente').length,
    concluida: quadras.filter((quadra) => quadra.situacao === 'concluida').length,
    refazer: quadras.filter((quadra) => quadra.situacao === 'refazer').length,
  }), [quadras])

  const carregar = useCallback(async () => {
    const version = ++loadVersion.current
    try {
      const ativas = await lerQuadrasAtivas()
      if (version === loadVersion.current) {
        setQuadras(ativas)
        setSelectedId((current) => current && ativas.some((quadra) => quadra.id === current) ? current : null)
        setDeleteTargetId((current) => current && ativas.some((quadra) => quadra.id === current) ? current : null)
      }
      return ativas
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void carregar()
      .catch((error: unknown) => {
        if (active) setMessage(mensagemErroLeitura(error))
      })
    return () => {
      active = false
      loadVersion.current += 1
    }
  }, [carregar])

  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client
      .channel('admin-quadras')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quadras' }, () => { void carregar().catch((error: unknown) => setMessage(mensagemErroLeitura(error))) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'situacoes_quadras' }, () => { void carregar().catch((error: unknown) => setMessage(mensagemErroLeitura(error))) })
      .subscribe()
    const refreshTimer = window.setInterval(() => {
      void carregar().catch((error: unknown) => setMessage(mensagemErroLeitura(error)))
    }, 30_000)
    return () => {
      window.clearInterval(refreshTimer)
      void client.removeChannel(channel)
    }
  }, [carregar])

  const executarAdmin = useCallback(async (
    operation: () => Promise<void>,
    options: { preserveDataOnRefreshFailure?: boolean } = {},
  ) => {
    if (operationLock.current) return
    operationLock.current = true
    setBusy(true)
    setMessage('')
    try {
      if (!await confirmarSessaoAdmin(adminEmail)) {
        onUnauthorized()
        return
      }
      await operation()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'A operação não foi concluída. Tente novamente.')
      try {
        await carregar()
      } catch (refreshError: unknown) {
        if (!options.preserveDataOnRefreshFailure) {
          loadVersion.current += 1
          setQuadras([])
          setSelectedId(null)
        }
        setMessage((current) => `${current} ${mensagemErroLeitura(refreshError)}${options.preserveDataOnRefreshFailure ? ' Os dados exibidos foram mantidos.' : ' A lista foi limpa até uma nova leitura bem-sucedida.'}`)
      }
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }, [adminEmail, carregar, onUnauthorized])

  const criar = useCallback((geometria: Geometry) => {
    void executarAdmin(async () => {
      if (!supabase) throw new Error('Supabase não configurado.')
      const existingQuadras = await carregar()
      const geometryKey = chaveGeometria(geometria)
      if (existingQuadras.some((quadra) => chaveGeometria(quadra.geometria) === geometryKey)) {
        throw new Error('Esta geometria já existe em uma quadra ativa. Nenhuma quadra duplicada foi criada.')
      }
      const codes = await lerTodosCodigos()
      const maxCode = codes.reduce((max, code) => {
        const match = /^AC-(\d+)$/.exec(code)
        return match ? (BigInt(match[1]) > max ? BigInt(match[1]) : max) : max
      }, 0n)
      const codigo = `AC-${(maxCode + 1n).toString().padStart(3, '0')}`
      const { data, error } = await supabase.rpc('admin_criar_quadra', { p_codigo: codigo, p_geometria: geometria })
      if (error) {
        if (error.code === '23505') throw new Error(`O código ${codigo} foi usado por outra operação. Atualize e tente novamente.`)
        const safeCode = /^[0-9A-Z]{5}$/.test(error.code ?? '') ? ` Código: ${error.code}.` : ''
        throw new Error(`O Supabase não confirmou a criação da quadra. A operação não foi apresentada como salva.${safeCode}`)
      }
      const created = data as RpcQuadra | null
      if (!created?.id || created.codigo !== codigo) {
        throw new Error('A resposta da criação não confirmou a quadra. Atualize a lista antes de tentar novamente.')
      }
      const createdId = created.id
      try {
        await carregar()
        setSelectedId(createdId)
        setMessage(`Quadra ${codigo} criada e carregada do Supabase.`)
      } catch {
        setQuadras((current) => [...current, {
          id: createdId,
          codigo,
          geometria: created.geometria ?? geometria,
          situacao: 'pendente',
          updatedAt: null,
          ativa: true,
        }])
        setSelectedId(created.id)
        setMessage(`Quadra ${codigo} foi criada, mas a lista não pôde ser recarregada.`)
      }
    })
  }, [carregar, executarAdmin])

  const salvarGeometrias = useCallback((geometries: GeometriaEditada[]) => {
    void executarAdmin(async () => {
      if (!supabase) throw new Error('Supabase não configurado.')
      let savedCount = 0
      for (const item of geometries) {
        const { data, error } = await supabase.rpc('admin_atualizar_geometria', {
          p_quadra_id: item.id,
          p_geometria: item.geometria,
        })
        const savedQuadra = data as RpcQuadra | null
        if (error || savedQuadra?.id !== item.id || !savedQuadra.geometria) {
          const safeCode = error && /^[0-9A-Z]{5}$/.test(error.code ?? '') ? ` Código: ${error.code}.` : ''
          throw new Error(savedCount
            ? `${savedCount} geometria(s) foram salvas, mas outra alteração falhou.${safeCode} A lista será atualizada com o estado persistido.`
            : `O Supabase não confirmou a geometria.${safeCode} A visualização será atualizada com o estado persistido.`)
        }
        savedCount += 1
      }
      await carregar()
      setMessage(geometries.length === 1 ? 'Geometria salva e recarregada do Supabase.' : 'Geometrias salvas e recarregadas do Supabase.')
    })
  }, [carregar, executarAdmin])

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (!dialog) return
    if (deleteTarget && !dialog.open) {
      const activeElement = document.activeElement
      deleteDialogReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
      dialog.showModal()
    } else if (!deleteTarget && dialog.open) {
      dialog.close()
      const previousFocus = deleteDialogReturnFocusRef.current
      deleteDialogReturnFocusRef.current = null
      if (previousFocus instanceof HTMLButtonElement && previousFocus.disabled) {
        document.getElementById('admin-tools-toggle')?.focus()
      } else {
        previousFocus?.focus()
      }
    }
  }, [deleteTarget])

  const excluirQuadra = useCallback(() => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteError('')

    void executarAdmin(async () => {
      if (!supabase) {
        const failure = 'O serviço de dados não está configurado. Nenhuma alteração foi realizada.'
        setDeleteError(failure)
        throw new Error(failure)
      }

      let data: boolean | null
      let error: { code?: string; message?: string } | null
      try {
        const result = await supabase.rpc('admin_arquivar_quadra', { p_quadra_id: target.id })
        data = result.data
        error = result.error
      } catch {
        const failure = 'Não foi possível remover a quadra do mapa público. Nenhuma alteração foi confirmada. Atualize os dados e tente novamente.'
        setDeleteError(failure)
        throw new Error(failure)
      }

      if (error || data !== true) {
        const failure = error?.code === '23503'
          ? 'Não foi possível remover a quadra porque há registros vinculados. Nenhuma alteração foi realizada. Atualize os dados e tente novamente.'
          : 'Não foi possível remover a quadra devido a uma falha no banco. Nenhuma alteração foi confirmada. Atualize os dados e tente novamente.'
        setDeleteError(failure)
        throw new Error(failure)
      }

      setQuadras((current) => current.filter((quadra) => quadra.id !== target.id))
      setSelectedId((current) => current === target.id ? null : current)
      setDeleteTargetId(null)
      setDeleteError('')

      try {
        await carregar()
        setMessage(`Quadra ${target.codigo} removida do mapa público. O histórico foi preservado.`)
      } catch {
        setMessage(`Quadra ${target.codigo} removida do mapa público. O histórico foi preservado. A lista não pôde ser atualizada; use “Atualizar dados”.`)
      }
    }, { preserveDataOnRefreshFailure: true })
  }, [carregar, deleteTarget, executarAdmin])

  const retryLoad = () => {
    setLoading(true)
    setMessage('')
    void carregar()
      .catch((error: unknown) => setMessage(mensagemErroLeitura(error)))
  }

  return (
    <section className="admin-map">
      <button
        type="button"
        id="admin-tools-toggle"
        className="admin-tools-toggle"
        aria-expanded={toolsPanelOpen}
        aria-controls="admin-tools-panel"
        onClick={() => setToolsPanelOpen((open) => !open)}
      >
        {toolsPanelOpen ? 'Ocultar ferramentas' : 'Ferramentas administrativas'}
      </button>
      {toolsPanelOpen && <div id="admin-tools-panel" className="admin-tools-panel" aria-label="Ferramentas administrativas">
        <div className="admin-tools-panel-heading">
          <strong>Ferramentas administrativas</strong>
          <button type="button" onClick={() => setToolsPanelOpen(false)} aria-label="Fechar ferramentas administrativas">×</button>
        </div>
        <div className="admin-map-toolbar">
          <div className="status-panel admin-status">
            <div><strong>{counts.total}</strong><span>Ativas</span></div>
            <div><strong className="gray">{counts.pendente}</strong><span>Pendentes</span></div>
            <div><strong className="green">{counts.concluida}</strong><span>Concluídas</span></div>
            <div><strong className="orange">{counts.refazer}</strong><span>Refazer</span></div>
          </div>
          <label>
            Quadra selecionada
            <select value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value || null)} disabled={busy || loading}>
              <option value="">Selecione uma quadra</option>
              {quadras.map((quadra) => <option key={quadra.id} value={quadra.id}>{quadra.codigo}</option>)}
            </select>
          </label>
          {selected && <p className="selected-quadra">Selecionada: <strong>{selected.codigo}</strong> · {NOMES[selected.situacao]}</p>}
          <div className="admin-map-actions">
            <details className="admin-map-help">
              <summary>Ajuda para desenhar e editar</summary>
              <p>Para criar uma quadra, use a ferramenta de polígono e finalize no primeiro ponto ou com duplo clique no último. Para editar, selecione a quadra e ative a ferramenta de edição; confirme no botão de salvar ou cancele no X.</p>
            </details>
            <button
              type="button"
              className="destructive-action"
              onClick={() => {
                if (!selected) return
                setDeleteTargetId(selected.id)
                setDeleteError('')
                setMessage('')
              }}
              disabled={!selected || busy || loading}
            >
              Excluir Quadra
            </button>
            <button type="button" className="admin-refresh-action" onClick={retryLoad} disabled={busy || loading}>Atualizar dados</button>
          </div>
        </div>

        <div className="admin-basemap-control" role="group" aria-label="Fundo do mapa administrativo">
          <span className="admin-basemap-label">Fundo do mapa</span>
          <div className="admin-basemap-options">
            <button
              type="button"
              className={baseMap === 'osm' ? 'admin-basemap-option is-active' : 'admin-basemap-option'}
              aria-pressed={baseMap === 'osm'}
              onClick={() => selecionarBaseMap('osm')}
            >
              Padrão (OSM)
            </button>
            <button
              type="button"
              className={baseMap === 'carto' ? 'admin-basemap-option is-active' : 'admin-basemap-option'}
              aria-pressed={baseMap === 'carto'}
              onClick={() => selecionarBaseMap('carto')}
              disabled={!import.meta.env.VITE_CARTO_BASEMAP_KEY}
              title={import.meta.env.VITE_CARTO_BASEMAP_KEY ? 'Usar o mapa minimalista da CARTO' : 'Configure VITE_CARTO_BASEMAP_KEY para habilitar o mapa CARTO'}
            >
              Minimalista (CARTO)
            </button>
          </div>
        </div>
      </div>}
      <dialog
        ref={deleteDialogRef}
        className="admin-delete-dialog"
        aria-labelledby="admin-delete-dialog-title"
        aria-describedby="admin-delete-dialog-description"
        onCancel={(event) => {
          event.preventDefault()
          if (busy) return
          setDeleteTargetId(null)
          setDeleteError('')
        }}
      >
        <h2 id="admin-delete-dialog-title">Remover quadra do mapa?</h2>
        <p id="admin-delete-dialog-description">
          {deleteTarget
            ? <>A quadra <strong>{deleteTarget.codigo}</strong> deixará de aparecer no mapa público. O cadastro e o histórico serão preservados no sistema.</>
            : 'Selecione uma quadra ativa para continuar.'}
        </p>
        {deleteError && <p className="admin-delete-dialog-error" role="alert">{deleteError}</p>}
        <div className="admin-delete-dialog-actions">
          <button
            type="button"
            autoFocus
            onClick={() => {
              setDeleteTargetId(null)
              setDeleteError('')
            }}
            disabled={busy}
          >
            Cancelar
          </button>
          <button type="button" className="destructive-action" onClick={excluirQuadra} disabled={!deleteTarget || busy}>
            {busy ? 'Excluindo…' : 'Excluir'}
          </button>
        </div>
      </dialog>
      {(loading || busy) && <p className="admin-map-feedback admin-map-feedback--status" role="status">{loading ? 'Carregando quadras…' : 'Processando operação administrativa…'}</p>}
      {message && <p className="admin-map-feedback admin-map-feedback--message" role="alert">{message}</p>}
      <div className="map-card admin-map-card">
        <MapContainer center={CENTRO} zoom={14} zoomControl={false} className="map">
          <ZoomControl position="bottomright" />
          <TileLayer
            attribution={BASEMAP_ATTRIBUTION}
            url={baseMap === 'carto' && import.meta.env.VITE_CARTO_BASEMAP_KEY ? CARTO_TILE_URL : OSM_TILE_URL}
          />
          <AdminDrawingMap
            quadras={quadras}
            selectedId={selectedId}
            busy={busy || loading}
            onSelect={setSelectedId}
            onCreate={criar}
            onGeometryEdit={salvarGeometrias}
            onCancel={() => setMessage('Operação cancelada. Nenhuma alteração foi salva.')}
          />
        </MapContainer>
      </div>
    </section>
  )
}
