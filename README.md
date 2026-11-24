# Chatbot Demo Worker

A Cloudflare Worker that provides a secure chatbot API using Cloudflare AI Gateway with dynamic routing. Requests are authenticated via Cloudflare Access JWT tokens.

## How It Works

1. **Authentication** — Validates incoming `CF-Access-JWT-Assertion` header against Cloudflare Access
2. **AI Gateway** — Forwards chat prompts to the AI Gateway Unified API endpoint
3. **Dynamic Routing** — Uses `dynamic/chatbot-demo` model route for flexible model selection
4. **Response** — Returns the AI response along with `cf-aig-model` and `cf-aig-provider` headers

### Request Flow

```
Frontend → Worker (auth + validation) → AI Gateway (dynamic route) → Workers AI model
```

**Dynamic Model Selection:**
- **Text-only** → `@cf/ibm-granite/granite-4.0-h-micro` (131K token context, lowest cost)
- **Images** → `@cf/meta/llama-4-scout-17b-16e-instruct` (131K token context, multimodal vision)
- **Documents** → `@cf/google/gemma-4-26b-a4b-it` (256K token context, long documents)
- **Rate-limit fallback** → `@cf/meta/llama-3.1-8b-instruct-fp8-fast` (128K token context)

The Worker detects the attachment type and passes it to AI Gateway via the `cf-aig-metadata` header. The dynamic route selects the model from the `AttachmentType` metadata field.

**Document Processing:**
Documents are converted to text using Cloudflare Workers AI `toMarkdown` utility, which extracts readable content from PDFs, Office documents, and other formats before sending to the AI model.

## API

### POST /

**Request (text-only):**
```json
{
  "prompt": "Your question here",
  "username": "Optional username for metadata"
}
```

**Request (with attachment):**
```json
{
  "prompt": "Your question here",
  "username": "Optional username for metadata",
  "attachments": [{
    "filename": "example.png",
    "mimeType": "image/png",
    "data": "base64-encoded-content"
  }]
}
```

**Attachment Object:**
- `filename` (string, required): Original filename
- `mimeType` (string, required): MIME type of the file
- `data` (string, required): Base64-encoded file content

**Supported File Types:**
- **Images**: `image/png`, `image/jpeg`, `image/gif`, `image/webp`
- **Documents**: 
  - PDF: `application/pdf`
  - Microsoft Office: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (XLSX)
  - Open Document: `application/vnd.oasis.opendocument.text` (ODT), `application/vnd.oasis.opendocument.spreadsheet` (ODS)
  - Web/Data: `text/html`, `application/xml`, `text/csv`
  - Plain text: `text/plain`, `text/markdown`

**Size Limits:**
- Max file size: 10MB per file
- Max document content: 100,000 characters (after text extraction)
- Single attachment per request (first attachment in array is used)

**Headers:**
- `Content-Type: application/json`
- `CF-Access-JWT-Assertion: <jwt_token>`

**Response:**
```json
{
  "response": "AI generated response"
}
```

**Response Headers:**
- `cf-aig-model` — The model used
- `cf-aig-provider` — The provider used

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Secrets

Set the following secrets using Wrangler:

```bash
# AI Gateway (Cloudflare Access service token)
wrangler secret put CF_ACCESS_CLIENT_ID      # Access service token client ID
wrangler secret put CF_ACCESS_CLIENT_SECRET  # Access service token client secret

# Cloudflare Access Authentication
wrangler secret put POLICY_AUD     # Access application audience tag
wrangler secret put TEAM_DOMAIN    # e.g., https://yourteam.cloudflareaccess.com
```

The gateway custom domain is protected by Cloudflare Access and excluded from the zone's WAF custom bot rules. Without that skip rule, server-to-server requests score as automated bots and receive a 403 block page.

The dynamic route name is configured in `wrangler.jsonc`:

```jsonc
"vars": {
  "DYNAMIC_ROUTE_NAME": "dynamic/chatbot-demo"
}
```

### 3. AI Gateway Setup

1. Create an AI Gateway in the Cloudflare dashboard
2. Enable authentication on the gateway
3. Store provider API keys via BYOK only if you route to external providers; Workers AI models need none
4. Put the gateway behind a Cloudflare Access custom domain and allow the Worker's service token with a Service Auth policy. The Worker sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` to `https://ai-gateway.paolo.me.cloudflare.dev/compat/chat/completions`.
5. Create a dynamic route named `chatbot-demo` with the following configuration:

**Dynamic Route Configuration:**

```
Start
  ↓
Rate Limit Node: "Per-User Rate Limit"
  - Key: metadata.Username
  - Limit: [your rate limit]
  - Period: [your period]
  - Fallback → @cf/meta/llama-3.1-8b-instruct-fp8-fast
  ↓ within limit
Conditional: metadata.AttachmentType == "none"
  - TRUE → @cf/ibm-granite/granite-4.0-h-micro
  - FALSE → next conditional
Conditional: metadata.AttachmentType == "image"
  - TRUE → @cf/meta/llama-4-scout-17b-16e-instruct
  - FALSE → next conditional
Conditional: metadata.AttachmentType == "document"
  - TRUE → @cf/google/gemma-4-26b-a4b-it
  - FALSE → @cf/meta/llama-3.1-8b-instruct-fp8-fast
  ↓
End
```

**Metadata Fields:**
- `Username`: User identifier for rate limiting
- `AttachmentType`: `"image"`, `"document"`, or `"none"` for model routing

### 4. Cloudflare Access Setup

1. Create an Access application for your frontend domain
2. Copy the **Application Audience (AUD) Tag** → use as `POLICY_AUD`
3. Your team domain (e.g., `https://yourteam.cloudflareaccess.com`) → use as `TEAM_DOMAIN`
4. Ensure the frontend sends the `CF-Access-JWT-Assertion` header with the JWT from the `CF_Authorization` cookie

### 5. Deploy

```bash
wrangler deploy
```

## Development

```bash
wrangler dev
```

## Project Structure

```
src/
├── index.ts   # Main worker entry point
└── auth.ts    # Cloudflare Access JWT validation
```

## CORS

The worker uses dynamic origin checking to support both production and local development:

**Allowed origins:**
- `https://chatbot-demo.homesecurity.rocks` (production)
- `http://localhost:3000` (local dev)
- `http://localhost:3001` (local dev)

The `Access-Control-Allow-Origin` header is set dynamically based on the request's `Origin` header. If the origin is not in the allowed list, it defaults to the production origin.

## Related

- [chatbot-demo-frontend](../chatbot-demo-frontend) - Next.js frontend
- [AI Gateway Docs](https://developers.cloudflare.com/ai-gateway/)
