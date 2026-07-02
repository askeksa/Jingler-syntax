declare module "glob" {
	function glob(pattern: string, cb: (err: null | Error, files: string[]) => void): void;
	function glob(pattern: string, options: { cwd?: string }, cb: (err: null | Error, files: string[]) => void): void;
	export = glob;
}

declare module "@vscode/test-electron" {
	export function downloadVSCodeChannel(version: string): Promise<string>;
	export function runTests(options: {
		version?: string;
		extensionDevelopmentPath: string;
		extensionTestsPath: string;
		extensionTestsEnv?: NodeJS.ProcessEnv;
	}): Promise<void>;
}
