import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					bindings: {
						POLICY_AUD: 'test-policy-aud',
						TEAM_DOMAIN: 'https://test.cloudflareaccess.com',
						CF_ACCESS_CLIENT_ID: 'test-access-client-id',
						CF_ACCESS_CLIENT_SECRET: 'test-access-client-secret',
					},
				},
			},
		},
	},
});
