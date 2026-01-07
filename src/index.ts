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

interface ChatbotRequestBody {
	prompt?: string;
}

interface AIGatewayResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: CORS_HEADERS,
			});
		}

		if (request.method === 'POST') {
			try {
				const requestBody: ChatbotRequestBody = await request.json();
				const prompt = requestBody.prompt || 'Tell me who you are and how I can interact with you';

				const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/compat/chat/completions`;

				const gatewayResponse = await fetch(gatewayUrl, {
					method: 'POST',
					headers: {
						'cf-aig-authorization': `Bearer ${env.AIG_TOKEN}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: 'dynamic/chatbot-demo',
						messages: [
							{
								role: 'user',
								content: prompt,
							},
						],
					}),
				});

				if (!gatewayResponse.ok) {
					const errorText = await gatewayResponse.text();
					return new Response(JSON.stringify({ error: errorText }), {
						status: gatewayResponse.status,
						headers: {
							'Content-Type': 'application/json',
							...CORS_HEADERS,
						},
					});
				}

				const data: AIGatewayResponse = await gatewayResponse.json();
				const responseText = data.choices?.[0]?.message?.content || '';

				return new Response(JSON.stringify({ response: responseText }), {
					status: 200,
					headers: {
						'Content-Type': 'application/json',
						...CORS_HEADERS,
					},
				});
			} catch (error) {
				return new Response('Invalid JSON body', {
					status: 400,
					headers: CORS_HEADERS,
				});
			}
		}

		return new Response('Method Not Allowed', {
			status: 405,
			headers: CORS_HEADERS,
		});
	},
};
  