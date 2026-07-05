import * as path from "path";
import Mocha from "mocha";
import glob from "glob";

// Intercept require('vscode') to load our mock instead of the real vscode package.
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
	if (request === "vscode") {
		return path.resolve(__dirname, "vscode.js");
	}
	return originalResolve(request, parent, isMain, options);
};

export function run(): Promise<void> {
	const mocha = new Mocha({
		ui: "tdd",
		color: true,
		timeout: 10000,
	});

	const testsRoot = path.resolve(__dirname, "..");

	return new Promise((resolve, reject) => {
		glob("**/*.test.js", { cwd: testsRoot }, (err, files) => {
			if (err) return reject(err);

			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				mocha.run((failures: number) => {
					process.exitCode = failures ? 1 : 0;
					resolve();
				});
			} catch (err) {
				reject(err);
			}
		});
	});
}

run().catch(err => { // eslint-disable-next-line no-console
	console.error(err);
	process.exit(1);
});
