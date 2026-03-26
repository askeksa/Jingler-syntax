import * as vscode from 'vscode';
import { isSymbolStartCharacter, isSymbolMiddleCharacter, parseZingDocument, ZingDocument } from "./document_symbols";
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

// Find the longest label containing position
function symbolAt(line: string, position: number): string | undefined {
    let cursor = position;
    var bestPosition = -1;
    var longest = -1;

    while (position >= 0) {
        let length = alphaNumericLabelLength(line, position);
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


async function findSymbolInDocument(document: ZingDocument, symbol: string): Promise<vscode.Location | undefined> {
    let location = findSymbol(document.symbols, symbol);
    if (location != undefined)
        return location;

    for (let includePath of document.includes) {
        let includeUri = vscode.Uri.joinPath(document.uri, "..", includePath);
        try {
            let bytes = await vscode.workspace.fs.readFile(includeUri);
            let text = new TextDecoder().decode(bytes);

            location = await findSymbolInDocument(parseZingDocument(text, includeUri), symbol);
            if (location != undefined)
                return location;
        } catch (e) {
            // Ignore errors reading the file
        }
    }
}


export let definitionProvider: vscode.DefinitionProvider = {
    async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Definition | vscode.LocationLink[] | null> {
        var line = document.lineAt(position.line).text;
        var symbol = symbolAt(line, position.character);
        
        if (symbol != undefined) {
            let location = await findSymbolInDocument(parseZingDocument(document.getText(), document.uri), symbol);
            if (location != undefined) {
                return location;
            }
        }

        return null;
    }
}

