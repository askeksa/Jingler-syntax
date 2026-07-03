import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main() {
	const extensionDevelopmentPath = path.resolve(__dirname, "../../");
	const extensionTestsPath = path.resolve(__dirname, "../test/index");

	try {
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath
		});
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error("Tests failed:", err);
		process.exit(1);
	}
}

main();
