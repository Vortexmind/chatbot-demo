import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

export interface AuthEnv {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
}

export interface AccessIdentity {
	email: string;
	sub?: string;
}

export type AuthResult = { success: true; identity: AccessIdentity } | { success: false; response: Response };

/**
 * Authenticator signature. Injected into the Worker factory so tests can
 * substitute a stub instead of the real Cloudflare Access verification.
 */
export type Authenticator = (
	request: Request,
	env: AuthEnv,
	corsHeaders: Record<string, string>
) => Promise<AuthResult>;

const jwksCache = new Map<string, JWTVerifyGetKey>();

function getJwks(teamDomain: string): JWTVerifyGetKey {
	let jwks = jwksCache.get(teamDomain);
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
		jwksCache.set(teamDomain, jwks);
	}
	return jwks;
}

function errorResponse(error: string, details: string, status: number, corsHeaders: Record<string, string>): Response {
	return new Response(JSON.stringify({ error, details }), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
	});
}

async function validateAccessToken(token: string, env: AuthEnv) {
	const teamDomain = env.TEAM_DOMAIN.replace(/\/+$/, '');
	const { payload } = await jwtVerify(token, getJwks(teamDomain), {
		issuer: teamDomain,
		audience: env.POLICY_AUD,
	});
	return payload;
}

export async function authenticateRequest(
	request: Request,
	env: AuthEnv,
	corsHeaders: Record<string, string>
): Promise<AuthResult> {
	if (!env.POLICY_AUD || !env.TEAM_DOMAIN) {
		console.error('Missing required environment variables: POLICY_AUD or TEAM_DOMAIN');
		return {
			success: false,
			response: errorResponse('Server configuration error', 'Missing authentication configuration', 500, corsHeaders),
		};
	}

	const token = request.headers.get('cf-access-jwt-assertion');
	if (!token) {
		return {
			success: false,
			response: errorResponse('Authentication required', 'Missing authentication token', 401, corsHeaders),
		};
	}

	try {
		const payload = await validateAccessToken(token, env);
		return {
			success: true,
			identity: {
				email: typeof payload.email === 'string' ? payload.email : 'unknown@example.com',
				sub: typeof payload.sub === 'string' ? payload.sub : undefined,
			},
		};
	} catch (error) {
		// Keep verification details server-side only; they describe the Access
		// configuration (issuer, audience, key rotation) and help an attacker.
		console.error('Token validation failed:', error instanceof Error ? error.message : 'Unknown error');
		return {
			success: false,
			response: errorResponse('Authentication failed', 'Invalid or expired authentication token', 401, corsHeaders),
		};
	}
}
