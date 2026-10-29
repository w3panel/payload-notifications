#!/usr/bin/env node
// Fails when package.json points at files the build did not produce.
import { existsSync, readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const targets = []
const walk = (value, key) => {
  if (typeof value === 'string') targets.push([key, value])
  else if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) walk(child, key ? `${key} ${name}` : name)
  }
}
walk(pkg.exports, 'exports')
for (const field of ['main', 'module', 'types']) if (pkg[field]) targets.push([field, pkg[field]])
for (const [from, to] of Object.entries(pkg.browser ?? {})) targets.push([`browser ${from}`, to])

const missing = targets.filter(([, path]) => !existsSync(path))
for (const [key, path] of missing) console.error(`✗ ${key} → ${path} does not exist`)
if (missing.length) process.exit(1)
console.log(`✓ ${targets.length} package entry points exist`)
