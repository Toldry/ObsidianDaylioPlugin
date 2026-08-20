import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
	// ── Base: TypeScript recommended rules ──────────────────────
	...tseslint.configs.recommended,

	// ── Obsidian plugin rules ───────────────────────────────────
	...obsidianmd.configs.recommended,

	// ── Source files ────────────────────────────────────────────
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// Catch genuinely unused variables but allow intentional
			// underscore-prefixed params (Obsidian callbacks, etc.).
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],

			// Warn on `any` but don't block — some Obsidian internals
			// require it (e.g. internalPlugins).
			"@typescript-eslint/no-explicit-any": "warn",

			// Prefer `const` over `let` when the variable is never reassigned.
			"prefer-const": "error",

			// Disallow console.log in source (use the log() helper instead).
			// console.debug, console.info, console.warn, and console.error are fine.
			"no-console": ["warn", { allow: ["debug", "info", "warn", "error"] }],

			// No duplicate imports from the same module.
			"no-duplicate-imports": "error",
		},
	},

	// ── Test files (relaxed) ───────────────────────────────────
	{
		files: ["tests/**/*.ts"],
		rules: {
			// Tests use any-typed mocks heavily.
			"@typescript-eslint/no-explicit-any": "off",
			// Test helpers sometimes have unused params for API shape.
			"@typescript-eslint/no-unused-vars": "off",
			// Tests can use console for debugging.
			"no-console": "off",
		},
	},

	// ── Global ignores ─────────────────────────────────────────
	{
		ignores: [
			"node_modules/",
			"build/",
			"esbuild.config.mjs",
			"eslint.config.mjs",
			"scripts/",
			"*.js",
			"*.cjs",
			"*.mjs",
		],
	},
);
