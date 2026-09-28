import { getGitHubCredentials } from '$lib/server/context';
import type { PageServerLoad } from './$types';

const title = 'Documentation · Hansi';
const description =
	'How Hansi reviews a pull request, how to configure .hansi.json, what the grades mean, and how to run the hansi-loop skill.';

export const load: PageServerLoad = async () => {
	const configured = !!(await getGitHubCredentials());
	return { configured, title, description };
};
