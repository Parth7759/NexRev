import createJiti from 'jiti'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const jiti = createJiti(import.meta.url, {
  alias: {
    '@': path.resolve(rootDir, 'src'),
    '@/*': path.resolve(rootDir, 'src/*'),
  },
})

await jiti.import('./test-google-notification-registration.ts')
