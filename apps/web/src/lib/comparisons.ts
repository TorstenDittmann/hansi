// Content for the /vs/[competitor] pages. Keep claims about other products to what their own
// pricing pages and docs say, link those sources, and update `checked` whenever you re-check.

export interface Comparison {
	slug: string;
	name: string;
	/** Month the facts below were last checked against the sources. */
	checked: string;
	headline: string;
	intro: string;
	rows: { label: string; hansi: string; them: string }[];
	differences: { title: string; body: string }[];
	/** Where the other product is the better fit. */
	theirStrengths: string[];
	switching: string;
	faqs: { q: string; a: string }[];
	sources: { label: string; url: string }[];
}

export const comparisons: Comparison[] = [
	{
		slug: 'coderabbit',
		name: 'CodeRabbit',
		checked: 'September 2026',
		headline: 'Hansi vs CodeRabbit',
		intro:
			'CodeRabbit is an established AI reviewer used by many teams, and it does a lot more than Hansi does today. Hansi is newer and smaller, and makes a few different choices: no seat fee, your own model key, and approvals by default. Here is how they compare, including when CodeRabbit is the better choice.',
		rows: [
			{
				label: 'Price',
				hansi: 'Free during the beta. You pay your model provider for tokens.',
				them: '$24 to $72 per developer per month on annual plans, $30 to $60 monthly.'
			},
			{
				label: 'Your own model key',
				hansi:
					'On every plan: OpenAI, Anthropic, Bedrock, Google, xAI, OpenRouter, or any OpenAI-compatible endpoint.',
				them: 'Only with the self-hosted Enterprise edition.'
			},
			{
				label: 'Approvals',
				hansi:
					'On by default. Approves clean pull requests, requests changes for real bugs, and grades each one from S to F.',
				them: 'Off by default. Turned on with the request changes workflow setting.'
			},
			{
				label: 'Cost per review',
				hansi: 'Tokens and cost for every review, by model and repository.',
				them: 'Hourly review limits per developer, then $0.25 per reviewed file.'
			},
			{
				label: 'Git platforms',
				hansi: 'GitHub.',
				them: 'GitHub, GitLab, Azure DevOps, and Bitbucket.'
			}
		],
		differences: [
			{
				title: 'No price per seat',
				body: 'CodeRabbit is priced per developer. Hansi has no seat fee, so adding a teammate or a contractor does not change the price. You pay your model provider for what the reviews use instead.'
			},
			{
				title: 'Your model, your bill',
				body: 'You choose the model and pay your provider directly. You can use a strong model to review and a cheaper one to double-check findings, and the dashboard shows what each review cost.'
			},
			{
				title: 'Fewer comments by default',
				body: 'Hansi tries to flag only obvious mistakes, and a second pass drops findings it cannot confirm. That means it will sometimes stay quiet about things a more thorough reviewer would mention.'
			}
		],
		theirStrengths: [
			'You use GitLab, Azure DevOps, or Bitbucket. Hansi works with GitHub only.',
			'You want reviews in your editor or terminal before you open a pull request.',
			'You want extras such as generated unit tests or merge conflict resolution.',
			'You need enterprise features such as SSO, audit logs, and a dedicated success manager.'
		],
		switching:
			'Move your path_instructions from .coderabbit.yaml to pathInstructions in .hansi.json. Hansi also reads AGENTS.md, CLAUDE.md, .cursorrules, and .github/copilot-instructions.md, so guidelines you already wrote carry over. You can run both on the same repository while you compare.',
		faqs: [
			{
				q: 'Is Hansi cheaper than CodeRabbit?',
				a: 'Hansi has no seat fee during the beta, so you only pay your model provider for the tokens each review uses. That depends on the model and the size of your pull requests, and every review shows its exact cost, so you can compare for yourself.'
			},
			{
				q: 'Can I try Hansi next to CodeRabbit?',
				a: 'Yes. Install Hansi on one repository and compare the reviews on the same pull requests. Both post their own comments and checks.'
			},
			{
				q: 'Does Hansi learn from feedback like CodeRabbit?',
				a: 'In a simple way. Reply to a comment with something like "we don\'t flag this in tests" and Hansi remembers it for future reviews of that repository.'
			}
		],
		sources: [
			{ label: 'CodeRabbit pricing', url: 'https://www.coderabbit.ai/pricing' },
			{
				label: 'CodeRabbit supported platforms',
				url: 'https://docs.coderabbit.ai/platforms/overview'
			},
			{
				label: 'CodeRabbit commands and approvals',
				url: 'https://docs.coderabbit.ai/guides/commands'
			}
		]
	},
	{
		slug: 'greptile',
		name: 'Greptile',
		checked: 'September 2026',
		headline: 'Hansi vs Greptile',
		intro:
			'Greptile is an established AI reviewer that understands your codebase well, and it offers more than Hansi does today. Hansi is newer and smaller, and makes a few different choices: no seat fee or credits, your own model key, and a verdict on every pull request. Here is how they compare, including when Greptile is the better choice.',
		rows: [
			{
				label: 'Price',
				hansi: 'Free during the beta. You pay your model provider for tokens.',
				them: '$30 per seat per month with 50 review credits per seat, then $1 per credit. A free plan covers one developer.'
			},
			{
				label: 'Review limits',
				hansi: 'None. Every push is reviewed.',
				them: 'Credits: 1 per standard review, 3 per deeper review.'
			},
			{
				label: 'Your own model key',
				hansi:
					'On every plan: OpenAI, Anthropic, Bedrock, Google, xAI, OpenRouter, or any OpenAI-compatible endpoint.',
				them: 'Enterprise and self-hosted deployments only.'
			},
			{
				label: 'Cost per review',
				hansi: 'Tokens and cost for every review, by model and repository.',
				them: 'Counted in credits.'
			},
			{
				label: 'Git platforms',
				hansi: 'GitHub.',
				them: 'GitHub, GitLab, and Bitbucket.'
			}
		],
		differences: [
			{
				title: 'No credits',
				body: 'Greptile includes 50 credits per seat each month and bills extra credits at $1 each. Hansi reviews every push without a quota; you pay your provider for the tokens instead.'
			},
			{
				title: 'Your model, your bill',
				body: 'You choose the model and pay your provider directly, on every plan. You can use a strong model to review and a cheaper one to double-check findings.'
			},
			{
				title: 'A verdict on every pull request',
				body: 'Hansi approves or requests changes, and its check run can gate merges. After you push a fix, it reviews what changed, closes fixed threads, and approves.'
			}
		],
		theirStrengths: [
			'You use GitLab or Bitbucket. Hansi works with GitHub only.',
			'You want a prebuilt graph of your repository, or to send review findings straight to Claude Code, Cursor, or Devin.',
			'You need enterprise features such as SSO and SAML.',
			'Your project is open source under MIT or Apache: Greptile offers it for free.'
		],
		switching:
			'Move your custom rules into instructions or pathInstructions in .hansi.json. Hansi also reads AGENTS.md, CLAUDE.md, .cursorrules, and .github/copilot-instructions.md, so guidelines you already wrote carry over. You can run both on the same repository while you compare.',
		faqs: [
			{
				q: 'Is Hansi cheaper than Greptile?',
				a: 'Hansi has no seat fee and no review credits during the beta, so you only pay your model provider for the tokens each review uses. That depends on the model and the size of your pull requests, and every review shows its exact cost.'
			},
			{
				q: 'Does Hansi understand the whole codebase?',
				a: 'Greptile builds a graph of your repository ahead of time. Hansi checks out the repository for each review and explores it like a reviewer: it reads files, searches for callers, and follows the change across files before it reports anything.'
			},
			{
				q: 'Can I try Hansi next to Greptile?',
				a: 'Yes. Install Hansi on one repository and compare the reviews on the same pull requests. Both post their own comments.'
			}
		],
		sources: [
			{ label: 'Greptile pricing', url: 'https://www.greptile.com/pricing' },
			{ label: 'Greptile features', url: 'https://www.greptile.com/' },
			{
				label: 'Greptile GitHub and GitLab integration',
				url: 'https://www.greptile.com/docs/integrations/github-gitlab-integration'
			}
		]
	}
];

export function findComparison(slug: string): Comparison | undefined {
	return comparisons.find((c) => c.slug === slug);
}
