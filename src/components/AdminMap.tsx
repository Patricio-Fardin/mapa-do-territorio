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

async function lerQuadrasPorAtividade(ativa: boolean): Promise<Quadra[]> {
  if (!supabase) throw new Error('Supabase não configurado.')
  const pageSize = 1000
  const quadras: Quadra[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('quadras')
      .select('id,codigo,geometria,ativa,situacoes_quadras(situacao,updated_at)')
      .eq('ativa', ativa)
      .order('id')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Não foi possível carregar as quadras ${ativa ? 'ativas' : 'arquivadas'}.`)
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
  const labelsGroup = useRef<L.LayerGroup | null>(null)
  const idsByLayer = useRef(new WeakMap<L.Layer, string>())
  const originalTypes = useRef(new Map<string, Geometry['type']>())
  const callbacks = useRef({ onSelect, onCreate, onGeometryEdit, onCancel })
  const busyRef = useRef(busy)
  const interactionActive = useRef(false)
  const pendingLayerSync = useRef(false)
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
    const labels = L.layerGroup().addTo(map)
    editableGroup.current = group
    labelsGroup.current = labels
    return () => {
      editableGroup.current = null
      labelsGroup.current = null
      map.removeLayer(group)
      map.removeLayer(labels)
    }
  }, [map])

  useEffect(() => {
    const group = editableGroup.current
    if (!group) return
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
            group.addLayer(part)
          })
        })
      })
      syncLabelLayers(currentQuadras.current)
      pendingLayerSync.current = false
    }
    syncLayers.current = sync
    const atualizarRotulos = () => syncLabelLayers(currentQuadras.current)
    map.on('zoomend', atualizarRotulos)
    if (interactionActive.current || busyRef.current) pendingLayerSync.current = true
    else sync()
    return () => {
      map.off('zoomend', atualizarRotulos)
    }
  }, [map, quadras])

  useEffect(() => {
    if (!busy && !interactionActive.current && pendingLayerSync.current) syncLayers.current()
  }, [busy, quadras])

  useEffect(() => {
    const group = editableGroup.current
    if (!group) return
    const control = new L.Control.Draw({
      position: 'topleft',
      draw: {
        // Leaflet Draw's readableArea uses an undeclared variable in strict ESM; this crashes vertexChanged.
        polygon: { allowIntersection: false, showArea: false, maxPoints: 0, repeatMode: false },
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
      },
      edit: { featureGroup: group, remove: false },
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
        editableGroup.current?.eachLayer((layer) => {
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
  const [quadrasArquivadas, setQuadrasArquivadas] = useState<Quadra[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [archivedSelectedId, setArchivedSelectedId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deletePhrase, setDeletePhrase] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const operationLock = useRef(false)
  const loadVersion = useRef(0)
  const selected = quadras.find((quadra) => quadra.id === selectedId) ?? null
  const selectedArchived = quadrasArquivadas.find((quadra) => quadra.id === archivedSelectedId) ?? null
  const deleteTarget = quadras.find((quadra) => quadra.id === deleteTargetId)
    ?? quadrasArquivadas.find((quadra) => quadra.id === deleteTargetId)
    ?? null
  const counts = useMemo(() => ({
    total: quadras.length,
    pendente: quadras.filter((quadra) => quadra.situacao === 'pendente').length,
    concluida: quadras.filter((quadra) => quadra.situacao === 'concluida').length,
    refazer: quadras.filter((quadra) => quadra.situacao === 'refazer').length,
  }), [quadras])

  const carregar = useCallback(async () => {
    const version = ++loadVersion.current
    try {
      const [ativas, arquivadas] = await Promise.all([
        lerQuadrasPorAtividade(true),
        lerQuadrasPorAtividade(false),
      ])
      if (version === loadVersion.current) {
        setQuadras(ativas)
        setQuadrasArquivadas(arquivadas)
        setSelectedId((current) => current && ativas.some((quadra) => quadra.id === current) ? current : null)
        setArchivedSelectedId((current) => current && arquivadas.some((quadra) => quadra.id === current) ? current : null)
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

  const excluirDefinitivamente = useCallback((target: Quadra) => {
    const fraseEsperada = `EXCLUIR ${target.codigo}`
    if (deletePhrase !== fraseEsperada) return
    if (!window.confirm(`Confirma a exclusão permanente da quadra ${target.codigo}? O registro da quadra, sua situação e todo o histórico associado serão apagados. Esta ação é irreversível.`)) return

    void executarAdmin(async () => {
      if (!supabase) throw new Error('Supabase não configurado.')
      let data: boolean | null
      let error: { code?: string } | null
      try {
        const result = await supabase.rpc('admin_excluir_quadra', { p_quadra_id: target.id })
        data = result.data
        error = result.error
      } catch {
        throw new Error(`A exclusão definitiva da quadra ${target.codigo} não foi confirmada. Verifique os dados atualizados antes de tentar novamente.`)
      }
      if (error || data !== true) {
        throw new Error(`A exclusão definitiva da quadra ${target.codigo} não foi confirmada pelo Supabase.`)
      }

      setQuadras((current) => current.filter((quadra) => quadra.id !== target.id))
      setQuadrasArquivadas((current) => current.filter((quadra) => quadra.id !== target.id))
      setSelectedId((current) => current === target.id ? null : current)
      setArchivedSelectedId((current) => current === target.id ? null : current)
      setDeleteTargetId(null)
      setDeletePhrase('')

      try {
        await carregar()
        setMessage(`Quadra ${target.codigo}, sua situação e seu histórico foram excluídos definitivamente.`)
      } catch {
        setMessage(`A exclusão definitiva de ${target.codigo} foi confirmada pelo Supabase. Não foi possível recarregar as listas; use “Atualizar dados”.`)
      }
    }, { preserveDataOnRefreshFailure: true })
  }, [carregar, deletePhrase, executarAdmin])

  const retryLoad = () => {
    setLoading(true)
    setMessage('')
    void carregar()
      .catch((error: unknown) => setMessage(mensagemErroLeitura(error)))
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
          <p>Para criar, escolha o polígono: cada clique marca um vértice. Finalize clicando novamente no primeiro ponto ou dando duplo clique no último. A ferramenta desativa ao concluir; clique no polígono novamente para criar outra quadra. Pressione Esc para cancelar. Para editar, selecione a ferramenta de edição, ajuste os vértices e confirme; o X cancela e restaura a geometria salva.</p>
          <button type="button" onClick={arquivar} disabled={!selected || busy || loading}>Arquivar quadra selecionada</button>
          <button
            type="button"
            className="destructive-action"
            onClick={() => {
              if (!selected) return
              setDeleteTargetId(selected.id)
              setDeletePhrase('')
              setMessage('')
            }}
            disabled={!selected || busy || loading}
          >
            Excluir definitivamente selecionada
          </button>
          <button type="button" onClick={retryLoad} disabled={busy || loading}>Atualizar dados</button>
        </div>
      </div>
      <div className="admin-archive-tools">
        <label>
          Quadras arquivadas
          <select
            value={archivedSelectedId ?? ''}
            onChange={(event) => setArchivedSelectedId(event.target.value || null)}
            disabled={busy || loading || quadrasArquivadas.length === 0}
          >
            <option value="">Selecione uma quadra arquivada</option>
            {quadrasArquivadas.map((quadra) => <option key={quadra.id} value={quadra.id}>{quadra.codigo}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="destructive-action"
          onClick={() => {
            if (!selectedArchived) return
            setDeleteTargetId(selectedArchived.id)
            setDeletePhrase('')
            setMessage('')
          }}
          disabled={!selectedArchived || busy || loading}
        >
          Excluir quadra arquivada definitivamente
        </button>
      </div>
      {quadrasArquivadas.length === 0 && <p className="archived-empty">Nenhuma quadra arquivada disponível.</p>}
      {deleteTarget && <form
        className="delete-confirmation"
        onSubmit={(event) => {
          event.preventDefault()
          excluirDefinitivamente(deleteTarget)
        }}
      >
        <h3>Exclusão permanente de {deleteTarget.codigo}</h3>
        <p>Esta ação é irreversível. Serão apagados o registro da quadra, o registro de situação e todo o histórico associado.</p>
        <label>
          Digite exatamente <strong>EXCLUIR {deleteTarget.codigo}</strong> para continuar
          <input
            type="text"
            value={deletePhrase}
            onChange={(event) => setDeletePhrase(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            required
          />
        </label>
        <div>
          <button type="submit" className="destructive-action" disabled={busy || deletePhrase !== `EXCLUIR ${deleteTarget.codigo}`}>
            {busy ? 'Excluindo…' : 'Confirmar exclusão permanente'}
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteTargetId(null)
              setDeletePhrase('')
            }}
            disabled={busy}
          >
            Cancelar
          </button>
        </div>
      </form>}
      {(loading || busy) && <p role="status">{loading ? 'Carregando quadras…' : 'Processando operação administrativa…'}</p>}
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
            onCancel={() => setMessage('Operação cancelada. Nenhuma alteração foi salva.')}
          />
        </MapContainer>
      </div>
    </section>
  )
}
