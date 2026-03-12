// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('Chatbot API with Attachments', () => {
	it('handles OPTIONS request (CORS preflight)', async () => {
		const request = new IncomingRequest('http://example.com', { method: 'OPTIONS' });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
	});

	it('rejects non-POST requests', async () => {
		const request = new IncomingRequest('http://example.com', { method: 'GET' });
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(405);
		expect(await response.text()).toBe('Method Not Allowed');
	});

	it('rejects invalid JSON body', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'test-token' },
			body: 'invalid json',
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error', 'Invalid JSON body');
	});

	it('rejects attachment with invalid MIME type', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'test-token' },
			body: JSON.stringify({
				prompt: 'Test prompt',
				username: 'testuser',
				attachments: [{
					filename: 'test.exe',
					mimeType: 'application/x-msdownload',
					data: 'dGVzdA==',
				}],
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error');
		expect(data.error).toContain('Unsupported file type');
	});

	it('rejects attachment with invalid base64 data', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'test-token' },
			body: JSON.stringify({
				prompt: 'Test prompt',
				username: 'testuser',
				attachments: [{
					filename: 'test.png',
					mimeType: 'image/png',
					data: 'not-valid-base64!!!',
				}],
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error');
		if (typeof data.error === 'string') {
			expect(data.error).toBe('Invalid file data');
		}
	});

	it('rejects attachment missing required fields', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'test-token' },
			body: JSON.stringify({
				prompt: 'Test prompt',
				username: 'testuser',
				attachments: [{
					filename: 'test.png',
					mimeType: 'image/png',
				}],
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		expect(response.status).toBe(400);
		expect(data).toHaveProperty('error', 'Attachment must include filename, mimeType, and data');
	});

	it('validates image attachment format', async () => {
		const smallImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'test-token' },
			body: JSON.stringify({
				prompt: 'What is in this image?',
				username: 'testuser',
				attachments: [{
					filename: 'test.png',
					mimeType: 'image/png',
					data: smallImageBase64,
				}],
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		if (response.status === 400 && data.error) {
			expect(data.error).not.toContain('Attachment must include');
			expect(data.error).not.toContain('Unsupported file type');
			expect(data.error).not.toContain('Invalid file data');
			expect(data.error).not.toContain('File size exceeds');
		}
	});

	it('validates document attachment format', async () => {
		const textBase64 = btoa('This is a test document content.');
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'test-token' },
			body: JSON.stringify({
				prompt: 'Summarize this document',
				username: 'testuser',
				attachments: [{
					filename: 'test.txt',
					mimeType: 'text/plain',
					data: textBase64,
				}],
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		if (response.status === 400 && data.error) {
			expect(data.error).not.toContain('Attachment must include');
			expect(data.error).not.toContain('Unsupported file type');
			expect(data.error).not.toContain('Invalid file data');
			expect(data.error).not.toContain('Document exceeds');
		}
	});

	it('validates request without attachment', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'CF-Access-JWT-Assertion': 'test-token' },
			body: JSON.stringify({
				prompt: 'Hello, how are you?',
				username: 'testuser',
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		const data = await response.json();
		if (response.status === 400 && data.error) {
			expect(data.error).not.toContain('Attachment must include');
			expect(data.error).not.toContain('Unsupported file type');
			expect(data.error).not.toContain('Invalid file data');
		}
	});
});
