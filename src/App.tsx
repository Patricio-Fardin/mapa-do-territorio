import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AttributionControl, MapContainer, TileLayer, useMap } from 'react-leaflet'
import L, { type Layer } from 'leaflet'
import AdminMap from './components/AdminMap'
import { supabase } from './lib/supabase'
import {
  FormatoSituacaoQuadraInvalido,
  normalizarSituacaoQuadra,
  type SituacaoQuadra,
} from './lib/quadra-status'
import { criarIdentificacaoQuadra } from './lib/quadra-label'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import './App.css'

type Situacao = SituacaoQuadra
type Quadra = { id: string; codigo: string; situacao: Situacao; versao: number; updatedAt: string | null; geometria?: GeoJSON.Geometry }
const CORES: Record<Situacao, string> = { pendente: '#78858a', concluida: '#27ae60', refazer: '#e67e22' }
const NOMES: Record<Situacao, string> = { pendente: 'Pendente', concluida: 'Concluída', refazer: 'Refazer' }
const centro: [number, number] = [-20.6353, -40.7498]
const INTERVALO_ATUALIZACAO_MS = 30_000
const DADOS_DESATUALIZADOS_MS = 90_000
const TIMEOUT_RPC_STATUS_MS = 20_000
const TIMEOUT_RECONCILIACAO_MS = 12_000
type EstadoConexao = 'loading' | 'available' | 'unavailable' | 'unknown'
type GravacaoIncerta = {
  version: 2
  id: string
  quadraId: string
  quadraCodigo: string
  situacaoSolicitada: Situacao
  rpcState: 'pending' | 'confirmed' | 'transport-uncertain' | 'resolved'
  rpcError: boolean
  versaoEsperada: number
  message: string
}
type GravacaoPersistida = Omit<GravacaoIncerta, 'message'>
type EstadoPersistencia = 'ready' | 'unavailable' | 'corrupt' | 'coordination-unavailable'
type ResultadoPersistencia = 'ok' | 'unavailable' | 'corrupt'
const CHAVE_GRAVACAO_INCERTA = 'mapa-do-territorio:gravacao-incerta:v1'
const CHAVE_DIAGNOSTICO_GRAVACAO_INCERTA = 'mapa-do-territorio:gravacao-incerta:diagnostico:v1'
const LOCK_GRAVACAO_QUADRAS = 'mapa-do-territorio:gravacao-quadras:v1'

function quarentenarGravacaoPersistida(raw: string): boolean {
  try {
    // Preserve o valor inválido para diagnóstico, mas retire-o da chave ativa
    // para que um registro antigo não mantenha o aviso em todas as visitas.
    if (window.localStorage.getItem(CHAVE_DIAGNOSTICO_GRAVACAO_INCERTA) === null) {
      window.localStorage.setItem(CHAVE_DIAGNOSTICO_GRAVACAO_INCERTA, raw)
    }
    window.localStorage.removeItem(CHAVE_GRAVACAO_INCERTA)
    return true
  } catch {
    return false
  }
}

function validarGravacaoPersistida(value: unknown): value is GravacaoPersistida {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const campos = ['id', 'quadraCodigo', 'quadraId', 'rpcError', 'rpcState', 'situacaoSolicitada', 'version', 'versaoEsperada']
  return Object.keys(record).length === campos.length
    && Object.keys(record).every((campo) => campos.includes(campo))
    && record.version === 2
    && typeof record.id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)
    && typeof record.quadraId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.quadraId)
    && typeof record.quadraCodigo === 'string'
    && record.quadraCodigo.trim().length > 0
    && record.quadraCodigo.length <= 64
    && (record.situacaoSolicitada === 'pendente' || record.situacaoSolicitada === 'concluida' || record.situacaoSolicitada === 'refazer')
    && (record.rpcState === 'pending' || record.rpcState === 'confirmed' || record.rpcState === 'transport-uncertain' || record.rpcState === 'resolved')
    && typeof record.rpcError === 'boolean'
    && typeof record.versaoEsperada === 'number'
    && Number.isInteger(record.versaoEsperada)
    && record.versaoEsperada >= 0
    && (!['pending', 'confirmed', 'resolved'].includes(record.rpcState) || record.rpcError === false)
}

function mesmaGravacao(a: GravacaoPersistida, b: GravacaoPersistida): boolean {
  return a.version === b.version
    && a.id === b.id
    && a.quadraId === b.quadraId
    && a.quadraCodigo === b.quadraCodigo
    && a.situacaoSolicitada === b.situacaoSolicitada
    && a.rpcState === b.rpcState
    && a.rpcError === b.rpcError
    && a.versaoEsperada === b.versaoEsperada
}

function registroPersistivel(record: GravacaoIncerta): GravacaoPersistida {
  return {
    version: record.version,
    id: record.id,
    quadraId: record.quadraId,
    quadraCodigo: record.quadraCodigo,
    situacaoSolicitada: record.situacaoSolicitada,
    rpcState: record.rpcState,
    rpcError: record.rpcError,
    versaoEsperada: record.versaoEsperada,
  }
}

function lerGravacaoPersistida(): { status: EstadoPersistencia; gravacao: GravacaoIncerta | null; record: GravacaoPersistida | null } {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(CHAVE_GRAVACAO_INCERTA)
  } catch {
    return { status: 'unavailable', gravacao: null, record: null }
  }
  if (raw === null) return { status: 'ready', gravacao: null, record: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const quarantined = quarentenarGravacaoPersistida(raw)
    return { status: quarantined ? 'ready' : 'corrupt', gravacao: null, record: null }
  }
  if (!validarGravacaoPersistida(parsed)) {
    const quarantined = quarentenarGravacaoPersistida(raw)
    return { status: quarantined ? 'ready' : 'corrupt', gravacao: null, record: null }
  }
  return {
    status: 'ready',
    record: parsed,
    gravacao: parsed.rpcState === 'resolved' ? null : {
      ...parsed,
      message: `A operação anterior da quadra ${parsed.quadraCodigo} continua não confirmada após recarga. Consulte o estado no servidor antes de tentar outra alteração.`,
    },
  }
}

function gravarPersistencia(record: GravacaoPersistida, expected: GravacaoPersistida | null): ResultadoPersistencia {
  if (!validarGravacaoPersistida(record)) return 'corrupt'
  try {
    const raw = window.localStorage.getItem(CHAVE_GRAVACAO_INCERTA)
    if (raw !== null) {
      let existing: unknown
      try {
        existing = JSON.parse(raw)
      } catch {
        return 'corrupt'
      }
      if (!validarGravacaoPersistida(existing) || !expected || !mesmaGravacao(existing, expected)) return 'corrupt'
    } else if (expected !== null) {
      return 'corrupt'
    }
    window.localStorage.setItem(CHAVE_GRAVACAO_INCERTA, JSON.stringify(record))
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

function aplicarEstilo(layer: Layer, situacao: Situacao) { (layer as L.Path).setStyle({ color: CORES[situacao], fillColor: CORES[situacao], fillOpacity: .42, opacity: .95, weight: 2 }) }

function calcularLimitesQuadras(quadras: Quadra[]): L.LatLngBounds | null {
  const limites = L.latLngBounds([])
  quadras.forEach((quadra) => {
    if (!quadra.geometria) return
    try {
      const limiteQuadra = L.geoJSON(quadra.geometria as GeoJSON.GeoJsonObject).getBounds()
      if (limiteQuadra.isValid()) limites.extend(limiteQuadra)
    } catch {
      // Ignora uma geometria inválida e continua usando as geometrias restantes.
    }
  })
  return limites.isValid() ? limites : null
}

async function lerQuadrasPublicas(client: NonNullable<typeof supabase>): Promise<Quadra[]> {
  const pageSize = 1000
  const quadras: Quadra[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error, status } = await client
      .from('quadras')
      .select('id,codigo,geometria,ativa,situacoes_quadras(situacao,versao,updated_at)')
      .eq('ativa', true)
      .order('id')
      .range(offset, offset + pageSize - 1)
    if (error) throw { error, status }
    quadras.push(...(data ?? []).map((row) => ({
      id: row.id,
      codigo: row.codigo,
      geometria: row.geometria,
      situacao: normalizarSituacaoQuadra(row.situacoes_quadras),
      versao: (() => {
        const relacao = Array.isArray(row.situacoes_quadras) ? row.situacoes_quadras[0] : row.situacoes_quadras
        return relacao && typeof relacao === 'object' && 'versao' in relacao && typeof relacao.versao === 'number' ? relacao.versao : 0
      })(),
      updatedAt: (() => {
        const relacao = Array.isArray(row.situacoes_quadras) ? row.situacoes_quadras[0] : row.situacoes_quadras
        return relacao && typeof relacao === 'object' && 'updated_at' in relacao && typeof relacao.updated_at === 'string' ? relacao.updated_at : null
      })(),
    })))
    if ((data?.length ?? 0) < pageSize) return quadras
  }
}

function mensagemErroLeituraPublica(error: unknown): string {
  return error instanceof FormatoSituacaoQuadraInvalido
    ? 'O banco retornou um formato de situação inválido. Nenhuma situação foi presumida.'
    : 'Não foi possível carregar as quadras. Tente novamente.'
}

function falhaDeConexao(error: unknown): boolean {
  const mensagens: string[] = []
  let atual: unknown = error
  for (let profundidade = 0; profundidade < 3 && atual; profundidade += 1) {
    if (atual instanceof Error) {
      mensagens.push(atual.name, atual.message)
      atual = atual.cause
    } else if (typeof atual === 'object') {
      const objeto = atual as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown; error?: unknown; status?: unknown }
      if (typeof objeto.status === 'number' && (
        objeto.status === 0 || objeto.status >= 500 || [408, 425, 429].includes(objeto.status)
      )) return true
      if (typeof objeto.name === 'string') mensagens.push(objeto.name)
      if (typeof objeto.message === 'string') mensagens.push(objeto.message)
      if (typeof objeto.code === 'string') mensagens.push(objeto.code)
      atual = objeto.cause ?? objeto.error
    } else {
      mensagens.push(String(atual))
      break
    }
  }
  return mensagens.some((mensagem) => (
    /^(AbortError|TimeoutError)$/i.test(mensagem.trim())
    || /\b(failed to fetch|fetch failed|networkerror|load failed|request timed out|timed out)\b/i.test(mensagem)
  ))
}

type RespostaRpc = {
  quadraId: string
  status: 'updated' | 'unchanged' | 'replayed' | 'conflict' | 'rejected'
  situacao?: Situacao
  versao?: number
  updatedAt?: string
}

function respostaDaRpc(data: unknown, quadraId: string): RespostaRpc {
  if (data === null || typeof data !== 'object' || !('quadra_id' in data) || data.quadra_id !== quadraId) {
    throw new FormatoSituacaoQuadraInvalido()
  }
  const temStatus = 'status' in data
  const status = temStatus && typeof data.status === 'string' ? data.status : 'updated'
  if (temStatus && typeof data.status !== 'string') throw new FormatoSituacaoQuadraInvalido()
  if (!['updated', 'unchanged', 'replayed', 'conflict', 'rejected'].includes(status)) {
    throw new FormatoSituacaoQuadraInvalido()
  }
  if (status === 'rejected') return { quadraId, status: 'rejected' }
  if (!('situacao' in data)) throw new FormatoSituacaoQuadraInvalido()
  const versao = 'versao' in data && typeof data.versao === 'number' && Number.isInteger(data.versao) ? data.versao : undefined
  const updatedAt = 'updated_at' in data && typeof data.updated_at === 'string' ? data.updated_at : undefined
  if (temStatus && versao === undefined) throw new FormatoSituacaoQuadraInvalido()
  return { quadraId, status: status as Exclude<RespostaRpc['status'], 'rejected'>, situacao: normalizarSituacaoQuadra(data.situacao), versao, updatedAt }
}

function PersistedLayers({ quadras, onSelect, layers }: { quadras: Quadra[]; onSelect: (id: string) => void; layers: React.MutableRefObject<Map<string, L.Layer[]>> }) {
  const map = useMap()
  useEffect(() => {
    const group = L.featureGroup().addTo(map)
    const labels = L.layerGroup().addTo(map)
    const currentLayers = layers.current
    const atualizarRotulos = () => {
      labels.clearLayers()
      quadras.forEach((quadra) => {
        if (!quadra.geometria) return
        const label = criarIdentificacaoQuadra(map, quadra.geometria, quadra.codigo, quadra.situacao, CORES[quadra.situacao], true, quadra.situacao === 'concluida' ? quadra.updatedAt : null)
        if (label) labels.addLayer(label)
      })
    }
    quadras.forEach((quadra) => {
      if (!quadra.geometria) return
      const feature = L.geoJSON(quadra.geometria as GeoJSON.GeoJsonObject)
      const parts: L.Layer[] = []
      feature.eachLayer((item) => {
        aplicarEstilo(item, quadra.situacao)
        item.on('click', () => onSelect(quadra.id))
        parts.push(item)
        group.addLayer(item)
      })
      currentLayers.set(quadra.id, parts)
    })
    atualizarRotulos()
    map.on('zoomend', atualizarRotulos)
    return () => {
      map.off('zoomend', atualizarRotulos)
      map.removeLayer(group)
      map.removeLayer(labels)
      quadras.forEach((quadra) => currentLayers.delete(quadra.id))
    }
  }, [map, quadras, onSelect, layers])
  return null
}

function MapReference({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    return () => {
      mapRef.current = null
    }
  }, [map, mapRef])
  return null
}

type ResultadoAutorizacao = { autorizado: true } | { autorizado: false; mensagem: string }

function mensagemAutorizacao(resultado: ResultadoAutorizacao): string {
  return 'mensagem' in resultado ? resultado.mensagem : 'Sessão administrativa validada.'
}

async function encerrarSessao(client: NonNullable<typeof supabase>, mensagem: string): Promise<{ autorizado: false; mensagem: string }> {
  try {
    const { error } = await client.auth.signOut({ scope: 'local' })
    if (error) {
      return { autorizado: false, mensagem: `${mensagem} Não foi possível encerrar a sessão; tente sair novamente.` }
    }
  } catch {
    return { autorizado: false, mensagem: `${mensagem} Não foi possível encerrar a sessão; tente sair novamente.` }
  }
  return { autorizado: false, mensagem: `${mensagem} A sessão foi encerrada.` }
}

async function validarPerfilAdmin(client: NonNullable<typeof supabase>, userId: string): Promise<ResultadoAutorizacao> {
  try {
    const { data, error } = await client.from('perfis').select('papel').eq('user_id', userId).maybeSingle()
    if (error) {
      return encerrarSessao(client, 'Não foi possível verificar a autorização administrativa. A sessão foi encerrada.')
    }
    if (data?.papel !== 'admin') {
      return encerrarSessao(client, 'Este usuário não possui autorização administrativa. A sessão foi encerrada.')
    }
    return { autorizado: true }
  } catch {
    return encerrarSessao(client, 'Não foi possível verificar a autorização administrativa. A sessão foi encerrada.')
  }
}

async function validarUsuarioAdmin(
  client: NonNullable<typeof supabase>,
  user: { id: string; email?: string },
  expectedEmail: string,
  expectedUserId?: string,
): Promise<ResultadoAutorizacao> {
  if (
    !user.email ||
    user.email.trim().toLocaleLowerCase() !== expectedEmail.trim().toLocaleLowerCase() ||
    (expectedUserId && user.id !== expectedUserId)
  ) {
    return encerrarSessao(client, 'Não foi possível confirmar a autorização administrativa.')
  }
  return validarPerfilAdmin(client, user.id)
}

type RecoveryCallback =
  | { kind: 'invalid'; expired: boolean }
  | { kind: 'code'; code: string }
  | { kind: 'tokens'; accessToken: string; refreshToken: string }

type AdminView = 'login' | 'recovery-request' | 'recovery-password'
type RecoveryResult = { view: AdminView; message: string; userId: string | null }

function consumirCallbackRecuperacao(): RecoveryCallback | null {
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const errorCode = url.searchParams.get('error_code') ?? hash.get('error_code')
  const error = url.searchParams.get('error') ?? hash.get('error')
  const errorDescription = url.searchParams.get('error_description') ?? hash.get('error_description')
  const type = url.searchParams.get('type') ?? hash.get('type')
  const code = url.searchParams.get('code')
  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  const isRecoveryCallback = type === 'recovery' || Boolean(errorCode || error || errorDescription || code)

  if (!isRecoveryCallback) return null

  window.history.replaceState(window.history.state, document.title, url.pathname)

  if (errorCode || error || errorDescription) {
    const expired = errorCode === 'otp_expired' || error === 'otp_expired' || errorDescription?.toLowerCase().includes('expired')
    return { kind: 'invalid', expired: Boolean(expired) }
  }
  if (code) return { kind: 'code', code }
  if (type === 'recovery' && accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken }
  }
  return { kind: 'invalid', expired: false }
}

async function processarCallbackRecuperacao(
  client: NonNullable<typeof supabase>,
  adminLoginEmail: string,
  callback: RecoveryCallback,
): Promise<RecoveryResult> {
  if (callback.kind === 'invalid') {
    const result = await encerrarSessao(client, 'O link de recuperação expirou ou é inválido.')
    if (result.mensagem.includes('Não foi possível encerrar')) {
      return { view: 'recovery-request', message: result.mensagem, userId: null }
    }
    return {
      view: 'recovery-request',
      message: callback.expired ? 'O link de recuperação expirou. Solicite um novo link.' : result.mensagem,
      userId: null,
    }
  }

  try {
    const sessionResult = callback.kind === 'code'
      ? await client.auth.exchangeCodeForSession(callback.code)
      : await client.auth.setSession({
          access_token: callback.accessToken,
          refresh_token: callback.refreshToken,
        })
    if (sessionResult.error) {
      const expired = 'code' in sessionResult.error && sessionResult.error.code === 'otp_expired'
      const result = await encerrarSessao(client, 'O link de recuperação expirou ou é inválido.')
      if (result.mensagem.includes('Não foi possível encerrar')) {
        return { view: 'recovery-request', message: result.mensagem, userId: null }
      }
      return {
        view: 'recovery-request',
        message: expired ? 'O link de recuperação expirou. Solicite um novo link.' : result.mensagem,
        userId: null,
      }
    }
    if (!sessionResult.data.user) {
      const result = await encerrarSessao(client, 'Não foi possível validar o link de recuperação.')
      return { view: 'recovery-request', message: result.mensagem, userId: null }
    }

    const { data, error } = await client.auth.getUser()
    if (error || !data.user || data.user.id !== sessionResult.data.user.id) {
      const result = await encerrarSessao(client, 'Não foi possível validar o link de recuperação.')
      return { view: 'recovery-request', message: result.mensagem, userId: null }
    }

    const authorization = await validarUsuarioAdmin(client, data.user, adminLoginEmail, sessionResult.data.user.id)
    if (!authorization.autorizado) {
      return {
        view: 'login',
        message: 'Este link não corresponde à conta administrativa autorizada.',
        userId: null,
      }
    }
    return {
      view: 'recovery-password',
      message: 'Link validado. Defina uma nova senha para a conta administrativa.',
      userId: data.user.id,
    }
  } catch {
    const result = await encerrarSessao(client, 'O link de recuperação não pôde ser validado.')
    return { view: 'recovery-request', message: result.mensagem, userId: null }
  }
}

function AdminPage({ onBack }: { onBack: () => void }) {
  const client = supabase
  const adminUsername = import.meta.env.VITE_ADMIN_USERNAME?.trim() || 'admin'
  const adminLoginEmail = import.meta.env.VITE_ADMIN_LOGIN_EMAIL?.trim() || ''
  const [view, setView] = useState<AdminView>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [recoveryUserId, setRecoveryUserId] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [loadingMessage, setLoadingMessage] = useState<string | null>('Verificando sessão…')
  const [autorizado, setAutorizado] = useState(false)
  const submitting = useRef(false)
  const recoveryRequestCooldown = useRef(0)
  const recoveryCallbackRef = useRef<RecoveryCallback | null | undefined>(undefined)
  const recoveryCallbackResultRef = useRef<Promise<RecoveryResult> | null>(null)
  const configurationIncomplete = !client || !adminLoginEmail

  useEffect(() => {
    let active = true
    const verificarSessao = async () => {
      const callback = recoveryCallbackRef.current === undefined
        ? consumirCallbackRecuperacao()
        : recoveryCallbackRef.current
      recoveryCallbackRef.current = callback
      if (!client || !adminLoginEmail) {
        if (callback) setView('recovery-request')
        setMessage('A configuração administrativa está incompleta. Verifique as variáveis do Supabase e do login admin.')
        setLoadingMessage(null)
        return
      }

      try {
        if (callback) {
          setLoadingMessage('Validando link de recuperação…')
          recoveryCallbackResultRef.current ??= processarCallbackRecuperacao(client, adminLoginEmail, callback)
          const result = await recoveryCallbackResultRef.current
          if (active) {
            setRecoveryUserId(result.userId)
            setView(result.view)
            setMessage(result.message)
          }
          return
        }

        const { data, error } = await client.auth.getSession()
        if (error) {
          const resultado = await encerrarSessao(client, 'Não foi possível verificar a sessão.')
          if (active) setMessage(resultado.mensagem)
          return
        }
        if (!data.session?.user) {
          return
        }

        const resultado = await validarUsuarioAdmin(client, data.session.user, adminLoginEmail)
        if (active) {
          setAutorizado(resultado.autorizado)
          setMessage(mensagemAutorizacao(resultado))
        }
      } catch {
        const resultado = await encerrarSessao(client, 'Não foi possível verificar a sessão.')
        if (active) setMessage(resultado.mensagem)
      } finally {
        if (active) setLoadingMessage(null)
      }
    }

    void verificarSessao()
    return () => {
      active = false
    }
  }, [client, adminLoginEmail])

  useEffect(() => {
    if (!client) return
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAutorizado(false)
        setRecoveryUserId(null)
        setView('login')
        setMessage('Sessão encerrada.')
      }
    })
    return () => subscription.unsubscribe()
  }, [client])

  const onAdminUnauthorized = useCallback(() => {
    setAutorizado(false)
    setRecoveryUserId(null)
    setMessage('A sessão administrativa não é mais válida. Entre novamente.')
  }, [])

  const entrar = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!client || configurationIncomplete || loadingMessage || submitting.current) return
    submitting.current = true
    setLoadingMessage('Validando acesso…')
    setMessage('')
    try {
      if (username.trim().toLocaleLowerCase() !== adminUsername.toLocaleLowerCase()) {
        setMessage('Usuário ou senha inválidos.')
        return
      }
      const { data, error } = await client.auth.signInWithPassword({
        email: adminLoginEmail,
        password,
      })
      if (error) {
        setMessage('Usuário ou senha inválidos.')
        return
      }
      if (!data.user) {
        const resultado = await encerrarSessao(client, 'Não foi possível concluir o acesso.')
        setMessage(resultado.mensagem)
        return
      }
      const resultado = await validarUsuarioAdmin(client, data.user, adminLoginEmail)
      setAutorizado(resultado.autorizado)
      setMessage(mensagemAutorizacao(resultado))
    } catch {
      const resultado = await encerrarSessao(client, 'Não foi possível concluir o acesso.')
      setMessage(resultado.mensagem)
    } finally {
      setPassword('')
      submitting.current = false
      setLoadingMessage(null)
    }
  }

  const solicitarRecuperacao = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!client || configurationIncomplete || loadingMessage || submitting.current) return
    if (Date.now() < recoveryRequestCooldown.current) {
      setMessage('Aguarde 60 segundos antes de solicitar outro código.')
      return
    }
    submitting.current = true
    setLoadingMessage('Solicitando código…')
    setMessage('')
    try {
      recoveryRequestCooldown.current = Date.now() + 60_000
      const redirectTo = new URL('admin', `${window.location.origin}${import.meta.env.BASE_URL}`).toString()
      const { error } = await client.auth.resetPasswordForEmail(adminLoginEmail, { redirectTo })
      if (error) {
        setMessage('Não foi possível solicitar o link agora. Aguarde e tente novamente.')
        return
      }
      setView('login')
      setMessage('Se a conta administrativa estiver disponível, um link de recuperação será enviado. Aguarde 60 segundos antes de pedir outro.')
    } catch {
      setMessage('Não foi possível solicitar o link agora. Aguarde e tente novamente.')
    } finally {
      submitting.current = false
      setLoadingMessage(null)
    }
  }

  const atualizarSenha = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!client || configurationIncomplete || loadingMessage || submitting.current) return
    if (password.length < 6) {
      setMessage('A senha deve ter pelo menos seis caracteres.')
      return
    }
    if (password !== passwordConfirmation) {
      setMessage('As senhas não coincidem.')
      return
    }
    if (!recoveryUserId) {
      setView('recovery-request')
      setMessage('A validação expirou. Solicite um novo código.')
      return
    }

    submitting.current = true
    setLoadingMessage('Atualizando senha…')
    setMessage('')
    try {
      const { data, error: sessionError } = await client.auth.getUser()
      if (sessionError || !data.user) {
        const resultado = await encerrarSessao(client, 'A validação expirou. Solicite um novo código.')
        setView('recovery-request')
        setMessage(resultado.mensagem)
        return
      }

      const resultado = await validarUsuarioAdmin(client, data.user, adminLoginEmail, recoveryUserId)
      if (!resultado.autorizado) {
        setRecoveryUserId(null)
        setView('login')
        setMessage('Não foi possível confirmar a autorização administrativa. Entre em contato com o responsável.')
        return
      }

      const { error } = await client.auth.updateUser({ password })
      if (error) {
        setMessage('Não foi possível atualizar a senha. Verifique os requisitos e tente novamente.')
        return
      }

      const { data: updatedUser, error: updatedUserError } = await client.auth.getUser()
      if (updatedUserError || !updatedUser.user) {
        const failedAuthorization = await encerrarSessao(client, 'A senha foi alterada, mas não foi possível confirmar a autorização.')
        setAutorizado(false)
        setRecoveryUserId(null)
        setView('login')
        setMessage(failedAuthorization.mensagem)
        return
      }
      const updatedAuthorization = await validarUsuarioAdmin(client, updatedUser.user, adminLoginEmail, recoveryUserId)
      if (!updatedAuthorization.autorizado) {
        setAutorizado(false)
        setRecoveryUserId(null)
        setView('login')
        setMessage('A senha foi alterada, mas não foi possível confirmar a autorização administrativa.')
        return
      }

      setPassword('')
      setPasswordConfirmation('')
      setRecoveryUserId(null)
      setAutorizado(true)
      setView('login')
      setMessage('Senha atualizada e autorização administrativa confirmada.')
    } catch {
      setMessage('Não foi possível atualizar a senha. Tente novamente.')
    } finally {
      setPassword('')
      setPasswordConfirmation('')
      submitting.current = false
      setLoadingMessage(null)
    }
  }

  const sair = async () => {
    if (!client || loadingMessage || submitting.current) return
    submitting.current = true
    setLoadingMessage('Encerrando sessão…')
    setMessage('')
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) {
        setMessage('Não foi possível encerrar a sessão. Tente novamente.')
        return
      }
      setAutorizado(false)
      setMessage('Sessão encerrada.')
    } catch {
      setMessage('Não foi possível encerrar a sessão. Tente novamente.')
    } finally {
      submitting.current = false
      setLoadingMessage(null)
    }
  }

  return (
    <main className={`admin-page${autorizado ? ' admin-page-wide' : ''}`}>
      <button onClick={onBack}>← Voltar ao mapa</button>
      <h1>Área administrativa</h1>
      {loadingMessage && <p role="status">{loadingMessage}</p>}
      {!loadingMessage && autorizado ? (
        <section>
          <p>Sessão administrativa validada. Alterações estruturais são salvas pelo Supabase e protegidas pelas funções administrativas do banco.</p>
          <AdminMap
            adminEmail={adminLoginEmail}
            onUnauthorized={onAdminUnauthorized}
          />
          <button className="primary-action" onClick={() => void sair()} disabled={Boolean(loadingMessage) || !client}>Encerrar sessão</button>
        </section>
      ) : !loadingMessage && view === 'login' ? (
        <form onSubmit={(event) => void entrar(event)}>
          <p>Entre com o nome de usuário e a senha da conta administrativa existente.</p>
          <label>Nome de usuário<input type="text" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" disabled={configurationIncomplete} /></label>
          <label>Senha<input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" disabled={configurationIncomplete} /></label>
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} disabled={configurationIncomplete}>{showPassword ? 'Ocultar senha' : 'Mostrar senha'}</button>
          <button className="primary-action" type="submit" disabled={configurationIncomplete}>Entrar</button>
          <button type="button" onClick={() => { setView('recovery-request'); setMessage('') }} disabled={configurationIncomplete}>Esqueci minha senha</button>
        </form>
      ) : !loadingMessage && view === 'recovery-request' ? (
        <form onSubmit={(event) => void solicitarRecuperacao(event)}>
          <p>Solicite um link de recuperação para a conta administrativa. O link será enviado ao e-mail associado a essa conta.</p>
          <button className="primary-action" type="submit" disabled={configurationIncomplete}>Enviar link de recuperação</button>
          <button type="button" onClick={() => { setView('login'); setMessage('') }}>Voltar ao login</button>
        </form>
      ) : !loadingMessage && view === 'recovery-password' ? (
        <form onSubmit={(event) => void atualizarSenha(event)}>
          <p>Defina uma nova senha para a conta administrativa autorizada.</p>
          <label>Nova senha<input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} autoComplete="new-password" /></label>
          <label>Confirme a nova senha<input type={showPassword ? 'text' : 'password'} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required minLength={6} autoComplete="new-password" /></label>
          <button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Ocultar senha' : 'Mostrar senha'}</button>
          <button className="primary-action" type="submit">Atualizar senha</button>
        </form>
      ) : null}
      {message && <p role="alert">{message}</p>}
    </main>
  )
}

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '')
const appPath = (path: string) => `${BASE_PATH}${path}` || '/'
const routePath = () => { const pathname = window.location.pathname; return BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || '/' : pathname }

function MapPage() {
  const client = supabase
  const [persistenciaInicial] = useState(lerGravacaoPersistida)
  const [quadras, setQuadras] = useState<Quadra[]>([])
  const [quadrasCarregadas, setQuadrasCarregadas] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<EstadoConexao>(client ? 'loading' : 'unknown')
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [noticeDismissed, setNoticeDismissed] = useState(false)
  const [lastSuccessfulLoadAt, setLastSuccessfulLoadAt] = useState<number | null>(null)
  const [clock, setClock] = useState(0)
  const [statusFeedback, setStatusFeedback] = useState('')
  const [statusFeedbackKind, setStatusFeedbackKind] = useState<'success' | 'error'>('success')
  const [savingStatus, setSavingStatus] = useState(false)
  const [waitingForCoordination, setWaitingForCoordination] = useState(false)
  const [pendingSave, setPendingSave] = useState<GravacaoIncerta | null>(persistenciaInicial.gravacao)
  const [storageStatus, setStorageStatus] = useState<EstadoPersistencia>(persistenciaInicial.status)
  const [coordinationAvailable, setCoordinationAvailable] = useState(
    typeof navigator !== 'undefined' && Boolean(navigator.locks?.request),
  )
  const [reconcilingPendingSave, setReconcilingPendingSave] = useState(false)
  const [statusFeedbackQuadraId, setStatusFeedbackQuadraId] = useState<string | null>(null)
  const statusLocks = useRef(new Set<string>())
  const operacaoSequencia = useRef(new Map<string, number>())
  const pendingSaveRef = useRef<GravacaoIncerta | null>(persistenciaInicial.gravacao)
  const persistedRecordRef = useRef<GravacaoPersistida | null>(persistenciaInicial.record)
  const reconciliationLock = useRef(false)
  const reconciliationAgainRequested = useRef(false)
  const reconciliationActionRef = useRef<(allowResolution?: boolean) => Promise<void>>(async () => {})
  const loadVersion = useRef(0)
  const loadInFlight = useRef<Promise<Quadra[] | null> | null>(null)
  const hasLoadedData = useRef(false)
  const lastSuccessfulLoadAtRef = useRef<number | null>(null)
  const layers = useRef(new Map<string, L.Layer[]>())
  const mapRef = useRef<L.Map | null>(null)
  const initialViewRestored = useRef(false)
  const selectedRef = useRef<string | null>(null)

  const carregarQuadras = useCallback((forcar = false): Promise<Quadra[] | null> => {
    if (!client) return Promise.resolve(null)
    if (loadInFlight.current && !forcar) return loadInFlight.current
    const version = ++loadVersion.current
    if (!hasLoadedData.current) setConnectionStatus('loading')
    setRefreshing(true)
    const request = (async (): Promise<Quadra[] | null> => {
      try {
        const result = await lerQuadrasPublicas(client)
        if (version !== loadVersion.current) return null
        const loadedAt = Date.now()
        hasLoadedData.current = true
        lastSuccessfulLoadAtRef.current = loadedAt
        setLastSuccessfulLoadAt(loadedAt)
        setQuadras(result)
        setQuadrasCarregadas(true)
        setConnectionStatus('available')
        setLoadError('')
        setNoticeDismissed(false)
        return result
      } catch (error: unknown) {
        if (version === loadVersion.current) {
          setConnectionStatus(falhaDeConexao(error) ? 'unavailable' : 'unknown')
          setLoadError(mensagemErroLeituraPublica(error))
          setNoticeDismissed(false)
        }
        return null
      } finally {
        if (version === loadVersion.current) setRefreshing(false)
      }
    })()
    loadInFlight.current = request
    void request.then(
      () => { if (loadInFlight.current === request) loadInFlight.current = null },
      () => { if (loadInFlight.current === request) loadInFlight.current = null },
    )
    return request
  }, [client])

  const atualizarGravacaoIncerta = (gravacao: GravacaoIncerta | null) => {
    const atual = pendingSaveRef.current
    const novoRegistro = gravacao
      ? registroPersistivel(gravacao)
      : atual
        ? registroPersistivel({ ...atual, rpcState: 'resolved' })
        : persistedRecordRef.current
    const resultado = novoRegistro
      ? gravarPersistencia(novoRegistro, persistedRecordRef.current)
      : 'ok'
    if (resultado !== 'ok') {
      setStorageStatus(resultado)
      if (atual) {
        setPendingSave({
          ...atual,
          message: resultado === 'unavailable'
            ? `O registro local da operação da quadra ${atual.quadraCodigo} não pôde ser atualizado. A gravação permanece bloqueada.`
            : `O registro local da operação da quadra ${atual.quadraCodigo} mudou ou está inválido. A gravação permanece bloqueada.`,
        })
      }
      return false
    }
    pendingSaveRef.current = gravacao
    persistedRecordRef.current = novoRegistro
    setPendingSave(gravacao)
    setStorageStatus('ready')
    return true
  }

  const atualizarMensagemGravacaoLocal = (id: string, message: string) => {
    const atual = pendingSaveRef.current
    if (!atual || atual.id !== id) return
    const atualizado = { ...atual, message }
    pendingSaveRef.current = atualizado
    setPendingSave(atualizado)
  }

  const resolverGravacaoTerminal = (id: string): boolean => {
    if (!pendingSaveRef.current || pendingSaveRef.current.id !== id) return false
    const persistida = atualizarGravacaoIncerta(null)
    if (!persistida) {
      // O servidor já devolveu um resultado terminal. Se outra aba removeu
      // ou migrou o registro, não mantenha uma operação fantasma na memória.
      pendingSaveRef.current = null
      setPendingSave(null)
      const estadoLocal = lerGravacaoPersistida()
      if (estadoLocal.status === 'ready' && !estadoLocal.record) {
        persistedRecordRef.current = null
        setStorageStatus('ready')
      }
    }
    return true
  }

  const definirFeedback = (quadraId: string, mensagem: string, tipo: 'success' | 'error') => {
    setStatusFeedbackQuadraId(quadraId)
    setStatusFeedback(mensagem)
    setStatusFeedbackKind(tipo)
  }

  async function reconciliarGravacaoIncerta(permitirResolucao = false): Promise<void> {
    const pendente = pendingSaveRef.current
    if (!client || !pendente) return
    if (reconciliationLock.current) {
      if (permitirResolucao) reconciliationAgainRequested.current = true
      return
    }
    reconciliationLock.current = true
    setReconcilingPendingSave(true)
    const rpcStateAtStart = pendente.rpcState
    let consulta: Promise<Quadra[] | null> | null = null
    let timeoutId = 0
    try {
      const consultaOperacao = client.rpc('consultar_operacao_situacao_quadra', { p_operacao_id: pendente.id })
      const resultadoOperacao = await Promise.race([
        consultaOperacao.then(({ data, error }) => ({ kind: 'result' as const, data, error })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          window.setTimeout(() => resolve({ kind: 'timeout' }), TIMEOUT_RECONCILIACAO_MS)
        }),
      ])
      // A consulta da operação pode falhar ou não encontrar registros antigos.
      // A leitura pública versionada abaixo pode confirmar o estado final por si só.
      if (resultadoOperacao.kind === 'result' && !resultadoOperacao.error && resultadoOperacao.data) {
        try {
          const operacao = respostaDaRpc(resultadoOperacao.data, pendente.quadraId)
          if (operacao.status === 'conflict' || operacao.status === 'rejected') {
            const gravacaoAtual = pendingSaveRef.current
            if (!gravacaoAtual || gravacaoAtual.id !== pendente.id) return
            if (operacao.status === 'conflict' && operacao.situacao && operacao.versao !== undefined) {
              const situacaoAtual: Situacao = operacao.situacao
              const versaoAtual: number = operacao.versao
              setQuadras((items) => items.map((quadra) => quadra.id === pendente.quadraId
                ? { ...quadra, situacao: situacaoAtual, versao: versaoAtual }
                : quadra))
            }
            resolverGravacaoTerminal(pendente.id)
            definirFeedback(pendente.quadraId, `A operação da quadra ${pendente.quadraCodigo} terminou como ${operacao.status}.`, 'error')
            return
          }
          if (operacao.status === 'updated' || operacao.status === 'unchanged' || operacao.status === 'replayed') {
            const gravacaoAtual = pendingSaveRef.current
            if (!gravacaoAtual || gravacaoAtual.id !== pendente.id) return
            if (!resolverGravacaoTerminal(pendente.id)) return
            if (!operacao.situacao) return
            const situacaoAtual: Situacao = operacao.situacao
            setQuadras((items) => items.map((quadra) => quadra.id === pendente.quadraId
              ? { ...quadra, situacao: situacaoAtual, versao: operacao.versao ?? quadra.versao }
              : quadra))
            setStatusFeedback('')
            setStatusFeedbackQuadraId(null)
            return
          }
        } catch {
          // Resposta desconhecida segue para a consulta pública de compatibilidade.
        }
      }
      consulta = carregarQuadras(true)
      const resultadoConsulta = await Promise.race([
        consulta.then((resultado) => ({ kind: 'result' as const, resultado })),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timeoutId = window.setTimeout(() => resolve({ kind: 'timeout' }), TIMEOUT_RECONCILIACAO_MS)
        }),
      ])
      const gravacaoAtual = pendingSaveRef.current
      if (!gravacaoAtual || gravacaoAtual.id !== pendente.id) return
      if (resultadoConsulta.kind === 'timeout') {
        if (loadInFlight.current === consulta) {
          loadVersion.current += 1
          loadInFlight.current = null
          setRefreshing(false)
        }
        atualizarMensagemGravacaoLocal(gravacaoAtual.id, `A consulta expirou. A operação da quadra ${pendente.quadraCodigo} continua não confirmada; tente consultar novamente.`)
        return
      }

      const resultado = resultadoConsulta.resultado
      const atualPersistido = resultado?.find((quadra) => quadra.id === pendente.quadraId)
      if (!resultado || !atualPersistido) {
        atualizarMensagemGravacaoLocal(
          gravacaoAtual.id,
          resultado
            ? `A quadra ${pendente.quadraCodigo} não foi encontrada. A gravação ainda não foi confirmada; consulte novamente.`
            : `A consulta da quadra ${pendente.quadraCodigo} falhou. A gravação ainda não foi confirmada; tente consultar novamente.`,
        )
        return
      }

      // Se a consulta da operação respondeu validamente que o UUID não existe,
      // mas a versão da quadra já avançou, uma tentativa antiga com a versão
      // esperada anterior não poderá gravar por cima do estado atual via RPC v2.
      if (
        atualPersistido.versao > pendente.versaoEsperada
        && atualPersistido.situacao === pendente.situacaoSolicitada
      ) {
        if (!resolverGravacaoTerminal(pendente.id)) return
        setQuadras((items) => items.map((quadra) => quadra.id === pendente.quadraId
          ? { ...quadra, situacao: atualPersistido.situacao, versao: atualPersistido.versao, updatedAt: atualPersistido.updatedAt }
          : quadra))
        // A mudança de cor e situação no mapa já fornece o feedback visual.
        // Não exiba uma mensagem de sucesso redundante após reconciliar o registro local.
        setStatusFeedback('')
        setStatusFeedbackQuadraId(null)
        return
      }

      if (rpcStateAtStart === 'confirmed' && gravacaoAtual.rpcState === 'confirmed') {
        if (permitirResolucao) {
          if (!atualizarGravacaoIncerta(null)) return
        } else {
          atualizarMensagemGravacaoLocal(
            gravacaoAtual.id,
            `A resposta da operação da quadra ${pendente.quadraCodigo} foi recebida. A consulta encontrou ${NOMES[atualPersistido.situacao]}; o registro permanece protegido até a reconciliação coordenada.`,
          )
          return
        }
        if (gravacaoAtual.rpcError || atualPersistido.situacao !== pendente.situacaoSolicitada) {
          definirFeedback(
            pendente.quadraId,
            gravacaoAtual.rpcError
              ? `A operação da quadra ${pendente.quadraCodigo} retornou erro. Estado persistido atual: ${NOMES[atualPersistido.situacao]}.`
              : `O servidor confirmou outro estado para a quadra ${pendente.quadraCodigo}: ${NOMES[atualPersistido.situacao]}.`,
            'error',
          )
        } else {
          setStatusFeedback('')
          setStatusFeedbackQuadraId(null)
        }
        return
      }

      atualizarMensagemGravacaoLocal(
        gravacaoAtual.id,
        gravacaoAtual.rpcState === 'transport-uncertain'
          ? `A consulta encontrou ${NOMES[atualPersistido.situacao]} para a quadra ${pendente.quadraCodigo}, mas uma falha de transporte não confirma se a operação original ainda pode produzir efeitos. Alterações continuam bloqueadas; consulte novamente.`
          : `O servidor mostra ${NOMES[atualPersistido.situacao]} para a quadra ${pendente.quadraCodigo}, mas a resposta da operação original ainda não foi confirmada. Novas alterações permanecem bloqueadas.`,
      )
    } catch {
      const gravacaoAtual = pendingSaveRef.current
      if (gravacaoAtual?.id === pendente.id) {
        atualizarMensagemGravacaoLocal(gravacaoAtual.id, `A consulta da quadra ${pendente.quadraCodigo} falhou. A gravação ainda não foi confirmada; tente consultar novamente.`)
      }
    } finally {
      window.clearTimeout(timeoutId)
      reconciliationLock.current = false
      setReconcilingPendingSave(false)
      if (reconciliationAgainRequested.current) {
        reconciliationAgainRequested.current = false
        void Promise.resolve().then(() => reconciliarGravacaoIncerta(permitirResolucao))
      }
    }
  }

  async function consultarGravacaoIncerta(): Promise<void> {
    if (!client || !pendingSaveRef.current) return
    if (!navigator.locks?.request) {
      await reconciliarGravacaoIncerta()
      return
    }
    let adquiriuLock = false
    try {
      await navigator.locks.request(
        LOCK_GRAVACAO_QUADRAS,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) return
          const persisted = lerGravacaoPersistida()
          setStorageStatus(persisted.status)
          if (persisted.status !== 'ready') {
            if (pendingSaveRef.current) {
              atualizarMensagemGravacaoLocal(
                pendingSaveRef.current.id,
                `O armazenamento da operação da quadra ${pendingSaveRef.current.quadraCodigo} não pode ser verificado. A operação continua bloqueada.`,
              )
              adquiriuLock = true
              return
            }
            return
          }
          if (persisted.status === 'ready' && !persisted.record && pendingSaveRef.current) {
            persistedRecordRef.current = null
            const operacaoAtual = pendingSaveRef.current
            if (!atualizarGravacaoIncerta(operacaoAtual)) {
              setStorageStatus('corrupt')
              atualizarMensagemGravacaoLocal(
                operacaoAtual.id,
                `O registro local da quadra ${operacaoAtual.quadraCodigo} não pôde ser restaurado. Consulte novamente o servidor.`,
              )
              adquiriuLock = true
              return
            }
            adquiriuLock = true
            await reconciliationActionRef.current(true)
            return
          }
          persistedRecordRef.current = persisted.record
          pendingSaveRef.current = persisted.gravacao
          setPendingSave(persisted.gravacao)
          if (persisted.status !== 'ready' || !persisted.gravacao) return
          adquiriuLock = true
          await reconciliationActionRef.current(true)
          return
        },
      )
    } catch {
      setCoordinationAvailable(false)
      setStorageStatus('coordination-unavailable')
    }
    if (!adquiriuLock) await reconciliarGravacaoIncerta()
  }

  useEffect(() => {
    reconciliationActionRef.current = reconciliarGravacaoIncerta
  })

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CHAVE_GRAVACAO_INCERTA && event.key !== null) return
      const persisted = lerGravacaoPersistida()
      if (persisted.status !== 'ready') {
        setStorageStatus(persisted.status)
        if (pendingSaveRef.current) {
          atualizarMensagemGravacaoLocal(
            pendingSaveRef.current.id,
            `O armazenamento da operação da quadra ${pendingSaveRef.current.quadraCodigo} não pode ser verificado. A operação continua bloqueada.`,
          )
        }
        return
      }
      if (persisted.status === 'ready' && !persisted.record && pendingSaveRef.current) {
        // Outra aba pode ter removido o registro enquanto esta aba ainda mantém
        // uma operação válida em memória. Restaure-a com comparação otimista e
        // consulte o servidor, em vez de deixar um aviso permanente nesta aba.
        persistedRecordRef.current = null
        const operacaoAtual = pendingSaveRef.current
        if (!atualizarGravacaoIncerta(operacaoAtual)) {
          atualizarMensagemGravacaoLocal(
            operacaoAtual.id,
            `O registro local da quadra ${operacaoAtual.quadraCodigo} não pôde ser restaurado. Consulte novamente o servidor.`,
          )
          return
        }
        void reconciliationActionRef.current(true)
        return
      }
      setStorageStatus(persisted.status)
      persistedRecordRef.current = persisted.record
      pendingSaveRef.current = persisted.gravacao
      setPendingSave(persisted.gravacao)
      if (!persisted.gravacao && persisted.status === 'ready') void carregarQuadras(true)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [carregarQuadras])

  useEffect(() => {
    if (!client) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      if (!navigator.locks?.request) {
        setCoordinationAvailable(false)
        setStorageStatus('coordination-unavailable')
        void carregarQuadras()
        return
      }
      void navigator.locks.request(LOCK_GRAVACAO_QUADRAS, { mode: 'exclusive' }, async (lock) => {
        if (!lock || !active) return
        const persisted = lerGravacaoPersistida()
        setStorageStatus(persisted.status)
        if (persisted.status !== 'ready') {
          if (pendingSaveRef.current) {
            atualizarMensagemGravacaoLocal(
              pendingSaveRef.current.id,
              `O armazenamento da operação da quadra ${pendingSaveRef.current.quadraCodigo} não pode ser verificado. A operação continua bloqueada.`,
            )
            return
          }
          return
        }
        if (!persisted.record && pendingSaveRef.current) {
          persistedRecordRef.current = null
          const operacaoAtual = pendingSaveRef.current
          if (!atualizarGravacaoIncerta(operacaoAtual)) {
            setStorageStatus('corrupt')
            atualizarMensagemGravacaoLocal(
              operacaoAtual.id,
              `O registro local da quadra ${operacaoAtual.quadraCodigo} não pôde ser restaurado. Consulte novamente o servidor.`,
            )
            return
          }
          await reconciliationActionRef.current(true)
          return
        }
        persistedRecordRef.current = persisted.record
        pendingSaveRef.current = persisted.gravacao
        setPendingSave(persisted.gravacao)
        if (persisted.status !== 'ready') return
        if (!persisted.gravacao) {
          void carregarQuadras()
          return
        }
        await reconciliationActionRef.current(true)
        return
      }).catch(() => {
        setCoordinationAvailable(false)
        setStorageStatus('coordination-unavailable')
      })
    })
    const channel = client
      .channel('mapa-publico')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'situacoes_quadras' }, () => { void carregarQuadras() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quadras' }, () => { void carregarQuadras() })
      .subscribe()
    const refreshTimer = window.setInterval(() => {
      setClock(Date.now())
      void carregarQuadras()
    }, INTERVALO_ATUALIZACAO_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const lastSuccess = lastSuccessfulLoadAtRef.current
      if (!lastSuccess || Date.now() - lastSuccess >= INTERVALO_ATUALIZACAO_MS) {
        setClock(Date.now())
        void carregarQuadras()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      loadVersion.current += 1
      loadInFlight.current = null
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', onVisible)
      void client.removeChannel(channel)
    }
  }, [client, carregarQuadras])

  const select = useCallback((id: string) => {
    selectedRef.current = id
    setSelected(id)
    setStatusFeedback('')
    setStatusFeedbackQuadraId(null)
  }, [])
  const atual = quadras.find((quadra) => quadra.id === selected)
  const dadosRecentes = lastSuccessfulLoadAt !== null && clock - lastSuccessfulLoadAt <= DADOS_DESATUALIZADOS_MS
  // A interface não deve manter os botões bloqueados por dados antigos,
  // reconciliação local ou atualização em segundo plano. A RPC versionada
  // continua sendo a autoridade para aceitar ou rejeitar a alteração.
  const podeAlterar = Boolean(client && quadrasCarregadas)
  const counts = useMemo(() => ({
    total: quadras.length,
    pendente: quadras.filter((quadra) => quadra.situacao === 'pendente').length,
    concluida: quadras.filter((quadra) => quadra.situacao === 'concluida').length,
    refazer: quadras.filter((quadra) => quadra.situacao === 'refazer').length,
  }), [quadras])

  const restaurarVisaoMapa = () => {
    const map = mapRef.current
    if (!map) return
    const bounds = calcularLimitesQuadras(quadras)
    if (bounds) {
      map.fitBounds(bounds, { maxZoom: 17, paddingTopLeft: [20, 116], paddingBottomRight: [20, 24] })
    } else {
      map.setView(centro, 14)
    }
  }

  useEffect(() => {
    if (!quadrasCarregadas || initialViewRestored.current || !mapRef.current) return
    const bounds = calcularLimitesQuadras(quadras)
    if (!bounds) return
    mapRef.current.fitBounds(bounds, { maxZoom: 17, paddingTopLeft: [20, 116], paddingBottomRight: [20, 24] })
    initialViewRestored.current = true
  }, [quadras, quadrasCarregadas])

  const alterar = async (situacao: Situacao) => {
    if (!atual || !client || !podeAlterar || statusLocks.current.has(atual.id)) return
    const quadraId = atual.id
    const quadraCodigo = atual.codigo
    const operationToken = (operacaoSequencia.current.get(quadraId) ?? 0) + 1
    operacaoSequencia.current.set(quadraId, operationToken)
    let persistenciaLocalAtiva = true
    statusLocks.current.add(quadraId)
    setSavingStatus(true)
    setWaitingForCoordination(true)
    setStatusFeedback('')
    setStatusFeedbackQuadraId(quadraId)

    const executarSobLock = async (): Promise<void> => {
      const persisted = lerGravacaoPersistida()
      setWaitingForCoordination(false)
      if (persisted.status !== 'ready') {
        setStorageStatus(persisted.status)
        persistenciaLocalAtiva = false
      }
      persistedRecordRef.current = persisted.record
      if (persisted.gravacao?.quadraId === quadraId) {
        // Não transforme um registro local incerto em bloqueio permanente.
        // A nova tentativa usa a versão esperada do cliente e a RPC rejeita
        // conflitos sem sobrescrever silenciosamente uma alteração concorrente.
        pendingSaveRef.current = persisted.gravacao
        setPendingSave(persisted.gravacao)
      }
      if (persisted.gravacao && persisted.gravacao.quadraId !== quadraId) {
        persistenciaLocalAtiva = false
        setConnectionStatus('unknown')
      }

      let saveId: string
      try {
        saveId = crypto.randomUUID()
      } catch {
        setCoordinationAvailable(false)
        setStorageStatus('coordination-unavailable')
        setSavingStatus(false)
        return
      }
      const message = `Não foi possível confirmar se a alteração da quadra ${quadraCodigo} foi salva. A gravação permanece pendente de verificação.`
      const novoRegistro: GravacaoIncerta = {
        version: 2,
        id: saveId,
        quadraId,
        quadraCodigo,
        situacaoSolicitada: situacao,
        rpcState: 'pending',
        rpcError: false,
        versaoEsperada: atual.versao,
        message,
      }
      if (persistenciaLocalAtiva && !atualizarGravacaoIncerta(novoRegistro)) {
        persistenciaLocalAtiva = false
        setConnectionStatus('unknown')
        definirFeedback(quadraId, 'A operação será tentada, mas não pôde ser registrada localmente; o resultado dependerá da resposta do servidor.', 'error')
      }

      const marcarGravacaoIncerta = (rpcState: GravacaoIncerta['rpcState'], rpcError = false): boolean => {
        if (!persistenciaLocalAtiva) return true
        const pendente = pendingSaveRef.current
        if (!pendente || pendente.id !== saveId) return false
        const atualizado = atualizarGravacaoIncerta({
          ...pendente,
          rpcState,
          rpcError,
          message,
        })
        if (atualizado) setConnectionStatus('unknown')
        return atualizado
      }
      const confirmarRespostaRpc = async (
        resultado: { kind: 'response'; data: unknown; error: unknown; status: number } | { kind: 'exception'; error: unknown },
      ): Promise<boolean> => {
        if (operacaoSequencia.current.get(quadraId) !== operationToken) return false
        if (resultado.kind === 'exception') {
          marcarGravacaoIncerta('transport-uncertain')
          setSavingStatus(false)
          await reconciliarGravacaoIncerta(true)
          return false
        }
        if (
          resultado.error
          || !Number.isInteger(resultado.status)
          || resultado.status < 200
          || resultado.status >= 300
        ) {
          marcarGravacaoIncerta('transport-uncertain', true)
          setSavingStatus(false)
          await reconciliarGravacaoIncerta(true)
          return false
        }
        let respostaConfirmada: RespostaRpc
        try {
          respostaConfirmada = respostaDaRpc(resultado.data, quadraId)
        } catch {
          marcarGravacaoIncerta('transport-uncertain')
          setSavingStatus(false)
          await reconciliarGravacaoIncerta(true)
          return false
        }
        if (respostaConfirmada.status === 'conflict' || respostaConfirmada.status === 'rejected') {
          const gravacaoAtual = pendingSaveRef.current
          if (!gravacaoAtual || gravacaoAtual.id !== saveId) return false
          if (respostaConfirmada.status === 'conflict' && respostaConfirmada.situacao && respostaConfirmada.versao !== undefined) {
            const situacaoAtual: Situacao = respostaConfirmada.situacao
            const versaoAtual: number = respostaConfirmada.versao
            setQuadras((items) => items.map((quadra) => quadra.id === quadraId
              ? { ...quadra, situacao: situacaoAtual, versao: versaoAtual, updatedAt: respostaConfirmada.updatedAt ?? quadra.updatedAt }
              : quadra))
          }
          // Conflict/rejected é resultado terminal conhecido: a operação antiga
          // não deve continuar bloqueando uma nova tentativa lógica.
          resolverGravacaoTerminal(saveId)
          definirFeedback(quadraId, respostaConfirmada.status === 'conflict'
            ? `A quadra ${quadraCodigo} foi alterada por outra operação. Os dados foram atualizados; escolha novamente.`
            : `A alteração da quadra ${quadraCodigo} foi rejeitada pelo servidor.`, 'error')
          setSavingStatus(false)
          return false
        }
        if (!respostaConfirmada.situacao || respostaConfirmada.situacao !== situacao) {
          marcarGravacaoIncerta('transport-uncertain')
          setSavingStatus(false)
          await reconciliarGravacaoIncerta(true)
          return false
        }
        if (!marcarGravacaoIncerta('confirmed') || (persistenciaLocalAtiva && !atualizarGravacaoIncerta(null))) return true
        const situacaoAtual: Situacao = respostaConfirmada.situacao
        const versaoAtual = respostaConfirmada.versao
        setQuadras((items) => items.map((quadra) => quadra.id === quadraId
          ? { ...quadra, situacao: situacaoAtual, versao: versaoAtual ?? quadra.versao + 1, updatedAt: respostaConfirmada.updatedAt ?? new Date().toISOString() }
          : quadra))
        definirFeedback(quadraId, `Situação da quadra ${quadraCodigo} salva.`, 'success')
        void carregarQuadras(true)
        return true
      }

      const rpcAttempt = client.rpc('atualizar_situacao_quadra_v2', {
        p_operacao_id: saveId,
        p_quadra_id: quadraId,
        p_situacao: situacao,
        p_observacao: null,
        p_versao_esperada: atual.versao,
      }).then(async ({ data, error, status }) => {
        if (error && (error.code === '42883' || error.code === 'PGRST202')) {
          const legado = await client.rpc('atualizar_situacao_quadra', {
            p_quadra_id: quadraId,
            p_situacao: situacao,
            p_observacao: null,
          })
          return { kind: 'response' as const, data: legado.data, error: legado.error, status: legado.status }
        }
        return { kind: 'response' as const, data, error, status }
      }).then(
        ({ data, error, status }) => ({ kind: 'response' as const, data, error, status }),
        (error: unknown) => ({ kind: 'exception' as const, error }),
      )
      let timeoutId = 0
      const resultado = await Promise.race([
        rpcAttempt,
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timeoutId = window.setTimeout(() => resolve({ kind: 'timeout' }), TIMEOUT_RPC_STATUS_MS)
        }),
      ])
      window.clearTimeout(timeoutId)
      if (resultado.kind === 'timeout') {
        atualizarMensagemGravacaoLocal(saveId, `A gravação da quadra ${quadraCodigo} excedeu o tempo de espera. O resultado permanece incerto; consulte a operação antes de iniciar uma nova alteração.`)
        setSavingStatus(false)
        void reconciliarGravacaoIncerta(true)
        void rpcAttempt.then((respostaAtrasada) => {
          if (operacaoSequencia.current.get(quadraId) === operationToken) void confirmarRespostaRpc(respostaAtrasada)
        })
        return
      }
      const terminal = await confirmarRespostaRpc(resultado)
      if (!terminal) return
    }

    if (!navigator.locks?.request) {
      setCoordinationAvailable(false)
      definirFeedback(quadraId, 'Este navegador não oferece Web Locks; a alteração será tentada com coordenação apenas nesta aba.', 'error')
      try {
        await executarSobLock()
      } finally {
        statusLocks.current.delete(quadraId)
        setSavingStatus(false)
        setWaitingForCoordination(false)
      }
      return
    }

    try {
      await navigator.locks.request(`${LOCK_GRAVACAO_QUADRAS}:${quadraId}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        setWaitingForCoordination(false)
        if (!lock) {
          const persisted = lerGravacaoPersistida()
          setStorageStatus(persisted.status)
          if (persisted.status !== 'ready') {
            if (pendingSaveRef.current) {
              atualizarMensagemGravacaoLocal(
                pendingSaveRef.current.id,
                `O armazenamento da operação da quadra ${pendingSaveRef.current.quadraCodigo} não pode ser verificado. Nenhuma nova gravação foi iniciada.`,
              )
            }
            setSavingStatus(false)
            return
          }
          if (persisted.status === 'ready' && !persisted.record && pendingSaveRef.current) {
            setStorageStatus('corrupt')
            atualizarMensagemGravacaoLocal(
              pendingSaveRef.current.id,
              `O registro da operação da quadra ${pendingSaveRef.current.quadraCodigo} não foi encontrado no armazenamento. Nenhuma nova gravação foi iniciada.`,
            )
            setSavingStatus(false)
            return
          }
          persistedRecordRef.current = persisted.record
          pendingSaveRef.current = persisted.gravacao
          setPendingSave(persisted.gravacao)
          if (!persisted.gravacao && persisted.status === 'ready') {
            definirFeedback(quadraId, 'Outra aba está coordenando uma operação. Nenhuma nova gravação foi iniciada; tente novamente após a reconciliação.', 'error')
          }
          setSavingStatus(false)
          return
        }
        await executarSobLock()
      })
    } catch {
      setCoordinationAvailable(false)
      setStorageStatus('coordination-unavailable')
      setSavingStatus(false)
      setWaitingForCoordination(false)
    } finally {
      statusLocks.current.delete(quadraId)
      setSavingStatus(false)
      setWaitingForCoordination(false)
    }
  }

  const mensagemConexao = !client
    ? 'A configuração do servidor está incompleta. As quadras e alterações não podem ser verificadas ou salvas.'
    : !coordinationAvailable || storageStatus === 'coordination-unavailable'
      ? 'A coordenação entre abas não está disponível. As alterações continuam permitidas, mas a proteção fica limitada a esta aba.'
    : storageStatus === 'unavailable'
      ? 'O armazenamento local não está disponível. As alterações continuam permitidas, mas uma falha de transporte não poderá ser registrada neste navegador.'
      : storageStatus === 'corrupt'
        ? 'Há um registro local de operação incerta inválido ou antigo. Ele foi preservado para diagnóstico; novas alterações continuam permitidas, com confirmação dependente da resposta do servidor.'
    : pendingSave
      ? `A alteração da quadra ${pendingSave.quadraCodigo} ainda não foi confirmada. Consulte o estado no servidor antes de repetir a alteração dessa quadra.`
    : !quadrasCarregadas && connectionStatus === 'loading'
      ? 'Carregando quadras…'
      : !quadrasCarregadas
        ? 'Não foi possível carregar as quadras. Tente novamente.'
        : connectionStatus === 'unavailable'
          ? 'Sem conexão com o servidor. Exibindo os últimos dados disponíveis.'
          : connectionStatus === 'unknown'
              ? 'Não foi possível confirmar a atualização. Os últimos dados carregados permanecem visíveis.'
            : !dadosRecentes
              ? 'Os dados estão desatualizados. Atualize para confirmar a conexão antes de alterar situações.'
              : loadError
                ? 'Não foi possível atualizar as quadras. Os últimos dados carregados permanecem visíveis.'
                : ''
  // Uma gravação local antiga não deve produzir o alerta global persistente.
  // A reconciliação continua ativa e o detalhe é mostrado apenas ao selecionar a quadra pendente.
  const mostrarAviso = Boolean(mensagemConexao) && !pendingSave
  const podeTentarNovamente = Boolean(client && connectionStatus !== 'loading' && !pendingSave)

  return (
    <main className={`app-shell${atual ? ' app-shell--selection-open' : ''}`}>
      <header className="app-header">
        <h1>Alfredo Chaves</h1>
        <button onClick={() => { window.history.pushState({}, '', appPath('/admin')); window.dispatchEvent(new PopStateEvent('popstate')) }}>Área admin</button>
      </header>
      {mostrarAviso && <section className={`connection-notice${connectionStatus === 'unavailable' ? ' connection-notice--offline' : ''}`} role={connectionStatus === 'unavailable' ? 'alert' : 'status'} aria-live={connectionStatus === 'unavailable' ? 'assertive' : 'polite'}>
        {!noticeDismissed && <p>{mensagemConexao}{loadError && connectionStatus === 'unknown' ? ` ${loadError}` : ''}</p>}
        {podeTentarNovamente && <button type="button" className="retry-load" onClick={() => { setNoticeDismissed(false); void carregarQuadras(true) }} disabled={refreshing} aria-label="Tentar carregar as quadras novamente">{refreshing ? 'Atualizando…' : 'Tentar novamente'}</button>}
        {quadrasCarregadas && <button type="button" className="dismiss-notice" onClick={() => setNoticeDismissed(true)} aria-label="Fechar aviso de conexão">×</button>}
      </section>}
      <section className="map-card public-map-card">
        <MapContainer center={centro} zoom={14} zoomControl={false} touchZoom dragging attributionControl={false} className="map public-map">
          <MapReference mapRef={mapRef} />
          <AttributionControl position="bottomleft" />
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <PersistedLayers quadras={quadras} onSelect={select} layers={layers} />
        </MapContainer>
        <button type="button" className="restore-map-view" onClick={restaurarVisaoMapa} aria-label="Restaurar visão do mapa" title="Restaurar visão do mapa">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3v4m0 10v4M3 12h4m10 0h4M8 8l-3.5-3.5M16 8l3.5-3.5M8 16l-3.5 3.5M16 16l3.5 3.5" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </button>
      </section>
      <section className="status-panel public-status-panel" aria-label="Indicadores das quadras">
        <div><strong>{counts.total}</strong><span>Total</span></div>
        <div><strong className="gray">{counts.pendente}</strong><span className="status-indicator-label"><span className="status-indicator-icon" aria-hidden="true">◷</span>Pendentes</span></div>
        <div><strong className="green">{counts.concluida}</strong><span className="status-indicator-label"><span className="status-indicator-icon" aria-hidden="true">✓</span>Concluídas</span></div>
        <div><strong className="orange">{counts.refazer}</strong><span className="status-indicator-label"><span className="status-indicator-icon" aria-hidden="true">⚠</span>Refazer</span></div>
      </section>
      {atual && <aside className="sheet" aria-labelledby="selected-quadra-title">
        <div className="sheet-heading">
          <div>
            <h2 id="selected-quadra-title">Quadra {atual.codigo}</h2>
            <p>Situação atual: <strong>{NOMES[atual.situacao]}</strong></p>
          </div>
          <button type="button" className="close" onClick={() => { selectedRef.current = null; setSelected(null); setStatusFeedback(''); setStatusFeedbackQuadraId(null) }} aria-label="Fechar painel">×</button>
        </div>
        <div className="status-actions" aria-label="Alterar situação da quadra">
          {(['pendente', 'concluida', 'refazer'] as Situacao[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`status-button status-button--${status}`}
              aria-pressed={atual.situacao === status}
              onClick={() => void alterar(status)}
              disabled={!podeAlterar}
            >
              {NOMES[status].toLocaleUpperCase('pt-BR')}
            </button>
          ))}
        </div>
        {pendingSave?.quadraId === atual.id ? <>
          <p className="status-feedback status-feedback--warning" role="status">
            {pendingSave.message}
          </p>
          <button type="button" className="reconcile-save-button" onClick={() => void consultarGravacaoIncerta()} disabled={reconcilingPendingSave} aria-label={`Consultar novamente o estado não confirmado da quadra ${pendingSave.quadraCodigo}`}>
            {reconcilingPendingSave ? 'Consultando situação…' : 'Consultar situação novamente'}
          </button>
        </> : !podeAlterar && !savingStatus && <p className="status-feedback status-feedback--warning" role="status">
          {!client
            ? 'O servidor não está configurado; as situações não podem ser salvas.'
            : connectionStatus === 'loading' || refreshing
              ? 'Aguardando a confirmação dos dados do servidor…'
              : 'Não é possível alterar situações até que os dados atuais sejam confirmados pelo servidor.'}
        </p>}
        {savingStatus && <p className="status-feedback status-feedback--busy" role="status"><span className="status-spinner" aria-hidden="true" />{waitingForCoordination ? 'Aguardando coordenação segura entre abas…' : 'Salvando situação…'}</p>}
        {!pendingSave && !savingStatus && statusFeedback && statusFeedbackQuadraId === atual.id && <p className={`status-feedback status-feedback--${statusFeedbackKind}`} role={statusFeedbackKind === 'error' ? 'alert' : 'status'}>{statusFeedback}</p>}
      </aside>}
    </main>
  )
}

function App() { const [path, setPath] = useState(routePath()); useEffect(() => { const handler = () => setPath(routePath()); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler) }, []); return path.startsWith('/admin') ? <AdminPage onBack={() => { window.history.pushState({}, '', appPath('/')); window.dispatchEvent(new PopStateEvent('popstate')) }} /> : <MapPage /> }
export default App
