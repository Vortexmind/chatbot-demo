# Chatbot Demo Worker

A Cloudflare Worker that provides a secure chatbot API using Cloudflare AI Gateway with dynamic routing. Requests are authenticated via Cloudflare Access JWT tokens.

## How It Works

1. **Authentication** — Validates incoming `CF-Access-JWT-Assertion` header against Cloudflare Access
2. **AI Gateway** — Forwards chat prompts to the AI Gateway Unified API endpoint
3. **Dynamic Routing** — Uses `dynamic/chatbot-demo` model route for flexible model selection
4. **Response** — Returns the AI response along with `cf-aig-model` and `cf-aig-provider` headers

### Request Flow

```
Frontend → Worker (auth + validation) → AI Gateway (dynamic route) → Meta Llama Model
```

**Dynamic Model Selection:**
- **Images** → `llama-4-scout-17b-16e-instruct` (131K token context, multimodal vision)
- **Documents** → `llama-3.2-3b-instruct` (128K token context, optimized for long documents)
- **Text-only** → `llama-3.1-8b-instruct-fast` (128K token context, fast and efficient)

The Worker automatically detects the attachment type and passes it to AI Gateway via the `cf-aig-metadata` header. Dynamic routing in AI Gateway then selects the appropriate Meta Llama model based on the `AttachmentType` metadata field.

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
# AI Gateway
wrangler secret put AIG_TOKEN      # Cloudflare API token for AI Gateway
wrangler secret put ACCOUNT_ID     # Your Cloudflare account ID
wrangler secret put GATEWAY_ID     # Your AI Gateway ID

# Cloudflare Access Authentication
wrangler secret put POLICY_AUD     # Access application audience tag
wrangler secret put TEAM_DOMAIN    # e.g., https://yourteam.cloudflareaccess.com
```

The dynamic route name is configured in `wrangler.jsonc`:

```jsonc
"vars": {
  "DYNAMIC_ROUTE_NAME": "dynamic/chatbot-demo"
}
```

### 3. AI Gateway Setup

1. Create an AI Gateway in the Cloudflare dashboard
2. Enable authentication on the gateway
3. Store provider API keys via BYOK (Bring Your Own Keys)
4. Create a dynamic route named `chatbot-demo` with the following configuration:

**Dynamic Route Configuration:**

```
Start
  ↓
Conditional Node: "Check Attachment Type"
  - Expression: metadata.AttachmentType == "image"
  - TRUE → Model Node: @cf/meta/llama-4-scout-17b-16e-instruct
  - FALSE → Next Conditional

Conditional Node: "Check Document Type"
  - Expression: metadata.AttachmentType == "document"
  - TRUE → Model Node: @cf/meta/llama-3.2-3b-instruct
  - FALSE → Model Node: @cf/meta/llama-3.1-8b-instruct-fast

Rate Limit Node: "Per-User Rate Limit"
  - Key: metadata.Username
  - Limit: [your rate limit]
  - Period: [your period]
  - Fallback: [your fallback model]
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

- [chatbot-demo-frontend](../chatbot-demo-frontend) - Next.js frontend with tabbed UI
- [chatbot-demo-agent](../chatbot-demo-agent) - Agent backend for MCP integration (used by Agent Chat tab)
- [AI Gateway Docs](https://developers.cloudflare.com/ai-gateway/)
