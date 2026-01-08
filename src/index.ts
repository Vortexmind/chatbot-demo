import { authenticateRequest, AuthEnv } from './auth';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': 'https://chatbot-demo.homesecurity.rocks',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, CF-Access-JWT-Assertion',
	'Access-Control-Expose-Headers': 'cf-aig-model, cf-aig-provider',
};

interface Env extends AuthEnv {
	AIG_TOKEN: string;
	ACCOUNT_ID: string;
	GATEWAY_ID: string;
}

function jsonResponse(body: object, status = 200, extra: HeadersInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		if (request.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
		}

		const authResult = await authenticateRequest(request, env, CORS_HEADERS);
		if (!authResult.success) {
			return authResult.response;
		}

		let prompt: string;
		let username: string;
		try {
			const body = await request.json<{ prompt?: string, username?: string }>();
			prompt = body.prompt || 'Tell me who you are and how I can interact with you';
			username = body.username || 'Unknown';
		} catch {
			return jsonResponse({ error: 'Invalid JSON body' }, 400);
		}

		const res = await fetch(
			`https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/compat/chat/completions`,
			{
				method: 'POST',
				headers: {
					'cf-aig-authorization': `Bearer ${env.AIG_TOKEN}`,
					'Content-Type': 'application/json',
					'cf-aig-metadata': JSON.stringify({ Username: username }),
				},
				body: JSON.stringify({
					model: 'dynamic/chatbot-demo',
					messages: [
						{ role: 'system', content: 'You are a helpful assistant.' },
						{ role: 'user', content: prompt },
					],
				}),
			}
		);

		if (!res.ok) {
			return jsonResponse({ error: await res.text() }, res.status);
		}

		const data = await res.json<{ choices?: Array<{ message?: { content?: string } }> }>();
		return jsonResponse(
			{ response: data.choices?.[0]?.message?.content || '' },
			200,
			{
				'cf-aig-model': res.headers.get('cf-aig-model') || '',
				'cf-aig-provider': res.headers.get('cf-aig-provider') || '',
			}
		);
	},
};
  