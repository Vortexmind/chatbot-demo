const CORS_HEADERS = {
	'Access-Control-Allow-Origin': 'https://chatbot-demo.homesecurity.rocks',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

interface Env {
	AIG_TOKEN: string;
	ACCOUNT_ID: string;
	GATEWAY_ID: string;
}

interface AIGatewayResponse {
	choices: Array<{ message: { content: string } }>;
}

function jsonResponse(body: object, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
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

		let prompt: string;
		try {
			const body = await request.json<{ prompt?: string }>();
			prompt = body.prompt || 'Tell me who you are and how I can interact with you';
		} catch {
			return jsonResponse({ error: 'Invalid JSON body' }, 400);
		}

		const gatewayResponse = await fetch(
			`https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/compat/chat/completions`,
			{
				method: 'POST',
				headers: {
					'cf-aig-authorization': `Bearer ${env.AIG_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: 'dynamic/chatbot-demo',
					messages: [{ role: 'user', content: prompt }],
				}),
			}
		);

		if (!gatewayResponse.ok) {
			return jsonResponse({ error: await gatewayResponse.text() }, gatewayResponse.status);
		}

		const data: AIGatewayResponse = await gatewayResponse.json();
		return jsonResponse({ response: data.choices?.[0]?.message?.content || '' });
	},
};
  