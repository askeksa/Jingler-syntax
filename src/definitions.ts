import * as vscode from 'vscode';
import { isSymbolStartCharacter, isSymbolMiddleCharacter, documentSymbols, stringSymbols } from "./document_symbols";
import { fileEnding } from "./constants";

// Return the length of an alpha numeric label at index
function alphaNumericLabelLength(line: string, index: number): number {
    if (index >= line.length)
        return 0;

    let startIndex = index;
    if (isSymbolStartCharacter(line[startIndex])) {
        var endIndex = startIndex + 1;

        while (index < line.length && isSymbolMiddleCharacter(line[endIndex])) {
            endIndex += 1;
        }

        return endIndex - startIndex;
    }

    return 0;
}

function symbolLengthAt(line: string, index: number): number {
    return alphaNumericLabelLength(line, index);
}


// Find the longest label containing position
function symbolAt(line: string, position: number): string | undefined {
    let cursor = position;
    var bestPosition = -1;
    var longest = -1;

    while (position >= 0) {
        let length = symbolLengthAt(line, position);
        if (length > 0 && position + length >= cursor && length > longest) {
            bestPosition = position;
            longest = length;
        }
        position -= 1;
    }

    if (bestPosition < 0)
        return undefined;

    return line.slice(bestPosition, bestPosition + longest);
}


function findSymbol(definitions: vscode.SymbolInformation[], symbol: string): vscode.Location | undefined {
    for (let definition of definitions) {
        if (definition.name == symbol) {
            return definition.location;
        }
    }

    return undefined;
}


function findSymbolInDocument(document: vscode.TextDocument, symbol: string): vscode.Location | undefined {
    var definitions = documentSymbols(document);
    return findSymbol(definitions, symbol);
}


function findSymbolInString(text: string, uri: vscode.Uri, symbol: string): vscode.Location | undefined {
    var definitions = stringSymbols(text, uri);
    return findSymbol(definitions, symbol);
}


export let definitionProvider: vscode.DefinitionProvider = {
    async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition | vscode.LocationLink[] | null> {
        var line = document.lineAt(position.line).text;
        var symbol = symbolAt(line, position.character);

        if (symbol != undefined) {
            let zingDocuments = vscode.workspace.textDocuments.filter(v => v.languageId == "zing");
            for (let doc of zingDocuments) {
                let location = findSymbolInDocument(doc, symbol);
                if (location != undefined)
                    return location;
            }

            for (let fileUri of await vscode.workspace.findFiles("**/*.{" + fileEnding + "}")) {
                let bytes = await vscode.workspace.fs.readFile(fileUri);
                let text = new TextDecoder("latin1").decode(bytes);

                let location = findSymbolInString(text, fileUri, symbol);
                if (location != undefined)
                    return location;
            }
        }

        return null;
    }
}

