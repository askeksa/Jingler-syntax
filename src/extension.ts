import * as vscode from 'vscode';
import { documentSymbolProvider } from "./document_symbols";
import { definitionProvider } from "./definitions";
import { hoverProvider } from "./hover";
import { languageIdentifier } from "./constants";
import { semanticTokensProvider, semanticLegend } from "./syntax_highlighting";
import { computeDiagnostics, createDiagnosticCollection } from "./diagnostics";

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(languageIdentifier, documentSymbolProvider),
		vscode.languages.registerDefinitionProvider(languageIdentifier, definitionProvider),
		vscode.languages.registerHoverProvider(languageIdentifier, hoverProvider),
		vscode.languages.registerDocumentSemanticTokensProvider(languageIdentifier, semanticTokensProvider, semanticLegend),
		vscode.commands.registerCommand(
			'editor.action.blockComment',
			() => vscode.commands.executeCommand('editor.action.commentLine'))
	);

	const diagCollection = createDiagnosticCollection();
	context.subscriptions.push(diagCollection);

	async function updateDiagnostics(document: vscode.TextDocument): Promise<void> {
		if (document.languageId === languageIdentifier) {
			diagCollection.set(document.uri, await computeDiagnostics(document));
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
		vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document)),
		vscode.workspace.onDidCloseTextDocument(e => diagCollection.delete(e.uri)),
	);

	for (const doc of vscode.workspace.textDocuments) {
		updateDiagnostics(doc);
	}
}
