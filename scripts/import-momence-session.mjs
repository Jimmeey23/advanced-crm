import fs from 'node:fs'
import path from 'node:path'

const sourcePath = process.argv[2]
const targetPath = process.argv[3] || path.resolve('.env')
const targetKey = process.argv[4] || 'MOMENCE_ALL_COOKIES'

if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Source Momence .env file was not found.')

const parse = text => Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
  return match ? [[match[1], match[2].trim().replace(/^['"]|['"]$/g, '')]] : []
}))

const cookie = parse(fs.readFileSync(sourcePath, 'utf8')).MOMENCE_ALL_COOKIES
if (!cookie) throw new Error('The refreshed Momence session did not contain MOMENCE_ALL_COOKIES.')

const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : ''
const line = `${targetKey}=${cookie}`
const pattern = new RegExp(`^${targetKey}=.*$`, 'm')
const next = pattern.test(current) ? current.replace(pattern, line) : `${current.replace(/\s*$/, '')}\n${line}\n`
fs.writeFileSync(targetPath, next, { mode: 0o600 })
console.log(`Imported refreshed Momence dashboard session into ${targetKey}.`)
