import { authenticateRequest, AuthEnv } from './auth';

interface Attachment {
	filename: string;
	mimeType: string;
	data: string;
}

interface Message {
	role: string;
	content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

type AttachmentType = 'image' | 'document' | 'none';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': 'https://chatbot-demo.homesecurity.rocks',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, CF-Access-JWT-Assertion',
	'Access-Control-Allow-Credentials': 'true',
	'Access-Control-Expose-Headers': 'cf-aig-model, cf-aig-provider',
};

interface Env extends AuthEnv {
	AI: Ai;
	AIG_TOKEN: string;
	ACCOUNT_ID: string;
	GATEWAY_ID: string;
	DYNAMIC_ROUTE_NAME: string;
}

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const DOCUMENT_MIME_TYPES = [
	'application/pdf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.oasis.opendocument.text',
	'application/vnd.oasis.opendocument.spreadsheet',
	'text/html',
	'application/xml',
	'text/csv',
	'text/plain',
	'text/markdown',
];
const MAX_FILE_SIZE_MB = 10;
const MAX_DOCUMENT_CHARS = 100000;

async function convertDocumentToText(attachment: Attachment, env: Env): Promise<{ text: string; tokens: number }> {
	try {
		const base64Data = attachment.data.replace(/^data:[^;]+;base64,/, '');
		const binaryString = atob(base64Data);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}

		const blob = new Blob([bytes], { type: attachment.mimeType });
		const result = await env.AI.toMarkdown({ name: attachment.filename, blob });

		if ('error' in result || !result.data) {
			throw new Error('Document conversion failed');
		}

		return { text: result.data, tokens: result.tokens };
	} catch {
		throw new Error('Document conversion failed');
	}
}

async function validateAttachment(attachment: Attachment | undefined, env: Env): Promise<{ valid: boolean; error?: string }> {
	if (!attachment) {
		return { valid: true };
	}

	if (!attachment.filename || !attachment.mimeType || !attachment.data) {
		return { valid: false, error: 'Attachment must include filename, mimeType, and data' };
	}

	const allowedMimeTypes = [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES];
	if (!allowedMimeTypes.includes(attachment.mimeType)) {
		return { valid: false, error: `Unsupported file type` };
	}

	try {
		const base64Data = attachment.data.replace(/^data:[^;]+;base64,/, '');
		const sizeInBytes = (base64Data.length * 3) / 4;
		const sizeInMB = sizeInBytes / (1024 * 1024);

		if (sizeInMB > MAX_FILE_SIZE_MB) {
			return { valid: false, error: `File size exceeds ${MAX_FILE_SIZE_MB}MB limit` };
		}

		if (DOCUMENT_MIME_TYPES.includes(attachment.mimeType)) {
			const { text } = await convertDocumentToText(attachment, env);
			if (text.length > MAX_DOCUMENT_CHARS) {
				return { valid: false, error: `Document content exceeds ${MAX_DOCUMENT_CHARS} character limit` };
			}
		}
	} catch (error) {
		if (error instanceof Error && error.message === 'Document conversion failed') {
			return { valid: false, error: 'Document conversion failed' };
		}
		return { valid: false, error: 'Invalid file data' };
	}

	return { valid: true };
}

function detectAttachmentType(attachment?: Attachment): AttachmentType {
	if (!attachment) {
		return 'none';
	}

	if (IMAGE_MIME_TYPES.includes(attachment.mimeType)) {
		return 'image';
	}

	if (DOCUMENT_MIME_TYPES.includes(attachment.mimeType)) {
		return 'document';
	}

	return 'none';
}


async function transformMessagesWithAttachment(prompt: string, attachment: Attachment | undefined, env: Env): Promise<Message[]> {
	const systemMessage: Message = { role: 'system', content: 'You are a helpful assistant.' };

	if (!attachment) {
		return [systemMessage, { role: 'user', content: prompt }];
	}

	const attachmentType = detectAttachmentType(attachment);

	if (attachmentType === 'image') {
		const imageUrl = attachment.data.startsWith('data:') ? attachment.data : `data:${attachment.mimeType};base64,${attachment.data}`;

		return [
			systemMessage,
			{
				role: 'user',
				content: [
					{ type: 'text', text: prompt },
					{ type: 'image_url', image_url: { url: imageUrl } },
				],
			},
		];
	}

	if (attachmentType === 'document') {
		const { text } = await convertDocumentToText(attachment, env);
		const contentWithDocument = `${prompt}\n\n[Attached Document: ${attachment.filename}]\n${text}`;
		return [systemMessage, { role: 'user', content: contentWithDocument }];
	}

	return [systemMessage, { role: 'user', content: prompt }];
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

		if (env.POLICY_AUD !== 'test-policy-aud') {
			const authResult = await authenticateRequest(request, env, CORS_HEADERS);
			if (!authResult.success) {
				return authResult.response;
			}
		}

		let prompt: string;
		let username: string;
		let attachment: Attachment | undefined;
		try {
			const body = await request.json<{ prompt?: string; username?: string; attachments?: Attachment[] }>();
			prompt = body.prompt || 'Tell me who you are and how I can interact with you';
			username = body.username || 'Unknown';
			attachment = body.attachments?.[0];
		} catch {
			return jsonResponse({ error: 'Invalid JSON body' }, 400);
		}

		const validation = await validateAttachment(attachment, env);
		if (!validation.valid) {
			return jsonResponse({ error: validation.error }, 400);
		}

		const attachmentType = detectAttachmentType(attachment);
		const messages = await transformMessagesWithAttachment(prompt, attachment, env);

		const res = await fetch(
			`https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/compat/chat/completions`,
			{
				method: 'POST',
				headers: {
					'cf-aig-authorization': `Bearer ${env.AIG_TOKEN}`,
					'Content-Type': 'application/json',
					'cf-aig-metadata': JSON.stringify({ Username: username, AttachmentType: attachmentType }),
				},
				body: JSON.stringify({
					model: env.DYNAMIC_ROUTE_NAME,
					messages,
				}),
			}
		);

		if (!res.ok) {
			try {
				const errorData = await res.json<{ error?: Array<{ code: number; message: string }> }>();
				return jsonResponse({ error: errorData.error || 'Unknown error' }, res.status);
			} catch {
				return jsonResponse({ error: 'Gateway error' }, res.status);
			}
		}

		const data = await res.json<{ choices?: Array<{ message?: { content?: string } }> }>();
		return jsonResponse({ response: data.choices?.[0]?.message?.content || '' }, 200, {
			'cf-aig-model': res.headers.get('cf-aig-model') || '',
			'cf-aig-provider': res.headers.get('cf-aig-provider') || '',
		});
	},
};
  