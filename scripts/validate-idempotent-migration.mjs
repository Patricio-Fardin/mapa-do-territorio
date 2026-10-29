import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const path = new URL('../supabase/migrations/20261029120000_idempotent_quadra_updates.sql', import.meta.url)
const sql = await readFile(path, 'utf8')

// Este é um teste estático de contrato/estrutura. Ele não interpreta PL/pgSQL
// nem substitui a execução da migration em um PostgreSQL real.
function parametrosDaFuncao(nome) {
  const inicio = sql.indexOf(`create or replace function public.${nome}(`)
  assert.notEqual(inicio, -1, `Função ausente: ${nome}`)
  const inicioParametros = inicio + `create or replace function public.${nome}(`.length
  const fim = sql.indexOf(')', inicioParametros)
  assert.notEqual(fim, -1, `Declaração incompleta: ${nome}`)
  return sql.slice(inicioParametros, fim).split(',').map((parametro) => parametro.trim()).filter(Boolean)
}

function exigeParametrosObrigatoriosAntesDeDefaults(nome) {
  let encontrouDefault = false
  for (const parametro of parametrosDaFuncao(nome)) {
    if (/\bdefault\b/i.test(parametro)) encontrouDefault = true
    else assert.equal(encontrouDefault, false, `${nome}: parâmetro obrigatório depois de DEFAULT: ${parametro}`)
  }
}

assert.match(sql, /padrao\s+is\s+null\s+or\s+padrao\s+not\s+in/i)
assert.match(sql, /create\s+or\s+replace\s+function\s+public\.atualizar_situacao_quadra_v2\(/i)
assert.match(sql, /p_versao_esperada\s+integer\s*\)/i)
assert.match(sql, /if\s+p_versao_esperada\s+is\s+null\s+then/i)
assert.match(sql, /return\s+public\.aplicar_situacao_quadra_idempotente\(/i)
assert.match(sql, /public\.atualizar_situacao_quadra\([\s\S]*public\.aplicar_situacao_quadra_idempotente/i)
exigeParametrosObrigatoriosAntesDeDefaults('aplicar_situacao_quadra_idempotente')
exigeParametrosObrigatoriosAntesDeDefaults('atualizar_situacao_quadra_v2')

console.log('Static idempotent migration checks passed; PostgreSQL execution is not covered.')
