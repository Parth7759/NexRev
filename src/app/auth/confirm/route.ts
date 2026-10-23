import { type NextRequest } from 'next/server'
import { GET as handleCallback } from '../callback/route'

export async function GET(request: NextRequest) {
  return handleCallback(request)
}
