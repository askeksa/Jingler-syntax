import * as vscode from 'vscode';
import { documentSymbolProvider } from "./document_symbols";
import { definitionProvider } from "./definitions";
import { hoverProvider } from "./hover";
import { languageIdentifier } from "./constants";
import { semanticTokensProvider, semanticLegend } from "./syntax_highlighting";

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

	context.subscriptions.push();
}
