# Agent Guidelines for chatbot-demo

This is a Cloudflare Worker project that provides a secure chatbot API using Cloudflare AI Gateway with Cloudflare Access JWT authentication.

## Build, Test, and Development Commands

### Development
```bash
npm run dev          # Start local development server (alias: npm start)
wrangler dev         # Direct wrangler dev command
```

### Testing
```bash
npm test                                    # Run all tests with vitest
npx vitest test/index.spec.ts              # Run single test file
npx vitest test/index.spec.ts -t "test name"  # Run specific test by name
```

### Deployment
```bash
npm run deploy       # Deploy to Cloudflare
wrangler deploy      # Direct deployment
```

### Type Generation
```bash
npm run cf-typegen      # Generate Cloudflare Worker types
npm run generate-types  # Alias for cf-typegen
```

## Project Structure

```
src/
├── index.ts   # Main worker entry point with CORS, request handling, and attachment processing
└── auth.ts    # Cloudflare Access JWT validation using jose library
test/
└── index.spec.ts  # Vitest tests using @cloudflare/vitest-pool-workers
```

### Key Functions in src/index.ts

- `convertDocumentToText(attachment: Attachment, env: Env)`: Converts documents to text using Workers AI toMarkdown utility
- `validateAttachment(attachment?: Attachment, env: Env)`: Async validation of attachment size, MIME type, and extracted content length
- `detectAttachmentType(attachment?: Attachment)`: Returns 'image', 'document', or 'none'
- `transformMessagesWithAttachment(prompt: string, attachment?: Attachment, env: Env)`: Async transformation of messages based on attachment type
- `jsonResponse(body: object, status: number, extra: HeadersInit)`: Helper for consistent JSON responses with CORS

## Code Style Guidelines

### Formatting
- **Indentation**: Tabs (not spaces)
- **Line width**: 140 characters max
- **Quotes**: Single quotes for strings
- **Semicolons**: Always use semicolons
- **Line endings**: LF (Unix-style)
- **Trailing whitespace**: Remove all trailing whitespace
- **Final newline**: Always insert final newline

### TypeScript Configuration
- **Target**: ES2021
- **Module**: ES2022
- **Module Resolution**: Bundler
- **Strict mode**: Enabled (all strict type-checking options)
- **Isolated modules**: true
- **No emit**: true (Wrangler handles compilation)

### Import Style
- Use ES module imports: `import { x } from 'module';`
- Import from `cloudflare:test` for test utilities
- Import from `jose` for JWT handling
- Order: external modules first, then relative imports

Example:
```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { authenticateRequest, AuthEnv } from './auth';
```

### Type Definitions
- Always define interfaces for environment bindings
- Use TypeScript generics for type safety on external data
- Prefer `interface` over `type` for object shapes
- Use explicit return types for exported functions
- Define interfaces for request body structures

Example:
```typescript
export interface AuthEnv {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
}

interface Env extends AuthEnv {
	AI: Ai;
	AIG_TOKEN: string;
	ACCOUNT_ID: string;
	GATEWAY_ID: string;
	DYNAMIC_ROUTE_NAME: string;
}

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
```

### Naming Conventions
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `CORS_HEADERS`, `AIG_TOKEN`)
- **Interfaces**: PascalCase (e.g., `AuthEnv`, `Env`)
- **Functions**: camelCase (e.g., `authenticateRequest`, `jsonResponse`)
- **Variables**: camelCase (e.g., `teamDomain`, `prompt`, `username`)
- **Type aliases**: PascalCase (e.g., `AuthResult`)

### Error Handling
- Use try-catch for async operations that might fail
- Return proper HTTP status codes (400 for bad input, 401 for auth, 500 for server errors)
- Log errors to console with context: `console.error('Context:', details)`
- Always include CORS headers in error responses
- Provide descriptive error messages in JSON responses

Example:
```typescript
try {
	const body = await request.json<{ prompt?: string; username?: string }>();
	// ... handle body
} catch {
	return jsonResponse({ error: 'Invalid JSON body' }, 400);
}
```

### Response Patterns
- Use helper functions for consistent response formatting
- Include CORS headers in all responses (including errors and OPTIONS)
- Return JSON with proper Content-Type header
- Use discriminated unions for success/failure results

Example:
```typescript
function jsonResponse(body: object, status = 200, extra: HeadersInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
	});
}
```

### Security Best Practices
- Always validate JWT tokens before processing requests
- Use type assertions carefully with `json<T>()` for external data
- Sanitize error messages to avoid leaking sensitive information
- Log authentication failures with context for debugging
- Use secure headers (CORS with specific origins, not wildcards)

### Testing
- Use vitest with `@cloudflare/vitest-pool-workers` for Cloudflare Worker environment
- Import test utilities from `cloudflare:test`
- Create execution contexts for unit tests
- Use inline snapshots for expected outputs
- Test both unit style (with context) and integration style (using SELF.fetch)

## Environment Variables & Secrets

**Secrets** (set via `wrangler secret put`):
- `AIG_TOKEN` - Cloudflare API token for AI Gateway
- `ACCOUNT_ID` - Cloudflare account ID
- `GATEWAY_ID` - AI Gateway ID
- `POLICY_AUD` - Access application audience tag
- `TEAM_DOMAIN` - Cloudflare Access team domain (e.g., https://yourteam.cloudflareaccess.com)

**Variables** (in wrangler.jsonc):
- `DYNAMIC_ROUTE_NAME` - AI Gateway dynamic route name (default: "dynamic/chatbot-demo")

## API Patterns

### Request Flow
1. Handle OPTIONS for CORS preflight
2. Validate HTTP method (POST only)
3. Authenticate via CF Access JWT
4. Parse and validate request body (including optional attachment)
5. Validate attachment (size, MIME type, base64 format)
6. Detect attachment type (image, document, or none)
7. Transform messages based on attachment type
8. Make upstream API call (AI Gateway) with metadata
9. Return response with appropriate headers

### Attachment Handling

**Supported Attachment Types:**
- **Images**: `image/png`, `image/jpeg`, `image/gif`, `image/webp`
- **Documents**: 
  - PDF: `application/pdf`
  - Microsoft Office: DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`), XLSX (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
  - Open Document: ODT (`application/vnd.oasis.opendocument.text`), ODS (`application/vnd.oasis.opendocument.spreadsheet`)
  - Web/Data: `text/html`, `application/xml`, `text/csv`
  - Plain text: `text/plain`, `text/markdown`

**Validation Rules:**
- Single attachment per request (first item in `attachments` array is used)
- Max file size: 10MB (calculated from base64)
- Max document content: 100,000 characters after text extraction
- Required fields: `filename`, `mimeType`, `data`
- Base64 data must be valid
- Documents are validated after conversion to text using Workers AI toMarkdown

**Message Transformation:**
- **Images**: Transform to OpenAI vision format with `image_url` content type
  ```typescript
  content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
  ]
  ```
- **Documents**: Convert to text using Workers AI `toMarkdown`, then embed in prompt
  ```typescript
  const { text } = await convertDocumentToText(attachment, env);
  content: `${prompt}\n\n[Attached Document: ${filename}]\n${text}`
  ```
- **Text-only**: Standard message format (unchanged)

**Document Conversion Process:**
1. Decode base64 to binary data (Uint8Array)
2. Create Blob with proper MIME type
3. Call `env.AI.toMarkdown()` to extract text content
4. Use extracted markdown/text in prompt
5. Generic error messages on conversion failure

**Dynamic Model Routing:**
- Pass `AttachmentType` in `cf-aig-metadata` header alongside `Username`
- AI Gateway evaluates `metadata.AttachmentType` to route to appropriate model:
  - `"image"` → `@cf/meta/llama-4-scout-17b-16e-instruct` (131K tokens, multimodal vision)
  - `"document"` → `@cf/meta/llama-3.2-3b-instruct` (128K tokens, optimized for long documents)
  - `"none"` → `@cf/meta/llama-3.1-8b-instruct-fast` (128K tokens, text-only)

### CORS Configuration
- Specific origin (not wildcard): `https://chatbot-demo.homesecurity.rocks`
- Allowed methods: POST, OPTIONS
- Expose custom headers: `cf-aig-model`, `cf-aig-provider`
- Credentials: enabled

## Common Tasks

### Adding new endpoints
1. Handle new HTTP method in the main `fetch()` handler
2. Add method to CORS_HEADERS allowed methods
3. Implement authentication if needed
4. Add proper error handling and logging

### Modifying authentication
- Edit `src/auth.ts`
- Maintain the `AuthResult` discriminated union pattern
- Always return CORS headers in error responses

### Modifying attachment support
- Update `IMAGE_MIME_TYPES` or `DOCUMENT_MIME_TYPES` constants for new file types
- Adjust `MAX_FILE_SIZE_MB` or `MAX_DOCUMENT_CHARS` for size limits
- Modify `transformMessagesWithAttachment()` for different message formats
- Update AI Gateway dynamic route configuration for new models

### Updating dependencies
- Run `npm update` for minor/patch updates
- Check `renovate.json` for automated update configuration
- Run tests after updating: `npm test`
