const CORS_HEADERS = {
	'Access-Control-Allow-Origin': 'https://chatbot-demo.homesecurity.rocks',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  // Used for messages
  interface ChatbotRequestBody {
	prompt?: string;
  }

  export default {
	async fetch(request: Request, env: any): Promise<Response> {
	  // Handle CORS preflight request
	  if (request.method === 'OPTIONS') {
		return new Response(null, {
		  status: 204,
		  headers: CORS_HEADERS,
		});
	  }
  
	  // Handle chatbot POST request
	  if (request.method === 'POST') {
		try {
		  const requestBody: ChatbotRequestBody = await request.json();
		  const prompt = requestBody.prompt || 'Tell me who you are and how I can interact with you';
  
		  const response = await env.AI.run(
			'@cf/meta/llama-3.2-1b-instruct',
			{ prompt },
			{
			  gateway: {
				id: 'demo-ai-gateway',
				// Use your actual gateway label here
			  },
			}
		  );
  
		  return new Response(JSON.stringify(response), {
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
  
	  // Disallow other HTTP methods
	  return new Response('Method Not Allowed', {
		status: 405,
		headers: CORS_HEADERS,
	  });
	},
  };
  