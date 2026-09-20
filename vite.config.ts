import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function getCommitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  }

  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'local'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_UPDATED_AT__: JSON.stringify(new Date().toISOString()),
    __APP_COMMIT__: JSON.stringify(getCommitSha()),
  },
})
