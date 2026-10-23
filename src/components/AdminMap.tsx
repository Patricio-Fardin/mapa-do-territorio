import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Geometry, MultiPolygon, Polygon } from 'geojson'
import { supabase } from '../lib/supabase'

type Situacao = 'pendente' | 'concluida' | 'refazer'
type Quadra = { id: string; codigo: string; situacao: Situacao; geometria: Geometry }
type GeometriaEditada = { id: string; geometria: Geometry }
type RpcQuadra = { id?: string; codigo?: string; geometria?: Geometry }
type Props = { adminEmail: string; onUnauthorized: () => void }

const CORES: Record<Situacao, string> = { pendente: '#78858a', concluida: '#27ae60', refazer: '#e67e22' }
const NOMES: Record<Situacao, string> = { pendente: 'Pendente', concluida: 'Concluída', refazer: 'Refazer' }
const CENTRO: [number, number] = [-20.6353, -40.7498]

function aplicarEstilo(layer: L.Layer, situacao: Situacao) {
  ;(layer as L.Path).setStyle({ color: CORES[situacao], fillColor: CORES[situacao], fillOpacity: .42, opacity: .95, weight: 2 })
}

function statusDaLinha(row: { situacoes_quadras?: { situacao?: Situacao }[] | null }): Situacao {
  return row.situacoes_quadras?.[0]?.situacao ?? 'pendente'
}

function normalizarQuadras(rows: Array<{ id: string; codigo: string; geometria: Geometry; situacoes_quadras?: { situacao?: Situacao }[] | null }>): Quadra[] {
  return rows.map((row) => ({
    id: row.id,
    codigo: row.codigo,
    geometria: row.geometria,
    situacao: statusDaLinha(row),
  }))
}

async function lerQuadrasAtivas(): Promise<Quadra[]> {
  if (!supabase) throw new Error('Supabase não configurado.')
  const pageSize = 1000
  const quadras: Quadra[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('quadras')
      .select('id,codigo,geometria,ativa,situacoes_quadras(situacao)')
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

function AdminDrawingMap({
  quadras,
  selectedId,
  busy,
  onSelect,
  onCreate,
  onGeometryEdit,
}: {
  quadras: Quadra[]
  selectedId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onCreate: (geometry: Geometry) => void
  onGeometryEdit: (geometries: GeometriaEditada[]) => void
}) {
  const map = useMap()
  const editableGroup = useRef<L.FeatureGroup | null>(null)
  const idsByLayer = useRef(new WeakMap<L.Layer, string>())
  const originalTypes = useRef(new Map<string, Geometry['type']>())
  const callbacks = useRef({ onSelect, onCreate, onGeometryEdit })
  useLayoutEffect(() => {
    callbacks.current = { onSelect, onCreate, onGeometryEdit }
  }, [onSelect, onCreate, onGeometryEdit])

  useEffect(() => {
    const group = L.featureGroup().addTo(map)
    editableGroup.current = group
    return () => {
      editableGroup.current = null
      map.removeLayer(group)
    }
  }, [map])

  useEffect(() => {
    const group = editableGroup.current
    if (!group) return
    group.clearLayers()
    idsByLayer.current = new WeakMap()
    originalTypes.current.clear()
    quadras.forEach((quadra) => {
      originalTypes.current.set(quadra.id, quadra.geometria.type)
      const feature = L.geoJSON(quadra.geometria as Geometry)
      feature.eachLayer((part) => {
        aplicarEstilo(part, quadra.situacao)
        idsByLayer.current.set(part, quadra.id)
        part.on('click', () => callbacks.current.onSelect(quadra.id))
        group.addLayer(part)
      })
    })
  }, [quadras])

  useEffect(() => {
    const group = editableGroup.current
    if (!group) return
    const control = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { allowIntersection: false, showArea: true },
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
      },
      edit: { featureGroup: group, remove: false },
    })
    const controlAdded = !busy
    if (controlAdded) map.addControl(control)

    const created = (event: L.LeafletEvent) => {
      if (busy) return
      const layer = (event as L.DrawEvents.Created).layer
      callbacks.current.onCreate(geometriaDaCamada(layer))
    }
    const edited = (event: L.LeafletEvent) => {
      if (busy) return
      const changed = new Set<string>()
      ;(event as L.DrawEvents.Edited).layers.eachLayer((layer) => {
        const id = idsByLayer.current.get(layer)
        if (id) changed.add(id)
      })
      if (!changed.size || !editableGroup.current) return
      const geometries = [...changed].flatMap((id) => {
        const parts: Geometry[] = []
        editableGroup.current?.eachLayer((layer) => {
          if (idsByLayer.current.get(layer) === id) parts.push(geometriaDaCamada(layer))
        })
        if (!parts.length) return []
        const type = originalTypes.current.get(id)
        const geometry: Geometry = type === 'MultiPolygon'
          ? { type: 'MultiPolygon', coordinates: parts.map((part) => (part as Polygon).coordinates) } as MultiPolygon
          : parts[0]
        return [{ id, geometria: geometry }]
      })
      if (geometries.length) callbacks.current.onGeometryEdit(geometries)
    }

    map.on(L.Draw.Event.CREATED, created)
    map.on(L.Draw.Event.EDITED, edited)
    return () => {
      map.off(L.Draw.Event.CREATED, created)
      map.off(L.Draw.Event.EDITED, edited)
      if (controlAdded) map.removeControl(control)
    }
  }, [map, busy])

  useEffect(() => {
    if (!selectedId || !editableGroup.current) return
    const selectedLayers: L.Layer[] = []
    editableGroup.current.eachLayer((layer) => {
      if (idsByLayer.current.get(layer) === selectedId) selectedLayers.push(layer)
    })
    if (selectedLayers.length) {
      const bounds = L.featureGroup(selectedLayers).getBounds()
      if (bounds.isValid()) map.fitBounds(bounds.pad(.15), { maxZoom: 17 })
    }
  }, [map, selectedId])

  return null
}

export default function AdminMap({ adminEmail, onUnauthorized }: Props) {
  const [quadras, setQuadras] = useState<Quadra[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const operationLock = useRef(false)
  const loadVersion = useRef(0)
  const selected = quadras.find((quadra) => quadra.id === selectedId) ?? null
  const counts = useMemo(() => ({
    total: quadras.length,
    pendente: quadras.filter((quadra) => quadra.situacao === 'pendente').length,
    concluida: quadras.filter((quadra) => quadra.situacao === 'concluida').length,
    refazer: quadras.filter((quadra) => quadra.situacao === 'refazer').length,
  }), [quadras])

  const carregar = useCallback(async () => {
    const version = ++loadVersion.current
    try {
      const result = await lerQuadrasAtivas()
      if (version === loadVersion.current) {
        setQuadras(result)
        setSelectedId((current) => current && result.some((quadra) => quadra.id === current) ? current : null)
      }
      return result
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const version = ++loadVersion.current
    void lerQuadrasAtivas()
      .then((result) => {
        if (active && version === loadVersion.current) {
          setQuadras(result)
          setSelectedId((current) => current && result.some((quadra) => quadra.id === current) ? current : null)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active && version === loadVersion.current) {
          setLoading(false)
          setMessage('Não foi possível carregar as quadras. Verifique a conexão e tente novamente.')
        }
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    const channel = client
      .channel('admin-quadras')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quadras' }, () => { void carregar().catch(() => setMessage('Não foi possível atualizar as quadras. Tente novamente.')) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'situacoes_quadras' }, () => { void carregar().catch(() => setMessage('Não foi possível atualizar as quadras. Tente novamente.')) })
      .subscribe()
    const refreshTimer = window.setInterval(() => {
      void carregar().catch(() => setMessage('Não foi possível atualizar as quadras. Tente novamente.'))
    }, 30_000)
    return () => {
      window.clearInterval(refreshTimer)
      void client.removeChannel(channel)
    }
  }, [carregar])

  const executarAdmin = useCallback(async (operation: () => Promise<void>) => {
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
      } catch {
        loadVersion.current += 1
        setQuadras([])
        setSelectedId(null)
        setMessage((current) => `${current} Não foi possível atualizar a visualização persistida; a lista foi limpa até uma nova leitura bem-sucedida.`)
      }
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }, [adminEmail, carregar, onUnauthorized])

  const criar = useCallback((geometria: Geometry) => {
    void executarAdmin(async () => {
      if (!supabase) throw new Error('Supabase não configurado.')
      const codes = await lerTodosCodigos()
      const maxCode = codes.reduce((max, code) => {
        const match = /^AC-(\d+)$/.exec(code)
        return match ? (BigInt(match[1]) > max ? BigInt(match[1]) : max) : max
      }, 0n)
      const codigo = `AC-${(maxCode + 1n).toString().padStart(3, '0')}`
      const { data, error } = await supabase.rpc('admin_criar_quadra', { p_codigo: codigo, p_geometria: geometria })
      if (error) {
        if (error.code === '23505') throw new Error(`O código ${codigo} foi usado por outra operação. Atualize e tente novamente.`)
        throw new Error('O Supabase não confirmou a criação da quadra. A operação não foi apresentada como salva.')
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
          throw new Error(savedCount
            ? `${savedCount} geometria(s) foram salvas, mas outra alteração falhou. A lista será atualizada com o estado persistido.`
            : 'O Supabase não confirmou a geometria. A visualização será atualizada com o estado persistido.')
        }
        savedCount += 1
      }
      await carregar()
      setMessage(geometries.length === 1 ? 'Geometria salva e recarregada do Supabase.' : 'Geometrias salvas e recarregadas do Supabase.')
    })
  }, [carregar, executarAdmin])

  const arquivar = useCallback(() => {
    if (!selected || !window.confirm(`Arquivar a quadra ${selected.codigo}? Ela deixará de aparecer no mapa público e seu histórico será preservado.`)) return
    void executarAdmin(async () => {
      if (!supabase) throw new Error('Supabase não configurado.')
      const { data, error } = await supabase.rpc('admin_arquivar_quadra', { p_quadra_id: selected.id })
      if (error || data !== true) throw new Error('O Supabase não confirmou o arquivamento.')
      await carregar()
      setSelectedId(null)
      setMessage(`Quadra ${selected.codigo} arquivada. O histórico foi preservado.`)
    })
  }, [carregar, executarAdmin, selected])

  const retryLoad = () => {
    setLoading(true)
    setMessage('')
    void carregar()
      .catch(() => setMessage('Não foi possível carregar as quadras. Verifique a conexão e tente novamente.'))
  }

  return (
    <section className="admin-map">
      <div className="admin-map-toolbar" aria-label="Ferramentas administrativas">
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
          <p>Use o ícone de polígono no mapa para criar. Para editar, selecione a ferramenta de edição e ajuste os vértices.</p>
          <button type="button" onClick={arquivar} disabled={!selected || busy || loading}>Arquivar quadra selecionada</button>
          <button type="button" onClick={retryLoad} disabled={busy || loading}>Atualizar dados</button>
        </div>
      </div>
      {(loading || busy) && <p role="status">{loading ? 'Carregando quadras…' : 'Salvando alterações…'}</p>}
      {message && <p role="alert">{message}</p>}
      <div className="map-card admin-map-card">
        <MapContainer center={CENTRO} zoom={14} zoomControl={false} className="map">
          <ZoomControl position="bottomright" />
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <AdminDrawingMap
            quadras={quadras}
            selectedId={selectedId}
            busy={busy || loading}
            onSelect={setSelectedId}
            onCreate={criar}
            onGeometryEdit={salvarGeometrias}
          />
        </MapContainer>
      </div>
    </section>
  )
}
