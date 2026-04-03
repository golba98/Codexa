const fs = require('fs');

let headerCode = fs.readFileSync('src/ui/TopHeader.tsx', 'utf8');
const oldWordmark = 'const WORDMARK = [\n  \" ██████╗  ██████╗  ██████╗  ███████╗ ██╗  ██╗  █████╗ \",\n  \"██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝ ╚██╗██╔╝ ██╔══██╗\",\n  \"██║      ██║   ██║ ██║  ██║ █████╗    ╚███╔╝  ███████║\",\n  \"██║      ██║   ██║ ██║  ██║ ██╔══╝    ██╔██╗  ██╔══██║\",\n  \"╚██████╗ ╚██████╔╝ ██████╔╝ ███████╗ ██╔╝ ██╗ ██║  ██║\",\n  \" ╚═════╝  ╚═════╝  ╚═════╝  ╚══════╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝\",\n];';
const newWordmark = 'const WORDMARK = [\n  \" ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗ █████╗ \",\n  \"██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝██╔══██╗\",\n  \"██║     ██║   ██║██║  ██║█████╗   ╚███╔╝ ███████║\",\n  \"██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗ ██╔══██║\",\n  \"╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗██║  ██║\",\n  \" ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝\",\n];';

headerCode = headerCode.replace(oldWordmark, newWordmark);
headerCode = headerCode.replace('const wordmarkWidth = 60;', 'const wordmarkWidth = 56;');
fs.writeFileSync('src/ui/TopHeader.tsx', headerCode);

let turnCode = fs.readFileSync('src/ui/TurnGroup.tsx', 'utf8');
if (!turnCode.includes('import { getUsableShellWidth }')) {
  turnCode = turnCode.replace('import { useTheme } from \"./theme.js\";', 'import { useTheme } from \"./theme.js\";\nimport { getUsableShellWidth } from \"./layout.js\";');
}
turnCode = turnCode.replace('<Panel\n        cols={cols}', '<Panel\n        cols={Math.max(1, getUsableShellWidth(cols, 2))}');
fs.writeFileSync('src/ui/TurnGroup.tsx', turnCode);

let agentCode = fs.readFileSync('src/ui/AgentBlock.tsx', 'utf8');
agentCode = agentCode.replace('<Panel\n        cols={cols}', '<Panel\n        cols={Math.max(1, getUsableShellWidth(cols, 2))}');
fs.writeFileSync('src/ui/AgentBlock.tsx', agentCode);

let mdCode = fs.readFileSync('src/ui/Markdown.tsx', 'utf8');
if (!mdCode.includes('import { getUsableShellWidth }')) {
  mdCode = mdCode.replace('import { Panel } from \"./Panel.js\";', 'import { Panel } from \"./Panel.js\";\nimport { getUsableShellWidth } from \"./layout.js\";');
}
mdCode = mdCode.replace('const panelWidth = cols ? Math.max(10, cols - 4) : 80;', 'const panelWidth = cols ? Math.max(10, getUsableShellWidth(cols, 6)) : 80;');
fs.writeFileSync('src/ui/Markdown.tsx', mdCode);
console.log('done');
