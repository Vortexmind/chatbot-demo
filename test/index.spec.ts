// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, { createApp } from '../src/index';
import type { Authenticator } from '../src/auth';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// The Worker has no test-mode auth bypass. Tests inject a stub authenticator
// and a stub upstream so the suite never reaches the live AI Gateway.
const authenticateStub: Authenticator = async () => ({
	success: true,
	identity: { email: 'test@example.com', sub: 'test-subject' },
});

type UpstreamCall = { url: string; init: RequestInit };

let upstreamCalls: UpstreamCall[] = [];

const upstreamStub = async (url: string, init: RequestInit) => {
	upstreamCalls.push({ url, init });
	return new Response(
		JSON.stringify({ choices: [{ message: { content: 'stub reply' } }] }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
};

const app = createApp(authenticateStub, upstreamStub);

async function send(
	body: unknown,
	options: { env?: typeof env; headers?: Record<string, string> } = {}
) {
	upstreamCalls = [];
	const request = new IncomingRequest('http://example.com', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...options.headers },
		body: JSON.stringify(body),
	});
	const ctx = createExecutionContext();
	const response = await app.fetch(request, options.env ?? env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe('Authentication', () => {
	it('rejects requests without an Access token', async () => {
		// `env.POLICY_AUD` is bound to the old magic test value on purpose:
		// the Worker must still refuse the request.
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: 'Hello' }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(401);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('does not leak verification details to the caller', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'not-a-jwt' },
			body: JSON.stringify({ prompt: 'Hello' }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const data = (await response.json()) as { details?: string };
		expect(response.status).toBe(401);
		expect(data.details).toBe('Invalid or expired authentication token');
		expect(JSON.stringify(data)).not.toContain('cloudflareaccess.com');
	});
});

describe('Chatbot API with Attachments', () => {
	it('handles OPTIONS request (CORS preflight)', async () => {
		const request = new IncomingRequest('http://example.com', { method: 'OPTIONS' });
		const ctx = createExecutionContext();
		const response = await app.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
		expect(response.headers.get('Vary')).toBe('Origin');
	});

	it('rejects non-POST requests', async () => {
		const request = new IncomingRequest('http://example.com', { method: 'GET' });
		const ctx = createExecutionContext();
		const response = await app.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(405);
		expect(await response.text()).toBe('Method Not Allowed');
	});

	it('rejects invalid JSON body', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'invalid json',
		});
		const ctx = createExecutionContext();
		const response = await app.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error', 'Invalid JSON body');
	});

	it('rejects a non-string prompt', async () => {
		const response = await send({ prompt: { nested: true } });
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error', 'Invalid prompt');
	});

	it('rejects an oversized prompt before calling the gateway', async () => {
		const response = await send({ prompt: 'a'.repeat(32001) });
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error', 'Prompt exceeds 32000 character limit');
		expect(upstreamCalls).toHaveLength(0);
	});

	it('rejects attachment with invalid MIME type', async () => {
		const response = await send({
			prompt: 'Test prompt',
			attachments: [
				{
					filename: 'test.exe',
					mimeType: 'application/x-msdownload',
					data: 'dGVzdA==',
				},
			],
		});
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error');
		expect(data.error).toContain('Unsupported file type');
	});

	it('rejects attachment with invalid base64 data', async () => {
		const response = await send({
			prompt: 'Test prompt',
			attachments: [
				{
					filename: 'test.png',
					mimeType: 'image/png',
					data: 'not-valid-base64!!!',
				},
			],
		});
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error');
		expect(data.error).toBe('Invalid file data');
	});

	it('rejects attachment missing required fields', async () => {
		const response = await send({
			prompt: 'Test prompt',
			attachments: [
				{
					filename: 'test.png',
					mimeType: 'image/png',
				},
			],
		});
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error', 'Attachment must include filename, mimeType, and data');
	});

	it('accepts a valid image attachment and bounds the output tokens', async () => {
		const smallImageBase64 =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
		const response = await send({
			prompt: 'What is in this image?',
			attachments: [
				{
					filename: 'test.png',
					mimeType: 'image/png',
					data: smallImageBase64,
				},
			],
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data).toHaveProperty('response', 'stub reply');
		expect(upstreamCalls).toHaveLength(1);

		const sent = JSON.parse(String(upstreamCalls[0].init.body)) as {
			max_tokens?: number;
			messages: Array<{ role: string; content: unknown }>;
		};
		expect(sent.max_tokens).toBe(2048);
		expect(Array.isArray(sent.messages[1].content)).toBe(true);
	});

	it('converts a document exactly once', async () => {
		let conversions = 0;
		const countingAI = {
			toMarkdown: async () => {
				conversions += 1;
				return { data: 'converted document text', tokens: 4 };
			},
		} as unknown as Ai;

		const response = await send(
			{
				prompt: 'Summarize this document',
				attachments: [
					{
						filename: 'test.txt',
						mimeType: 'text/plain',
						data: btoa('This is a test document content.'),
					},
				],
			},
			{ env: { ...env, AI: countingAI } as typeof env }
		);
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data).toHaveProperty('response', 'stub reply');
		expect(conversions).toBe(1);

		const sent = JSON.parse(String(upstreamCalls[0].init.body)) as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(sent.messages[1].content).toContain('converted document text');
	});

	it('validates request without attachment', async () => {
		const response = await send({ prompt: 'Hello, how are you?' });
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data).toHaveProperty('response', 'stub reply');
		expect(upstreamCalls).toHaveLength(1);
	});

	it('does not reflect raw upstream error detail', async () => {
		const errorApp = createApp(authenticateStub, async () =>
			new Response(JSON.stringify({ error: [{ code: 500, message: 'x'.repeat(2000) }] }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' },
			})
		);

		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ prompt: 'Hello' }),
		});
		const ctx = createExecutionContext();
		const response = await errorApp.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const data = (await response.json()) as { error: Array<{ message: string }> };
		expect(response.status).toBe(502);
		expect(data.error[0].message).toHaveLength(300);
	});
});
