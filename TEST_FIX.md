# Test authentication

Tests never weaken the deployed Worker's authentication.

## Approach

`src/index.ts` exports `createApp(authenticate)` and a default instance built with
the real `authenticateRequest` from `src/auth.ts`. Tests build their own instance
with a stub authenticator:

```ts
import { createApp } from '../src/index';

const app = createApp(async () => ({
	success: true,
	identity: { email: 'test@example.com', sub: 'test-subject' },
}));
```

There is no `POLICY_AUD === 'test-policy-aud'` bypass in the Worker. That value
previously disabled authentication for any deployment that happened to use it.

## Regression test

`vitest.config.mts` still binds `POLICY_AUD: 'test-policy-aud'` on purpose. The
suite asserts that the default export rejects an unauthenticated request with
`401` even with that binding, so reintroducing a magic-value bypass fails CI.

## Running tests

```bash
npm test
```
