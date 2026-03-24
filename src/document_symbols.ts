import * as vscode from 'vscode';


type Token = {
    text: string;
    position: vscode.Position;
};


function isWhitespace(ch: string) {
    return ch.match(/\s/)
}

export function isSymbolStartCharacter(ch: string) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch == "_";
}

export function isSymbolMiddleCharacter(ch: string) {
    return isSymbolStartCharacter(ch) || (ch >= "0" && ch <= "9");
}

function tokenize(line: string): Token[] {
    let tokens: Token[] = [];
    let lineNumber = 0;
    let columnNumber = 0;

    for (let i = 0; i < line.length;) {
        let ch = line[i];

        if (ch == "#") {
            while (i < line.length && line[i] != "\n") {
                i += 1;
            }
            continue;
        }

        if (isWhitespace(ch)) {
            if (ch == "\n") {
                lineNumber += 1;
                columnNumber = 0;
            } else {
                columnNumber += 1;
            }

            i += 1;
            continue;
        }

        let currentToken = "";
        currentToken += ch;
        i += 1;

        if (ch == '"') {
            while (i < line.length && line[i] != '"') {
                currentToken += line[i];
                i += 1;
            }
            if (i < line.length) {
                currentToken += line[i];
                i += 1;
            }
        } else if (isSymbolStartCharacter(ch)) {
            while (i < line.length && isSymbolMiddleCharacter(line[i])) {
                currentToken += line[i];
                i += 1;
            }
        }
        
        tokens.push({ text: currentToken, position: new vscode.Position(lineNumber, columnNumber) });
        columnNumber += currentToken.length;
        currentToken = "";
    }
    
    return tokens;
}


export function stringSymbols(text: string, uri: vscode.Uri): vscode.SymbolInformation[] {
    if (text == undefined)
        return [];

    let symbols: vscode.SymbolInformation[] = [];
    let tokens = tokenize(text);
    
    for (var i = 0; i < tokens.length; ++i) {
        if (tokens[i].text == "module" || tokens[i].text == "function" || tokens[i].text == "instrument") {
            i += 1;
            while (i + 2 < tokens.length && tokens[i + 1].text == "::") {
                i += 2;
            }
            if (i < tokens.length) {
                let id = tokens[i].text;

                symbols.push(new vscode.SymbolInformation(
                    id,
                    vscode.SymbolKind.Function,
                    "",
                    new vscode.Location(uri, new vscode.Range(tokens[i].position, new vscode.Position(tokens[i].position.line, tokens[i].position.character + tokens[i].text.length)))
                ));
            }
        }
    } 

    return symbols;
}


export function documentSymbols(document: vscode.TextDocument): vscode.SymbolInformation[] {
    if (document != undefined) {
        return stringSymbols(document.getText(), document.uri);
    }
    return [];
}


export let documentSymbolProvider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        return documentSymbols(document);
    }
}


