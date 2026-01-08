import { jwtVerify, createRemoteJWKSet } from 'jose'

export interface AuthEnv {
  POLICY_AUD: string
  TEAM_DOMAIN: string
}

export function getCorsHeaders(
  request: Request,
  allowedMethods: string = 'GET, POST, OPTIONS'
): Record<string, string> {
  const origin = request.headers.get('Origin') || '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': allowedMethods,
    'Access-Control-Allow-Headers': 'Content-Type, CF-Access-JWT-Assertion',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export async function validateAccessToken(token: string, env: AuthEnv) {
  const JWKS = createRemoteJWKSet(
    new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)
  )

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: env.TEAM_DOMAIN,
    audience: env.POLICY_AUD,
  })

  return payload
}

export async function authenticateRequest(
  request: Request,
  env: AuthEnv,
  corsHeaders: Record<string, string>
): Promise<{ success: true; payload: any } | { success: false; response: Response }> {
  if (!env.POLICY_AUD || !env.TEAM_DOMAIN) {
    console.error('Missing required environment variables: POLICY_AUD or TEAM_DOMAIN')
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Server configuration error. Please contact support.',
          details: 'Missing authentication configuration',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      ),
    }
  }

  const token = request.headers.get('cf-access-jwt-assertion')

  if (!token) {
    console.error('Missing CF Access JWT token')
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Authentication required. Please ensure you are accessing through Cloudflare Access.',
          details: 'Missing authentication token',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      ),
    }
  }

  try {
    const payload = await validateAccessToken(token, env)
    console.log(`Authenticated user: ${payload.email || 'unknown'}`)
    return { success: true, payload }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Token validation failed:', message)
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Authentication failed. Please ensure you are accessing through Cloudflare Access.',
          details: `Invalid token: ${message}`,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      ),
    }
  }
}

export function handleCorsPreFlight(corsHeaders: Record<string, string>): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  })
}
