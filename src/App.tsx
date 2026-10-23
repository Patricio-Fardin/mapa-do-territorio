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

function AdminPage({ onBack }: { onBack: () => void }) {
  const client = supabase
  const adminUsername = import.meta.env.VITE_ADMIN_USERNAME?.trim() || 'admin'
  const adminLoginEmail = import.meta.env.VITE_ADMIN_LOGIN_EMAIL?.trim() || ''
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [loadingMessage, setLoadingMessage] = useState<string | null>('Verificando sessão…')
  const [autorizado, setAutorizado] = useState(false)
  const submitting = useRef(false)
  const configurationIncomplete = !client || !adminLoginEmail

  useEffect(() => {
    let active = true
    const verificarSessao = async () => {
      if (!client || !adminLoginEmail) {
        setMessage('A configuração administrativa está incompleta. Verifique as variáveis do Supabase e do login admin.')
        setLoadingMessage(null)
        return
      }

      try {
        const { data, error } = await client.auth.getSession()
        if (error) {
          const resultado = await encerrarSessao(client, 'Não foi possível verificar a sessão.')
          if (active) setMessage(resultado.mensagem)
          return
        }
        if (!data.session?.user) {
          return
        }

        const resultado = await validarPerfilAdmin(client, data.session.user.id)
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
      const resultado = await validarPerfilAdmin(client, data.user.id)
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
        <form onSubmit={(event) => void entrar(event)}>
          <p>Entre com o nome de usuário e a senha da conta administrativa existente.</p>
          <label>
            Nome de usuário
            <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" disabled={Boolean(loadingMessage) || configurationIncomplete} />
          </label>
          <label>
            Senha
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" disabled={Boolean(loadingMessage) || configurationIncomplete} />
          </label>
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} disabled={Boolean(loadingMessage) || configurationIncomplete}>
            {showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          </button>
          <button className="primary-action" type="submit" disabled={Boolean(loadingMessage) || configurationIncomplete}>Entrar</button>
        </form>
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
