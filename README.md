# Chatbot Demo Worker

A Cloudflare Worker that provides a secure chatbot API using Cloudflare AI Gateway with dynamic routing. Requests are authenticated via Cloudflare Access JWT tokens.

## How It Works

1. **Authentication** — Validates incoming `CF-Access-JWT-Assertion` header against Cloudflare Access
2. **AI Gateway** — Forwards chat prompts to the AI Gateway Unified API endpoint
3. **Dynamic Routing** — Uses `dynamic/chatbot-demo` model route for flexible model selection
4. **Response** — Returns the AI response along with `cf-aig-model` and `cf-aig-provider` headers

### Request Flow

```
Frontend → Worker (auth check) → AI Gateway (dynamic route) → LLM Provider
```

## API

### POST /

**Request:**
```json
{
  "prompt": "Your question here",
  "username": "Optional username for metadata"
}
```

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
4. Create a dynamic route named `chatbot-demo` with your model configuration

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
