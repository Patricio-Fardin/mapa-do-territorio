import L from 'leaflet'
import type { Geometry } from 'geojson'
import type { SituacaoQuadra } from './quadra-status'

type Ponto = [number, number]
type Poligono = Ponto[][]
type Celula = { x: number; y: number; h: number; distancia: number; maximo: number }

const RAIZ_DOIS = Math.SQRT2
const STATUS_PUBLICOS: Record<SituacaoQuadra, { texto: string; abreviado: string; simbolo: string }> = {
  pendente: { texto: 'PENDENTE', abreviado: 'PEND.', simbolo: '◷' },
  concluida: { texto: 'CONCLUÍDA', abreviado: 'CONC.', simbolo: '✓' },
  refazer: { texto: 'REFAZER', abreviado: 'REF.', simbolo: '⚠' },
}

function pontoNoAnel(ponto: Ponto, anel: Ponto[]): boolean {
  let dentro = false
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i, i += 1) {
    const [x1, y1] = anel[i]
    const [x2, y2] = anel[j]
    if ((y1 > ponto[1]) !== (y2 > ponto[1])
      && ponto[0] < ((x2 - x1) * (ponto[1] - y1)) / (y2 - y1) + x1) {
      dentro = !dentro
    }
  }
  return dentro
}

function distanciaSegmentoQuadrada(ponto: Ponto, inicio: Ponto, fim: Ponto): number {
  const dx = fim[0] - inicio[0]
  const dy = fim[1] - inicio[1]
  if (dx !== 0 || dy !== 0) {
    const fator = Math.max(0, Math.min(1, ((ponto[0] - inicio[0]) * dx + (ponto[1] - inicio[1]) * dy) / (dx * dx + dy * dy)))
    return (ponto[0] - inicio[0] - dx * fator) ** 2 + (ponto[1] - inicio[1] - dy * fator) ** 2
  }
  return (ponto[0] - inicio[0]) ** 2 + (ponto[1] - inicio[1]) ** 2
}

function distanciaAssinada(ponto: Ponto, poligono: Poligono): number {
  let dentro = pontoNoAnel(ponto, poligono[0])
  let distanciaMinima = Number.POSITIVE_INFINITY
  for (const anel of poligono) {
    if (anel !== poligono[0] && pontoNoAnel(ponto, anel)) dentro = false
    for (let i = 0; i < anel.length; i += 1) {
      distanciaMinima = Math.min(
        distanciaMinima,
        distanciaSegmentoQuadrada(ponto, anel[i], anel[(i + 1) % anel.length]),
      )
    }
  }
  const distancia = Math.sqrt(distanciaMinima)
  return dentro ? distancia : -distancia
}

function inserirCelula(heap: Celula[], celula: Celula): void {
  heap.push(celula)
  let indice = heap.length - 1
  while (indice > 0) {
    const pai = Math.floor((indice - 1) / 2)
    if (heap[pai].maximo >= celula.maximo) break
    heap[indice] = heap[pai]
    indice = pai
  }
  heap[indice] = celula
}

function retirarCelula(heap: Celula[]): Celula | undefined {
  const topo = heap[0]
  const ultima = heap.pop()
  if (!topo || !ultima || heap.length === 0) return topo
  let indice = 0
  while (true) {
    const esquerdo = indice * 2 + 1
    const direito = esquerdo + 1
    if (esquerdo >= heap.length) break
    const maior = direito < heap.length && heap[direito].maximo > heap[esquerdo].maximo ? direito : esquerdo
    if (heap[maior].maximo <= ultima.maximo) break
    heap[indice] = heap[maior]
    indice = maior
  }
  heap[indice] = ultima
  return topo
}

function pontoInterno(poligono: Poligono): Ponto | null {
  const contorno = poligono[0]
  if (!contorno || contorno.length < 4) return null
  const xs = contorno.map(([x]) => x)
  const ys = contorno.map(([, y]) => y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const largura = maxX - minX
  const altura = maxY - minY
  const tamanho = Math.min(largura, altura)
  if (!Number.isFinite(tamanho) || tamanho <= 0) return null

  const melhor: Celula = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    h: 0,
    distancia: Number.NEGATIVE_INFINITY,
    maximo: Number.NEGATIVE_INFINITY,
  }
  melhor.distancia = distanciaAssinada([melhor.x, melhor.y], poligono)
  melhor.maximo = melhor.distancia

  const heap: Celula[] = []
  const meio = tamanho / 2
  const precisao = Math.max(tamanho / 100, 1e-8)
  const criarCelula = (x: number, y: number, h: number): Celula => {
    const distancia = distanciaAssinada([x, y], poligono)
    return { x, y, h, distancia, maximo: distancia + h * RAIZ_DOIS }
  }

  for (let x = minX; x < maxX; x += tamanho) {
    for (let y = minY; y < maxY; y += tamanho) {
      inserirCelula(heap, criarCelula(x + meio, y + meio, meio))
    }
  }

  let visitadas = 0
  while (heap.length > 0 && visitadas < 5_000) {
    const celula = retirarCelula(heap)
    if (!celula) break
    visitadas += 1
    if (celula.distancia > melhor.distancia) {
      melhor.x = celula.x
      melhor.y = celula.y
      melhor.distancia = celula.distancia
    }
    if (celula.maximo - melhor.distancia <= precisao || celula.h <= precisao / 2) continue

    const metade = celula.h / 2
    inserirCelula(heap, criarCelula(celula.x - metade, celula.y - metade, metade))
    inserirCelula(heap, criarCelula(celula.x + metade, celula.y - metade, metade))
    inserirCelula(heap, criarCelula(celula.x - metade, celula.y + metade, metade))
    inserirCelula(heap, criarCelula(celula.x + metade, celula.y + metade, metade))
  }
  return melhor.distancia > 0 ? [melhor.x, melhor.y] : null
}

function areaAproximada(poligono: Poligono): number {
  return poligono[0].reduce((area, ponto, indice, anel) => {
    const proximo = anel[(indice + 1) % anel.length]
    return area + ponto[0] * proximo[1] - proximo[0] * ponto[1]
  }, 0) / 2
}

function extrairPoligonos(geometria: Geometry): Poligono[] {
  if (geometria.type === 'Polygon') {
    return [geometria.coordinates.map((anel) => anel.map(([longitude, latitude]) => [longitude, latitude] as Ponto))]
  }
  if (geometria.type === 'MultiPolygon') {
    return geometria.coordinates.map((poligono) => (
      poligono.map((anel) => anel.map(([longitude, latitude]) => [longitude, latitude] as Ponto))
    ))
  }
  return []
}

function larguraTexto(texto: string, fonte: number): number {
  const contexto = document.createElement('canvas').getContext('2d')
  if (!contexto) return texto.length * fonte * .65
  contexto.font = `900 ${fonte}px ${window.getComputedStyle(document.body).fontFamily}`
  return contexto.measureText(texto).width
}

function formatarDataAtualizacao(valor: string | null | undefined): string | null {
  if (!valor) return null
  const data = new Date(valor)
  if (Number.isNaN(data.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(data)
}

export function criarIdentificacaoQuadra(
  mapa: L.Map,
  geometria: Geometry,
  codigo: string,
  situacao: SituacaoQuadra,
  cor: string,
  mostrarCodigo = true,
  dataAtualizacao?: string | null,
): L.Marker | null {
  const poligonos = extrairPoligonos(geometria)
  const poligono = poligonos.reduce<Poligono | null>((maior, atual) => (
    !maior || Math.abs(areaAproximada(atual)) > Math.abs(areaAproximada(maior)) ? atual : maior
  ), null)
  if (!poligono) return null

  const centro = pontoInterno(poligono)
  if (!centro) return null
  const latlng = L.latLng(centro[1], centro[0])
  const centroTela = mapa.latLngToLayerPoint(latlng)
  let raio = Number.POSITIVE_INFINITY
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const anel of poligono) {
    const tela = anel.map(([longitude, latitude]) => {
      const ponto = mapa.latLngToLayerPoint([latitude, longitude])
      minX = Math.min(minX, ponto.x)
      minY = Math.min(minY, ponto.y)
      maxX = Math.max(maxX, ponto.x)
      maxY = Math.max(maxY, ponto.y)
      return [ponto.x, ponto.y] as Ponto
    })
    for (let i = 0; i < tela.length; i += 1) {
      raio = Math.min(raio, Math.sqrt(distanciaSegmentoQuadrada(
        [centroTela.x, centroTela.y],
        tela[i],
        tela[(i + 1) % tela.length],
      )))
    }
  }

  const dataFormatada = situacao === 'concluida' ? formatarDataAtualizacao(dataAtualizacao) : null
  const temData = mostrarCodigo && dataFormatada !== null
  const largura = Math.max(1, Math.min(mostrarCodigo ? (temData ? 170 : 150) : 120, raio * (mostrarCodigo ? (temData ? 1.65 : 1.35) : 1.6), (maxX - minX) * (mostrarCodigo ? .9 : .8)))
  const altura = Math.max(1, Math.min(mostrarCodigo ? (temData ? 60 : 46) : 30, raio * (mostrarCodigo ? (temData ? 1.65 : 1.35) : 1.2), (maxY - minY) * (mostrarCodigo ? .9 : .8)))
  const compacto = largura < 48 || altura < (temData ? 38 : 26)
  let fonte = Math.max(mostrarCodigo ? 1 : 6, Math.min(11, largura / (mostrarCodigo ? 8 : 7), altura / (temData ? 3.6 : compacto ? 1.5 : 2.8)))
  const statusPublico = STATUS_PUBLICOS[situacao]
  const paddingTexto = 4
  const larguraDisponivel = largura - paddingTexto
  let textoPublico = statusPublico.texto
  let mostrarSimbolo = true
  if (!mostrarCodigo) {
    const larguraCompleta = larguraTexto(textoPublico, fonte)
    const larguraAbreviada = larguraTexto(statusPublico.abreviado, fonte)
    const larguraSimbolo = fonte
    const espacoSimbolo = Math.max(1, fonte * .2)
    if (larguraCompleta + larguraSimbolo + espacoSimbolo > larguraDisponivel) {
      if (larguraCompleta <= larguraDisponivel) {
        mostrarSimbolo = false
      } else {
        textoPublico = statusPublico.abreviado
        mostrarSimbolo = larguraAbreviada + larguraSimbolo + espacoSimbolo <= larguraDisponivel
        if (!mostrarSimbolo && larguraAbreviada > larguraDisponivel) {
          fonte = Math.min(fonte, Math.max(4, larguraDisponivel / (statusPublico.abreviado.length * .65)))
        }
      }
    }
    if (largura < 18 || altura < 10) return null
  }
  const conteudo = document.createElement('span')
  conteudo.className = [
    'quadra-label',
    mostrarCodigo && compacto ? 'quadra-label--compact' : '',
    temData ? 'quadra-label--com-data' : '',
    mostrarCodigo ? '' : 'quadra-label--status-only',
  ].filter(Boolean).join(' ')
  conteudo.style.setProperty('--quadra-label-cor', cor)
  conteudo.style.setProperty('--quadra-label-largura', `${largura}px`)
  conteudo.style.setProperty('--quadra-label-altura', `${altura}px`)
  conteudo.style.setProperty('--quadra-label-fonte', `${fonte}px`)
  const situacaoElement = document.createElement('span')
  situacaoElement.className = 'quadra-label__situacao'
  situacaoElement.textContent = mostrarCodigo ? situacao.toLocaleUpperCase('pt-BR') : textoPublico
  if (!mostrarCodigo && mostrarSimbolo) {
    const simboloElement = document.createElement('span')
    simboloElement.className = 'quadra-label__simbolo'
    simboloElement.textContent = statusPublico.simbolo
    conteudo.append(simboloElement)
  }
  if (mostrarCodigo) {
    const codigoElement = document.createElement('span')
    codigoElement.className = 'quadra-label__codigo'
    codigoElement.textContent = codigo
    conteudo.append(codigoElement)
  }
  conteudo.append(situacaoElement)
  if (temData && dataFormatada) {
    const dataElement = document.createElement('span')
    dataElement.className = 'quadra-label__data'
    dataElement.textContent = dataFormatada
    conteudo.append(dataElement)
  }

  if (!mapa.getPane('quadraLabels')) {
    const pane = mapa.createPane('quadraLabels')
    pane.style.zIndex = '625'
    pane.style.pointerEvents = 'none'
  }

  return L.marker(latlng, {
    pane: 'quadraLabels',
    keyboard: false,
    interactive: false,
    icon: L.divIcon({
      className: 'quadra-label-marker',
      html: conteudo,
      iconSize: L.point(largura, altura),
      iconAnchor: L.point(largura / 2, altura / 2),
    }),
  })
}
