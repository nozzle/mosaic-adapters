import sveltePlugin from 'prettier-plugin-svelte';

/** @type {import('prettier').Config} */
const config = {
	semi: false,
	singleQuote: true,
	trailingComma: 'all',
	plugins: [sveltePlugin],
	overrides: [
		{
			files: '*.svelte',
			options: {
				parser: 'svelte'
			}
		}
	]
};

export default config;
