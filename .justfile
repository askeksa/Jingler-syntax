@init:
    npm install
    npm i --save-dev @types/mocha
    npm install -g @vscode/vsce ovsx

@package:
    npm run compile
    vsce package

@publish ovsx_token:
    vsce publish
    npx ovsx publish -p {{ovsx_token}}
