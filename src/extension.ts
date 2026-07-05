import * as vscode from 'vscode';
import { documentSymbolProvider } from "./document_symbols";
import { definitionProvider } from "./definitions";
import { hoverProvider } from "./hover";
import { languageIdentifier } from "./constants";
import { semanticTokensProvider, semanticLegend } from "./syntax_highlighting";
import { computeDiagnostics, createDiagnosticCollection } from "./diagnostics";
import { channel } from "./logging";

export function activate(context: vscode.ExtensionContext) {
	channel.appendLine("[activate] extension activating");
	context.subscriptions.push(channel);

	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(languageIdentifier, documentSymbolProvider),
		vscode.languages.registerDefinitionProvider(languageIdentifier, definitionProvider),
		vscode.languages.registerHoverProvider(languageIdentifier, hoverProvider),
		vscode.languages.registerDocumentSemanticTokensProvider(languageIdentifier, semanticTokensProvider, semanticLegend),
		vscode.commands.registerCommand(
			'editor.action.blockComment',
			() => vscode.commands.executeCommand('editor.action.commentLine'))
	);
	channel.appendLine("[activate] providers registered");

	const diagCollection = createDiagnosticCollection();
	context.subscriptions.push(diagCollection);

	async function updateDiagnostics(document: vscode.TextDocument): Promise<void> {
		if (document.languageId === languageIdentifier) {
			channel.appendLine(`[diagnostics] computing for ${document.uri.fsPath}`);
			const start = Date.now();
			const diags = await computeDiagnostics(document);
			const elapsed = Date.now() - start;
			channel.appendLine(`[diagnostics] ${diags.length} diagnostics in ${elapsed}ms`);
			diagCollection.set(document.uri, diags);
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
		vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document)),
		vscode.workspace.onDidCloseTextDocument(e => diagCollection.delete(e.uri)),
	);
	channel.appendLine("[activate] document listeners registered");

	for (const doc of vscode.workspace.textDocuments) {
		updateDiagnostics(doc);
	}
	channel.appendLine("[activate] done");
}
