import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					// Deliberately the old magic value: the suite asserts the
					// Worker still rejects unauthenticated requests with it set.
					POLICY_AUD: 'test-policy-aud',
					TEAM_DOMAIN: 'https://test.cloudflareaccess.com',
					CF_ACCESS_CLIENT_ID: 'test-access-client-id',
					CF_ACCESS_CLIENT_SECRET: 'test-access-client-secret',
				},
			},
		}),
	],
});
