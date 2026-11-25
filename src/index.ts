import { authenticateRequest, type AuthEnv, type Authenticator } from './auth';

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

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
	'https://chatbot-demo.homesecurity.rocks',
	'http://localhost:3000',
	'http://localhost:3001',
];

function getCorsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get('Origin') || '';
	const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, CF-Access-JWT-Assertion',
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Expose-Headers': 'cf-aig-model, cf-aig-provider',
		Vary: 'Origin',
	};
}

interface Env extends AuthEnv {
	AI: Ai;
	CF_ACCESS_CLIENT_ID: string;
	CF_ACCESS_CLIENT_SECRET: string;
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
const MAX_PROMPT_CHARS = 32000;
const MAX_OUTPUT_TOKENS = 2048;
const MAX_UPSTREAM_ERROR_CHARS = 300;
const MAX_UPSTREAM_ERRORS = 5;

interface AttachmentValidation {
	valid: boolean;
	error?: string;
	/** Extracted text for document attachments, so the conversion runs once. */
	documentText?: string;
}

function decodeAttachmentData(attachment: Attachment): Uint8Array {
	const base64Data = attachment.data.replace(/^data:[^;]+;base64,/, '');
	const binaryString = atob(base64Data);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}

async function convertDocumentToText(
	attachment: Attachment,
	bytes: Uint8Array,
	env: Env
): Promise<{ text: string; tokens: number }> {
	try {
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

async function validateAttachment(attachment: Attachment | undefined, env: Env): Promise<AttachmentValidation> {
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

	let bytes: Uint8Array;
	try {
		bytes = decodeAttachmentData(attachment);
	} catch {
		return { valid: false, error: 'Invalid file data' };
	}

	const sizeInMB = bytes.length / (1024 * 1024);
	if (sizeInMB > MAX_FILE_SIZE_MB) {
		return { valid: false, error: `File size exceeds ${MAX_FILE_SIZE_MB}MB limit` };
	}

	if (DOCUMENT_MIME_TYPES.includes(attachment.mimeType)) {
		try {
			const { text } = await convertDocumentToText(attachment, bytes, env);
			if (text.length > MAX_DOCUMENT_CHARS) {
				return { valid: false, error: `Document content exceeds ${MAX_DOCUMENT_CHARS} character limit` };
			}
			return { valid: true, documentText: text };
		} catch {
			return { valid: false, error: 'Document conversion failed' };
		}
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

function transformMessagesWithAttachment(
	prompt: string,
	attachment: Attachment | undefined,
	documentText: string | undefined
): Message[] {
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

	if (attachmentType === 'document' && documentText !== undefined) {
		const contentWithDocument = `${prompt}\n\n[Attached Document: ${attachment.filename}]\n${documentText}`;
		return [systemMessage, { role: 'user', content: contentWithDocument }];
	}

	return [systemMessage, { role: 'user', content: prompt }];
}

function jsonResponse(body: object, corsHeaders: Record<string, string>, status = 200, extra: HeadersInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders, ...extra },
	});
}

/**
 * Bound and shape whatever the gateway returned so internal detail from an
 * upstream failure is not reflected verbatim to the caller.
 */
function sanitizeUpstreamError(error: unknown): Array<{ code: number; message: string }> | string {
	if (!Array.isArray(error)) {
		return 'Gateway error';
	}

	const sanitized = error.slice(0, MAX_UPSTREAM_ERRORS).map((entry) => {
		const record = entry as { code?: unknown; message?: unknown };
		return {
			code: typeof record?.code === 'number' ? record.code : 0,
			message: String(record?.message ?? '').slice(0, MAX_UPSTREAM_ERROR_CHARS),
		};
	});

	return sanitized.length > 0 ? sanitized : 'Gateway error';
}

type UpstreamFetch = (input: string, init: RequestInit) => Promise<Response>;

export function createApp(authenticate: Authenticator = authenticateRequest, upstreamFetch: UpstreamFetch = fetch) {
	return {
		async fetch(request: Request, env: Env): Promise<Response> {
			const corsHeaders = getCorsHeaders(request);

			if (request.method === 'OPTIONS') {
				return new Response(null, { status: 204, headers: corsHeaders });
			}

			if (request.method !== 'POST') {
				return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
			}

			// Authentication is always enforced. There is no test-mode bypass:
			// tests inject a stub authenticator through createApp() instead.
			const authResult = await authenticate(request, env, corsHeaders);
			if (!authResult.success) {
				return authResult.response;
			}
			const userEmail = authResult.identity.email;

			let prompt: string;
			let attachment: Attachment | undefined;
			let streamRequested = false;
			try {
				const body = await request.json<{ prompt?: unknown; attachments?: unknown; stream?: unknown }>();
				if (body.prompt !== undefined && typeof body.prompt !== 'string') {
					return jsonResponse({ error: 'Invalid prompt' }, corsHeaders, 400);
				}
				prompt = (body.prompt as string | undefined) || 'Tell me who you are and how I can interact with you';
				attachment = Array.isArray(body.attachments) ? (body.attachments[0] as Attachment | undefined) : undefined;
				streamRequested = body.stream === true;
			} catch {
				return jsonResponse({ error: 'Invalid JSON body' }, corsHeaders, 400);
			}

			if (prompt.length > MAX_PROMPT_CHARS) {
				return jsonResponse(
					{ error: `Prompt exceeds ${MAX_PROMPT_CHARS} character limit` },
					corsHeaders,
					400
				);
			}

			const validation = await validateAttachment(attachment, env);
			if (!validation.valid) {
				return jsonResponse({ error: validation.error }, corsHeaders, 400);
			}

			const attachmentType = detectAttachmentType(attachment);
			const messages = transformMessagesWithAttachment(prompt, attachment, validation.documentText);

			const res = await upstreamFetch(
				'https://ai-gateway.paolo.me.cloudflare.dev/compat/chat/completions',
				{
					method: 'POST',
					headers: {
						'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
						'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
						'Content-Type': 'application/json',
						'cf-aig-metadata': JSON.stringify({
							user_id: userEmail,
							user: userEmail,
							Username: userEmail,
							AttachmentType: attachmentType,
						}),
					},
					body: JSON.stringify({
						model: env.DYNAMIC_ROUTE_NAME,
						messages,
						max_tokens: MAX_OUTPUT_TOKENS,
						stream: streamRequested,
					}),
				}
			);

			const aigHeaders = {
				'cf-aig-model': res.headers.get('cf-aig-model') || '',
				'cf-aig-provider': res.headers.get('cf-aig-provider') || '',
			};

			// Handle errors (return JSON regardless of stream request)
			if (!res.ok) {
				try {
					const errorData = await res.json<{ error?: unknown }>();
					return jsonResponse({ error: sanitizeUpstreamError(errorData.error) }, corsHeaders, res.status, aigHeaders);
				} catch {
					return jsonResponse({ error: 'Gateway error' }, corsHeaders, res.status, aigHeaders);
				}
			}

			// Streaming response: pipe through the SSE stream
			if (streamRequested && res.body) {
				return new Response(res.body, {
					status: 200,
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-store',
						Connection: 'keep-alive',
						...corsHeaders,
						...aigHeaders,
					},
				});
			}

			// Non-streaming response: parse JSON and return
			const data = await res.json<{ choices?: Array<{ message?: { content?: string } }> }>();
			return jsonResponse({ response: data.choices?.[0]?.message?.content || '' }, corsHeaders, 200, aigHeaders);
		},
	};
}

export default createApp();
