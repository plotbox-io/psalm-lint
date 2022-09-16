import * as vscode from 'vscode';
import * as child from 'child_process';

const decorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'green',
  border: '2px solid white',
});

let psalmStatusBar: vscode.StatusBarItem;
let debugChannel = vscode.window.createOutputChannel("Psalm Docker Debug");

export function activate(context: vscode.ExtensionContext) {
  psalmStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  debugChannel = vscode.window.createOutputChannel("Psalm Docker Debug");

  const fatalError = function (errorMessage: string) {
    psalmStatusBar.text = 'Psalm Docker: ' + errorMessage;
    debugChannel.appendLine(errorMessage);
    throw errorMessage;
  };

  vscode.workspace.onWillSaveTextDocument(event => {
    const openEditor = vscode.window.visibleTextEditors.filter(
      editor => editor.document.uri === event.document.uri
    )[0];
    decorate(openEditor);
  });
}

function decorate(editor: vscode.TextEditor) {
  let relativePath = editor.document.uri.path;
  let projectRoot: string = '';
  vscode.workspace.workspaceFolders?.forEach(folder => {
    if (relativePath.startsWith(folder.uri.path)) {
      relativePath = relativePath.slice(folder.uri.path.length);
      projectRoot = folder.uri.path;
    }
  });
  relativePath = relativePath.replace(/^(\/)/, "");

  const fs = require('fs');
  const composerPath = projectRoot + '/composer.json';
  if (!fs.existsSync(composerPath)) {
    return;
  }

  const composerContents = JSON.parse(fs.readFileSync(composerPath));
  if(composerContents.config.name !== "plotbox-io/plotbox-app") {
    return;
  }

  const command = "docker-compose exec php \
/bin/bash -c \" \
php -d xdebug.start_with_request=no \
  vendor/bin/psalm \
  --no-cache \
  --no-progress \
  --report-show-info=false \
  --output-format=json \
  "+ relativePath + " | \
      php -d memory_limit=-1 vendor/bin/sarb remove psalm.baseline \
      --output-format=json\"";
  let serverProcess = child.exec(
    command,
    { "cwd": projectRoot },
    function (error, stdout, stderr) {
      let decorationsArray: vscode.DecorationOptions[] = [];
      const errorData: any[] = JSON.parse(stdout);

      const diagnostics: vscode.Diagnostic[] = [];
      errorData.forEach(issue => {
        const details = issue.original_tool_details;
        const psalmDiagnosticMessage = `psalm: ${issue.type}. ${issue.message} (See ${details.link})`;
        // const hoverMessage = new vscode.MarkdownString(`<h3>psalm: ${issue.type}</h3>`);
        // hoverMessage.appendMarkdown('<hr>');
        // hoverMessage.appendMarkdown(`<p>${issue.message}</p>`);
        // hoverMessage.appendMarkdown('<hr>');
        // hoverMessage.appendMarkdown(`<p>See <b><a href="${details.link}">here</a></b> for more info</p>`)
        // hoverMessage.supportHtml = true;
        // hoverMessage.isTrusted = true;

        const range = new vscode.Range(
          new vscode.Position(details.line_from - 1, details.column_from - 1),
          new vscode.Position(details.line_to - 1, details.column_to - 1)
        );
        diagnostics.push(new vscode.Diagnostic(
          range,
          psalmDiagnosticMessage,
          vscode.DiagnosticSeverity.Warning
        ));

        // @see https://github.com/microsoft/vscode/issues/54272
        // decorationsArray.push({
        //   'range':range,
        //   'hoverMessage': hoverMessage
        // });
      });

      const psalmDiagnostics: vscode.DiagnosticCollection = vscode.languages.createDiagnosticCollection('psalm');
      const uri: vscode.Uri = vscode.Uri.file(editor.document.uri.path);
      psalmDiagnostics.set(uri, diagnostics);
      // editor.setDecorations(decorationType, decorationsArray);
    });

  const fatalError = function (errorMessage: string) {
    psalmStatusBar.text = 'Psalm Docker: ' + errorMessage;
    debugChannel.appendLine(errorMessage);
    throw errorMessage;
  };
}
