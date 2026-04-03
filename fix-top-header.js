const fs = require('fs');
let code = fs.readFileSync('src/ui/TopHeader.tsx', 'utf8');

const oldBox = '<Box width={wordmarkWidth} flexShrink={0} overflow=\"hidden\">\n          {WORDMARK.map((line, index) => (\n            <Text key={\-\} color={theme.TEXT} bold>{line}</Text>\n          ))}\n        </Box>';
const newBox = '<Box flexDirection=\"column\" width={wordmarkWidth} flexShrink={0} overflow=\"hidden\">\n          {WORDMARK.map((line, index) => (\n            <Box key={\-box} overflow=\"hidden\">\n              <Text key={\-\} color={theme.TEXT} bold wrap=\"truncate\">{line}</Text>\n            </Box>\n          ))}\n        </Box>';

code = code.replace(oldBox, newBox);
fs.writeFileSync('src/ui/TopHeader.tsx', code);
console.log('TopHeader fixed.');
