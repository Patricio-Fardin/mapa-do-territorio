import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import L, { type Layer } from 'leaflet'
import { supabase, supabaseConfigured } from './lib/supabase'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import './App.css'

type Situacao = 'pendente' | 'concluida' | 'refazer'
type Quadra = { id: string; codigo: string; situacao: Situacao; geometria?: GeoJSON.Geometry }
const CORES: Record<Situacao, string> = { pendente: '#78858a', concluida: '#27ae60', refazer: '#e67e22' }
const NOMES: Record<Situacao, string> = { pendente: 'Pendente', concluida: 'Concluída', refazer: 'Refazer' }
const centro: [number, number] = [-20.6353, -40.7498]

function aplicarEstilo(layer: Layer, situacao: Situacao) { (layer as L.Path).setStyle({ color: CORES[situacao], fillColor: CORES[situacao], fillOpacity: .42, opacity: .95, weight: 2 }) }

function DrawingTools({ admin, onCreated, onDeleted }: { admin: boolean; onCreated: (layer: L.Layer) => void; onDeleted: (layer: L.Layer) => void }) {
  const map = useMap(); const groupRef = useRef<L.FeatureGroup | null>(null); const callbacks = useRef({ onCreated, onDeleted }); callbacks.current = { onCreated, onDeleted }
  useEffect(() => { const group = new L.FeatureGroup().addTo(map); groupRef.current = group; const created = (e: L.LeafletEvent) => { const x = e as L.DrawEvents.Created; group.addLayer(x.layer); callbacks.current.onCreated(x.layer) }; const deleted = (e: L.LeafletEvent) => (e as L.DrawEvents.Deleted).layers.eachLayer((x) => callbacks.current.onDeleted(x)); map.on(L.Draw.Event.CREATED, created); map.on(L.Draw.Event.DELETED, deleted); return () => { map.off(L.Draw.Event.CREATED, created); map.off(L.Draw.Event.DELETED, deleted); map.removeLayer(group) } }, [map])
  useEffect(() => { const group = groupRef.current; if (!group) return; const options: L.Control.DrawConstructorOptions = {}; if (admin) { options.edit = { featureGroup: group, edit: {}, remove: true }; options.draw = { polygon: { allowIntersection: false }, rectangle: false, circle: false, circlemarker: false, marker: false, polyline: false } }; const control = new L.Control.Draw(options); if (admin) map.addControl(control); return () => { if (admin) map.removeControl(control) } }, [map, admin]); return null
}

function PersistedLayers({ quadras, onSelect, layers }: { quadras: Quadra[]; onSelect: (id: string) => void; layers: React.MutableRefObject<Map<string, L.Layer>> }) {
  const map = useMap(); useEffect(() => { const group = new L.FeatureGroup().addTo(map); quadras.forEach((quadra) => { if (!quadra.geometria) return; const layer = L.geoJSON(quadra.geometria as GeoJSON.GeoJsonObject); layer.eachLayer((item) => { aplicarEstilo(item, quadra.situacao); item.on('click', () => onSelect(quadra.id)); layers.current.set(quadra.id, item); group.addLayer(item) }) }); return () => { map.removeLayer(group); quadras.forEach((q) => layers.current.delete(q.id)) } }, [map, quadras, onSelect, layers]); return null
}

type ResultadoAutorizacao = { autorizado: true } | { autorizado: false; mensagem: string }

async function encerrarSessao(client: NonNullable<typeof supabase>, mensagem: string): Promise<ResultadoAutorizacao> {
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

function mensagemDeErroMagicLink(): string | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null

  const params = new URLSearchParams(hash)
  const errorCode = params.get('error_code')
  const error = params.get('error')
  const description = params.get('error_description')

  if (errorCode === 'otp_expired' || error === 'otp_expired') {
    return 'O link de acesso expirou ou já foi usado. Solicite um novo link e tente novamente.'
  }

  if (errorCode === 'access_denied' || error === 'access_denied') {
    return 'O link de acesso não pôde ser concluído. Solicite um novo link com uma conta administrativa autorizada.'
  }

  if (errorCode || error || description) {
    return 'O link de acesso não pôde ser concluído. Solicite um novo link e tente novamente.'
  }

  return null
}

function mensagemErroEnvioLink(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Não foi possível contatar o serviço de autenticação. Verifique sua conexão e tente novamente.'
  }

  const details = error as { code?: unknown; status?: unknown; message?: unknown }
  const code = typeof details.code === 'string' ? details.code.toLowerCase() : ''
  const message = typeof details.message === 'string' ? details.message.toLowerCase() : ''
  const status = typeof details.status === 'number' ? details.status : 0

  if (status === 429 || code.includes('rate_limit') || code.includes('too_many_requests')) {
    return 'O limite de envio foi atingido. Aguarde alguns minutos antes de solicitar outro link.'
  }

  if (code.includes('redirect') || message.includes('redirect') && (message.includes('allow') || message.includes('url'))) {
    return 'O endereço de retorno não está permitido no Supabase Auth. Confira a URL de produção em Additional Redirect URLs.'
  }

  if (code.includes('email_address_invalid') || code.includes('email_invalid')) {
    return 'O formato do e-mail não foi aceito. Confira o endereço e tente novamente.'
  }

  if (code.includes('email_provider_disabled') || code.includes('otp_disabled')) {
    return 'O login por e-mail está desativado no Supabase Auth. Confira a configuração do provedor de e-mail.'
  }

  if (status >= 500 || message.includes('smtp') || message.includes('mail')) {
    return 'O serviço de e-mail do Supabase não conseguiu enviar a mensagem. Confira a configuração de entrega de e-mails e tente novamente mais tarde.'
  }

  return 'Não foi possível enviar o link. Confira sua conexão e tente novamente. Se persistir, verifique os logs de Auth, a entrega de e-mails e as URLs permitidas no Supabase.'
}

function AdminPage({ onBack }: { onBack: () => void }) {
  const client = supabase
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loadingMessage, setLoadingMessage] = useState<string | null>('Verificando sessão…')
  const [autorizado, setAutorizado] = useState(false)
  const [linkEnviado, setLinkEnviado] = useState(false)

  useEffect(() => {
    let active = true
    const verificarSessao = async () => {
      if (!client) {
        setMessage('O acesso administrativo não está configurado. Verifique a configuração do Supabase.')
        setLoadingMessage(null)
        return
      }

      const erroLink = mensagemDeErroMagicLink()
      if (erroLink && active) {
        setMessage(erroLink)
        setLinkEnviado(false)
      }

      setLoadingMessage('Verificando sessão…')
      try {
        const { data, error } = await client.auth.getSession()
        if (error) {
          if (active) setMessage(erroLink ?? 'Não foi possível verificar a sessão. Tente novamente.')
          return
        }
        if (!data.session?.user) {
          if (active && erroLink) {
            setLinkEnviado(false)
          }
          return
        }

        const resultado = await validarPerfilAdmin(client, data.session.user.id)
        if (active) {
          setAutorizado(resultado.autorizado)
          setMessage(resultado.autorizado ? 'Sessão administrativa validada.' : resultado.mensagem)
        }
      } catch {
        if (active) setMessage(erroLink ?? 'Não foi possível verificar a sessão. Tente novamente.')
      } finally {
        if (active) setLoadingMessage(null)
      }
    }

    void verificarSessao()
    return () => {
      active = false
    }
  }, [client])

  const enviarLinkMagico = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!client || loadingMessage) return
    setLoadingMessage('Enviando link de acesso…')
    setMessage('')
    try {
      const emailRedirectTo = new URL('admin', `${window.location.origin}${import.meta.env.BASE_URL}`).toString()
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo },
      })
      if (error) {
        setMessage(mensagemErroEnvioLink(error))
        return
      }
      setLinkEnviado(true)
      setMessage('Link enviado. Abra-o no e-mail para concluir o acesso; você retornará a esta página.')
    } catch (error) {
      setMessage(mensagemErroEnvioLink(error))
    } finally {
      setLoadingMessage(null)
    }
  }

  const sair = async () => {
    if (!client || loadingMessage) return
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
      setLoadingMessage(null)
    }
  }

  return (
    <main className="admin-page">
      <button onClick={onBack}>← Voltar ao mapa</button>
      <h1>Área administrativa</h1>
      {loadingMessage && <p role="status">{loadingMessage}</p>}
      {!loadingMessage && autorizado ? (
        <section>
          <p>A autenticação foi confirmada. As operações de criação, edição e arquivamento de quadras ainda não estão conectadas ao banco.</p>
          <button className="primary-action" onClick={() => void sair()} disabled={Boolean(loadingMessage) || !client}>Encerrar sessão</button>
        </section>
      ) : !loadingMessage && (
        linkEnviado ? (
          <section>
            <p>Se o e-mail corresponder a uma conta existente, você receberá um link mágico. Abra-o para retornar a esta página e concluir a verificação administrativa.</p>
            <button type="button" onClick={() => { setLinkEnviado(false); setMessage('') }}>Usar outro e-mail</button>
          </section>
        ) : (
          <form onSubmit={(event) => void enviarLinkMagico(event)}>
            <p>Informe o e-mail da conta administrativa existente. Um link mágico será enviado para autenticação.</p>
            <label>
              E-mail administrativo
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" disabled={Boolean(loadingMessage) || !client} />
            </label>
            <button className="primary-action" type="submit" disabled={Boolean(loadingMessage) || !client}>Enviar link mágico</button>
          </form>
        )
      )}
      {message && <p role="alert">{message}</p>}
    </main>
  )
}

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '')
const appPath = (path: string) => `${BASE_PATH}${path}` || '/'
const routePath = () => { const pathname = window.location.pathname; return BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || '/' : pathname }

function MapPage() {
  const admin = false; const [quadras, setQuadras] = useState<Quadra[]>([]); const [selected, setSelected] = useState<string | null>(null); const [message, setMessage] = useState(''); const layers = useRef(new Map<string, L.Layer>()); const localMode = !supabaseConfigured; const client = supabase
  useEffect(() => { if (!client) { setMessage('Supabase não configurado: usando dados locais temporários.'); return }; client.from('quadras').select('id,codigo,geometria,ativa,situacoes_quadras(situacao)').eq('ativa', true).then(({ data, error }) => { if (error) setMessage(error.message); else setQuadras((data ?? []).map((row: any) => ({ id: row.id, codigo: row.codigo, geometria: row.geometria, situacao: row.situacoes_quadras?.[0]?.situacao ?? 'pendente' }))) }); const channel = client.channel('mapa-publico').on('postgres_changes', { event: '*', schema: 'public', table: 'situacoes_quadras' }, () => { void client.from('quadras').select('id,codigo,geometria,ativa,situacoes_quadras(situacao)').eq('ativa', true).then(({ data }) => setQuadras((data ?? []).map((row: any) => ({ id: row.id, codigo: row.codigo, geometria: row.geometria, situacao: row.situacoes_quadras?.[0]?.situacao ?? 'pendente' })))) }).subscribe(); return () => { void client.removeChannel(channel) } }, [client])
  const select = useCallback((id: string) => setSelected(id), []); const atual = quadras.find((q) => q.id === selected)
  const alterar = async (situacao: Situacao) => { if (!atual) return; const layer = layers.current.get(atual.id); if (layer) aplicarEstilo(layer, situacao); if (client) { const { error } = await client.rpc('atualizar_situacao_quadra', { p_quadra_id: atual.id, p_situacao: situacao, p_observacao: null }); if (error) { setMessage(error.message); return } } setQuadras((items) => items.map((q) => q.id === atual.id ? { ...q, situacao } : q)); setSelected(null) }
  const criar = (layer: L.Layer) => { const id = crypto.randomUUID(); const codigo = `AC-${String(quadras.length + 1).padStart(3, '0')}`; aplicarEstilo(layer, 'pendente'); layers.current.set(id, layer); setQuadras((items) => [...items, { id, codigo, situacao: 'pendente' }]) }
  const excluir = (layer: L.Layer) => { const id = [...layers.current.entries()].find(([, value]) => value === layer)?.[0]; if (id) { layers.current.delete(id); setQuadras((items) => items.filter((q) => q.id !== id)) } }
  const counts = useMemo(() => ({ total: quadras.length, pendente: quadras.filter((q) => q.situacao === 'pendente').length, concluida: quadras.filter((q) => q.situacao === 'concluida').length, refazer: quadras.filter((q) => q.situacao === 'refazer').length }), [quadras]); const percent = counts.total ? Math.round(counts.concluida / counts.total * 100) : 0
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow">Mapa de Territórios</p><h1>Alfredo Chaves</h1></div><button onClick={() => { window.history.pushState({}, '', appPath('/admin')); window.dispatchEvent(new PopStateEvent('popstate')) }}>Área admin</button></header>{(message || localMode) && <p className="notice">{message || 'Dados locais temporários.'}</p>}<section className="map-card"><MapContainer center={centro} zoom={14} zoomControl={false} className="map"><ZoomControl position="bottomright" /><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><PersistedLayers quadras={quadras} onSelect={select} layers={layers} /><DrawingTools admin={admin} onCreated={criar} onDeleted={excluir} /></MapContainer></section><section className="status-panel"><div><strong>{counts.total}</strong><span>Total</span></div><div><strong className="gray">{counts.pendente}</strong><span>Pendentes</span></div><div><strong className="green">{counts.concluida}</strong><span>Concluídas</span></div><div><strong className="orange">{counts.refazer}</strong><span>Refazer</span></div><div><strong>{percent}%</strong><span>Conclusão</span></div></section>{atual && <aside className="sheet"><button className="close" onClick={() => setSelected(null)}>×</button><strong>{atual.codigo}</strong>{(['concluida', 'pendente', 'refazer'] as Situacao[]).map((status) => <button key={status} className={`popup-${status}`} onClick={() => void alterar(status)}>{NOMES[status]}</button>)}</aside>}<p className="notice">Visitantes podem colaborar sem cadastro. A área administrativa exige conta autorizada. Não armazene dados pessoais.</p></main>
}

function App() { const [path, setPath] = useState(routePath()); useEffect(() => { const handler = () => setPath(routePath()); window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler) }, []); return path.startsWith('/admin') ? <AdminPage onBack={() => { window.history.pushState({}, '', appPath('/')); window.dispatchEvent(new PopStateEvent('popstate')) }} /> : <MapPage /> }
export default App
