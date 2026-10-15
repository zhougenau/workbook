const { copyFileSync, mkdirSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

const source = resolve(__dirname, '../dist/index.cjs')
const target = resolve(__dirname, '../../../apps/mini/vendor/wordbook-core.js')
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`Copied CommonJS build to ${target}`)