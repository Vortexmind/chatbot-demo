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
						AIG_TOKEN: 'test-aig-token',
						ACCOUNT_ID: 'test-account-id',
						GATEWAY_ID: 'test-gateway-id',
					},
				},
			},
		},
	},
});
