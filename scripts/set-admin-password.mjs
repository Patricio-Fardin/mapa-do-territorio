import { createClient } from '@supabase/supabase-js'

const userId = process.argv[2]
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Execute este comando em um terminal interativo.'))
      return
    }

    process.stdout.write(prompt)
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    let value = ''

    const finish = (error) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          finish(new Error('Operação cancelada.'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          return
        }
        if (character === '\u007f' || character === '\b') {
          value = [...value].slice(0, -1).join('')
          continue
        }
        value += character
      }
    }

    process.stdin.on('data', onData)
  })
}

async function main() {
  if (!uuidPattern.test(userId ?? '')) {
    throw new Error('Informe como argumento o UUID do usuário Auth existente.')
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY somente no ambiente local seguro.')
  }

  const password = await readHidden('Nova senha: ')
  const confirmation = await readHidden('Confirme a nova senha: ')
  if (!password) throw new Error('A senha não pode ficar vazia.')
  if (password !== confirmation) throw new Error('As senhas não conferem.')

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.admin.updateUserById(userId, { password })
  if (error) throw new Error('A atualização falhou. Confira o UUID e a configuração administrativa.')
  console.log('Senha atualizada para o usuário Auth indicado.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Não foi possível atualizar a senha.')
  process.exitCode = 1
})
