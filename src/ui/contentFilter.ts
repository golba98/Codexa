/**
 * Content filtering utilities
 * Removes verbose instruction text and boilerplate from AI responses
 */

/**
 * Filters out verbose instruction text that shouldn't be shown to users.
 * Removes lines like:
 * - "Use these markers to structure..."
 * - "[DIFF:filename] Code changes in diff format"
 * - Other format instruction boilerplate
 */
export function filterVerboseInstructions(content: string): string {
  if (!content) return content;

  const lines = content.split('\n');
  const filtered: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line?.trim() || '';
    
    // Skip instruction lines
    if (trimmed.startsWith('Use these markers to structure')) continue;
    if (trimmed.startsWith('Format your response with')) continue;
    if (trimmed.match(/^\[STATUS\]\s+Brief status message/i)) continue;
    if (trimmed.match(/^\[THINKING\]\s+Brief summary/i)) continue;
    if (trimmed.match(/^\[ANALYSIS\]\s+Your detailed analysis/i)) continue;
    if (trimmed.match(/^\[SUGGESTION\]\s+Specific suggestions/i)) continue;
    if (trimmed.match(/^\[DIFF:filename\]\s+Code changes/i)) continue;
    if (trimmed.match(/^\[COMMAND\]\s+Shell commands/i)) continue;
    if (trimmed.match(/^\[SUMMARY\]\s+Brief summary/i)) continue;
    if (trimmed === '---' && i > 0 && i < lines.length - 1) {
      // Skip separator lines between instructions
      const nextLine = lines[i + 1]?.trim() || '';
      if (nextLine.startsWith('Format your response') || nextLine.startsWith('[STATUS]')) {
        continue;
      }
    }
    
    filtered.push(line);
  }
  
  // Remove leading/trailing empty lines
  while (filtered.length > 0 && !filtered[0]?.trim()) {
    filtered.shift();
  }
  while (filtered.length > 0 && !filtered[filtered.length - 1]?.trim()) {
    filtered.pop();
  }
  
  return filtered.join('\n');
}

/**
 * Determines if content is "simple" (just text response, no complex structure)
 */
export function isSimpleResponse(content: string): boolean {
  if (!content) return true;
  
  const hasStructuredMarkers = /\[(STATUS|THINKING|ANALYSIS|DIFF|COMMAND|SUMMARY)\]/i.test(content);
  const hasCodeBlocks = /```/.test(content);
  const hasMultipleSections = content.split('\n\n').length > 3;
  
  return !hasStructuredMarkers && !hasCodeBlocks && !hasMultipleSections;
}
