import { jwtVerify, createRemoteJWKSet } from 'jose';

export interface AuthEnv {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
}

type AuthResult = { success: true; payload: any } | { success: false; response: Response };

function errorResponse(error: string, details: string, status: number, corsHeaders: Record<string, string>): Response {
	return new Response(JSON.stringify({ error, details }), {
		status,
		headers: { 'Content-Type': 'application/json', ...corsHeaders },
	});
}

async function validateAccessToken(token: string, env: AuthEnv) {
	const teamDomain = env.TEAM_DOMAIN.replace(/\/+$/, '');
	const JWKS = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
	const { payload } = await jwtVerify(token, JWKS, {
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
		console.error('Missing CF Access JWT token');
		return {
			success: false,
			response: errorResponse('Authentication required', 'Missing authentication token', 401, corsHeaders),
		};
	}

	try {
		const payload = await validateAccessToken(token, env);
		console.log(`Authenticated user: ${payload.email || 'unknown'}`);
		return { success: true, payload };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error('Token validation failed:', message);
		console.error('TEAM_DOMAIN:', env.TEAM_DOMAIN);
		console.error('POLICY_AUD:', env.POLICY_AUD);
		return {
			success: false,
			response: errorResponse('Authentication failed', `Invalid token: ${message}`, 401, corsHeaders),
		};
	}
}
