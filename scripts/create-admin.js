#!/usr/bin/env node
// Usage: node scripts/create-admin.js <username> <password>
const { scryptSync, randomBytes } = require('crypto')
const { Pool } = require('pg')
require('dotenv').config()

const [,, username, password] = process.argv
if (!username || !password) {
  console.error('Usage: node scripts/create-admin.js <username> <password>')
  process.exit(1)
}

const salt = randomBytes(16).toString('hex')
const hash = scryptSync(password, salt, 64).toString('hex')
const password_hash = `${salt}:${hash}`

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false })
pool.query(
  'INSERT INTO admin_accounts (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash',
  [username, password_hash]
).then(() => {
  console.log(`Admin account '${username}' created/updated.`)
  pool.end()
}).catch(e => {
  console.error('Error:', e.message)
  pool.end()
  process.exit(1)
})
