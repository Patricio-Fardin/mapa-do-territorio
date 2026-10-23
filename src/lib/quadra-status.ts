export type SituacaoQuadra = 'pendente' | 'concluida' | 'refazer'

export class FormatoSituacaoQuadraInvalido extends Error {
  constructor() {
    super('Formato de situação de quadra inesperado.')
    this.name = 'FormatoSituacaoQuadraInvalido'
  }
}

function validarSituacao(value: unknown): SituacaoQuadra {
  if (value === 'pendente' || value === 'concluida' || value === 'refazer') return value
  throw new FormatoSituacaoQuadraInvalido()
}

export function normalizarSituacaoQuadra(relation: unknown): SituacaoQuadra {
  if (relation === null || relation === undefined) return 'pendente'

  let row: unknown = relation
  if (Array.isArray(relation)) {
    if (relation.length === 0) return 'pendente'
    if (relation.length !== 1) throw new FormatoSituacaoQuadraInvalido()
    row = relation[0]
  }

  if (row === null) return 'pendente'
  if (typeof row !== 'object' || !('situacao' in row)) throw new FormatoSituacaoQuadraInvalido()
  return validarSituacao(row.situacao)
}
