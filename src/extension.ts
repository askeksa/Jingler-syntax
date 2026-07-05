import * as vscode from 'vscode';
import { documentSymbolProvider } from "./document_symbols";
import { definitionProvider } from "./definitions";
import { hoverProvider } from "./hover";
import { languageIdentifier } from "./constants";
import { semanticTokensProvider, semanticLegend } from "./syntax_highlighting";
import { computeDiagnostics, createDiagnosticCollection } from "./diagnostics";
import { channel } from "./logging";

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(channel);

	try {
		context.subscriptions.push(
			vscode.languages.registerDocumentSymbolProvider(languageIdentifier, documentSymbolProvider),
			vscode.languages.registerDefinitionProvider(languageIdentifier, definitionProvider),
			vscode.languages.registerHoverProvider(languageIdentifier, hoverProvider),
			vscode.languages.registerDocumentSemanticTokensProvider(languageIdentifier, semanticTokensProvider, semanticLegend),
			vscode.commands.registerCommand(
				'editor.action.blockComment',
				() => vscode.commands.executeCommand('editor.action.commentLine'))
		);
	} catch (err) {
		channel.appendLine(`[activate] failed to register providers: ${err}`);
		return;
	}

	let diagCollection: vscode.DiagnosticCollection;
	try {
		diagCollection = createDiagnosticCollection();
		context.subscriptions.push(diagCollection);
	} catch (err) {
		channel.appendLine(`[activate] failed to create diagnostic collection: ${err}`);
		return;
	}

	async function updateDiagnostics(document: vscode.TextDocument): Promise<void> {
		if (document.languageId !== languageIdentifier) return;
		try {
			const diags = await computeDiagnostics(document);
			diagCollection.set(document.uri, diags);
		} catch (err) {
			channel.appendLine(`[diagnostics] failed for ${document.uri.fsPath}: ${err}`);
		}
	}

	try {
		context.subscriptions.push(
			vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
			vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document)),
			vscode.workspace.onDidCloseTextDocument(e => diagCollection.delete(e.uri)),
		);
	} catch (err) {
		channel.appendLine(`[activate] failed to register document listeners: ${err}`);
		return;
	}

	for (const doc of vscode.workspace.textDocuments) {
		updateDiagnostics(doc);
	}

	channel.appendLine("Jingler extension activated.");
}
