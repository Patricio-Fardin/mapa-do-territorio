import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import L, { type Layer } from 'leaflet'
import AdminMap from './components/AdminMap'
import { supabase } from './lib/supabase'
import {
  FormatoSituacaoQuadraInvalido,
  normalizarSituacaoQuadra,
  type SituacaoQuadra,
} from './lib/quadra-status'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import './App.css'

type Situacao = SituacaoQuadra
type Quadra = { id: string; codigo: string; situacao: Situacao; geometria?: GeoJSON.Geometry }
const CORES: Record<Situacao, string> = { pendente: '#78858a', concluida: '#27ae60', refazer: '#e67e22' }
const NOMES: Record<Situacao, string> = { pendente: 'Pendente', concluida: 'Concluída', refazer: 'Refazer' }
const centro: [number, number] = [-20.6353, -40.7498]

function aplicarEstilo(layer: Layer, situacao: Situacao) { (layer as L.Path).setStyle({ color: CORES[situacao], fillColor: CORES[situacao], fillOpacity: .42, opacity: .95, weight: 2 }) }

async function lerQuadrasPublicas(client: NonNullable<typeof supabase>): Promise<Quadra[]> {
  const pageSize = 1000
  const quadras: Quadra[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from('quadras')
      .select('id,codigo,geometria,ativa,situacoes_quadras(situacao)')
      .eq('ativa', true)
      .order('id')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error('Não foi possível atualizar as quadras.')
    quadras.push(...(data ?? []).map((row) => ({
      id: row.id,
      codigo: row.codigo,
      geometria: row.geometria,
      situacao: normalizarSituacaoQuadra(row.situacoes_quadras),
    })))
    if ((data?.length ?? 0) < pageSize) return quadras
  }
}

function mensagemErroLeituraPublica(error: unknown): string {
  return error instanceof FormatoSituacaoQuadraInvalido
    ? 'O banco retornou um formato de situação inválido. Nenhuma situação foi presumida.'
    : 'Não foi possível atualizar as quadras. Verifique a conexão e tente novamente.'
}

function situacaoDaRespostaRpc(data: unknown): Situacao {
  if (data === null || typeof data !== 'object' || !('situacao' in data)) {
    throw new FormatoSituacaoQuadraInvalido()
  }
  return normalizarSituacaoQuadra(data.situacao)
}

function PersistedLayers({ quadras, onSelect, layers }: { quadras: Quadra[]; onSelect: (id: string) => void; layers: React.MutableRefObject<Map<string, L.Layer[]>> }) {
  const map = useMap()
  useEffect(() => {
    const group = L.featureGroup().addTo(map)
    const currentLayers = layers.current
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
    return () => {
      map.removeLayer(group)
      quadras.forEach((quadra) => currentLayers.delete(quadra.id))
    }
  }, [map, quadras, onSelect, layers])
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
  const [quadras, setQuadras] = useState<Quadra[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState(() => client ? '' : 'Supabase não configurado: usando dados locais temporários.')
  const [savingStatus, setSavingStatus] = useState(false)
  const statusLock = useRef(false)
  const loadVersion = useRef(0)
  const layers = useRef(new Map<string, L.Layer[]>())
  const localMode = !client

  const carregarQuadras = useCallback(async () => {
    if (!client) return
    const version = ++loadVersion.current
    try {
      const result = await lerQuadrasPublicas(client)
      if (version !== loadVersion.current) return
      setQuadras(result)
      setMessage('')
    } catch (error: unknown) {
      if (version === loadVersion.current) {
        setMessage(mensagemErroLeituraPublica(error))
      }
    }
  }, [client])

  useEffect(() => {
    if (!client) return
    let active = true
    const version = ++loadVersion.current
    void lerQuadrasPublicas(client)
      .then((result) => {
        if (active && version === loadVersion.current) {
          setQuadras(result)
          setMessage('')
        }
      })
      .catch((error: unknown) => {
        if (active && version === loadVersion.current) {
          setMessage(mensagemErroLeituraPublica(error))
        }
      })
    const channel = client
      .channel('mapa-publico')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'situacoes_quadras' }, () => { void carregarQuadras() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quadras' }, () => { void carregarQuadras() })
      .subscribe()
    const refreshTimer = window.setInterval(() => { void carregarQuadras() }, 30_000)
    return () => {
      active = false
      loadVersion.current += 1
      window.clearInterval(refreshTimer)
      void client.removeChannel(channel)
    }
  }, [client, carregarQuadras])

  const select = useCallback((id: string) => setSelected(id), [])
  const atual = quadras.find((quadra) => quadra.id === selected)
  const counts = useMemo(() => ({
    total: quadras.length,
    pendente: quadras.filter((quadra) => quadra.situacao === 'pendente').length,
    concluida: quadras.filter((quadra) => quadra.situacao === 'concluida').length,
    refazer: quadras.filter((quadra) => quadra.situacao === 'refazer').length,
  }), [quadras])
  const percent = counts.total ? Math.round(counts.concluida / counts.total * 100) : 0

  const alterar = async (situacao: Situacao) => {
    if (!atual || statusLock.current) return
    statusLock.current = true
    setSavingStatus(true)
    setMessage('')
    try {
      if (client) {
        const { data, error } = await client.rpc('atualizar_situacao_quadra', {
          p_quadra_id: atual.id,
          p_situacao: situacao,
          p_observacao: null,
        })
        if (error) {
          const safeCode = /^[0-9A-Z]{5}$/.test(error.code ?? '') ? ` Código: ${error.code}.` : ''
          await carregarQuadras()
          setMessage(`O Supabase recusou a atualização da situação.${safeCode}`)
          return
        }
        const situacaoConfirmada = situacaoDaRespostaRpc(data)
        if (situacaoConfirmada !== situacao) {
          await carregarQuadras()
          setMessage('A resposta do Supabase não confirmou a situação solicitada. A situação foi recarregada.')
          return
        }
        setQuadras((items) => items.map((quadra) => quadra.id === atual.id
          ? { ...quadra, situacao: situacaoConfirmada }
          : quadra))
        setSelected(null)
        void carregarQuadras()
        return
      }
      setQuadras((items) => items.map((quadra) => quadra.id === atual.id ? { ...quadra, situacao } : quadra))
      layers.current.get(atual.id)?.forEach((layer) => aplicarEstilo(layer, situacao))
      setSelected(null)
    } catch (error: unknown) {
      if (error instanceof FormatoSituacaoQuadraInvalido) {
        await carregarQuadras()
        setMessage('O Supabase não confirmou uma situação válida. A situação atual foi recarregada.')
      } else {
        await carregarQuadras()
        setMessage('Não foi possível confirmar a alteração da situação. Verifique os dados atualizados.')
      }
    } finally {
      statusLock.current = false
      setSavingStatus(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Mapa de Territórios</p><h1>Alfredo Chaves</h1></div>
        <button onClick={() => { window.history.pushState({}, '', appPath('/admin')); window.dispatchEvent(new PopStateEvent('popstate')) }}>Área admin</button>
      </header>
      {(message || localMode) && <p className="notice" role="status">{message || 'Dados locais temporários.'}</p>}
      <section className="map-card">
        <MapContainer center={centro} zoom={14} zoomControl={false} className="map">
          <ZoomControl position="bottomright" />
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <PersistedLayers quadras={quadras} onSelect={select} layers={layers} />
        </MapContainer>
      </section>
      <section className="status-panel">
        <div><strong>{counts.total}</strong><span>Total</span></div>
        <div><strong className="gray">{counts.pendente}</strong><span>Pendentes</span></div>
        <div><strong className="green">{counts.concluida}</strong><span>Concluídas</span></div>
        <div><strong className="orange">{counts.refazer}</strong><span>Refazer</span></div>
        <div><strong>{percent}%</strong><span>Conclusão</span></div>
      </section>
      {atual && <aside className="sheet">
        <button className="close" onClick={() => setSelected(null)} disabled={savingStatus}>×</button>
        <strong>{atual.codigo}</strong>
        {(['concluida', 'pendente', 'refazer'] as Situacao[]).map((status) => (
          <button key={status} className={`popup-${status}`} onClick={() => void alterar(status)} disabled={savingStatus}>
            {savingStatus ? 'Salvando…' : NOMES[status]}
          </button>
        ))}
      </aside>}
      <p className="notice">Visitantes podem colaborar sem cadastro. A área administrativa exige conta autorizada. Não armazene dados pessoais.</p>
    </main>
  )
}

function App() { const [path, setPath] = useState(routePath()); useEffect(() => { const handler = () => setPath(routePath()); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler) }, []); return path.startsWith('/admin') ? <AdminPage onBack={() => { window.history.pushState({}, '', appPath('/')); window.dispatchEvent(new PopStateEvent('popstate')) }} /> : <MapPage /> }
export default App
