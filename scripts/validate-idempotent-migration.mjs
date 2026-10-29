import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const path = new URL('../supabase/migrations/20261029120000_idempotent_quadra_updates.sql', import.meta.url)
const sql = await readFile(path, 'utf8')

assert.match(sql, /padrao\s+is\s+null\s+or\s+padrao\s+not\s+in/i)
assert.match(sql, /create\s+or\s+replace\s+function\s+public\.atualizar_situacao_quadra_v2\(/i)
assert.match(sql, /p_versao_esperada\s+integer\s*\)/i)
assert.match(sql, /if\s+p_versao_esperada\s+is\s+null\s+then/i)
assert.match(sql, /return\s+public\.aplicar_situacao_quadra_idempotente\(/i)
assert.match(sql, /public\.atualizar_situacao_quadra\([\s\S]*public\.aplicar_situacao_quadra_idempotente/i)

console.log('Static idempotent migration checks passed.')
