import * as vscode from 'vscode';
import { documentSymbolProvider } from "./document_symbols";
import { definitionProvider } from "./definitions";
import { languageIdentifier } from "./constants";

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(languageIdentifier, documentSymbolProvider),
		vscode.languages.registerDefinitionProvider(languageIdentifier, definitionProvider),
		vscode.commands.registerCommand(
			'editor.action.blockComment',
			() => vscode.commands.executeCommand('editor.action.commentLine'))
	);

	context.subscriptions.push();
}
