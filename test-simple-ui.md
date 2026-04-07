# Simple UI Test Cases

## Purpose
Verify the clean "Thinking..." UI works correctly for both simple and complex requests.

## Test Cases

### 1. Simple Greeting
**Input:** `hello`
**Expected:**
- Shows animated "Thinking..." during processing
- No verbose task description
- Clean response without instruction boilerplate

### 2. Simple Question
**Input:** `what is TypeScript?`
**Expected:**
- Shows animated "Thinking..." during processing
- Clean response without "[STATUS]", "[SUMMARY]" placeholders

### 3. File Query
**Input:** `what's in src/app.tsx?`
**Expected:**
- Shows animated "Thinking..." 
- May show file inspection panel if files are opened
- Clean response with actual content

### 4. Code Modification Request
**Input:** `add a comment to the top of src/index.tsx`
**Expected:**
- Shows animated "Thinking..."
- Shows file activity panel when files are modified
- Shows diff panel if diffs are generated
- Response displays with file stats (e.g., "1 file touched ~1")
- No verbose "[DIFF:filename] Code changes in diff format" instructions

## What Should NEVER Appear

❌ "Use these markers to structure your response..."
❌ "[STATUS] Brief status message"
❌ "[THINKING] Brief summary" (as instruction template)
❌ "[ANALYSIS] Your detailed analysis" (as instruction template)
❌ "[DIFF:filename] Code changes in diff format"
❌ "[COMMAND] Shell commands to execute"
❌ "[SUMMARY] Brief summary of changes made" (as instruction template)
❌ "Format your response with these markers..."

## What SHOULD Appear

✅ "Thinking..." with animated dots during processing
✅ File panel when files are inspected
✅ Activity panel when tools are used
✅ Diff panel when code is modified
✅ Command panel when shell commands are run
✅ Clean response text (actual content, not instructions)
✅ Legitimate [ANALYSIS] or [SUMMARY] sections with real content

## Implementation Details

**Simple Mode Detection (`StagedRunView.tsx`):**
```typescript
const useSimpleMode = active && !showFiles && !showTools && !showDiffs && !showCommands;
```

**Content Filtering (`contentFilter.ts`):**
- `filterVerboseInstructions()` - removes instruction boilerplate
- `isSimpleResponse()` - helper to detect response complexity

**Components Updated:**
- `ThinkingIndicator.tsx` - animated "Thinking..." with dots
- `StatusPanel.tsx` - uses ThinkingIndicator when `simple={true}`
- `StagedRunView.tsx` - detects simple mode and passes prop
- `ResultPanel.tsx` - filters verbose instructions from completed content

## Verification Commands

```powershell
# TypeScript compilation
bun run typecheck

# All tests
bun test

# Manual testing
npm link
cd some-test-project
codexa
```

## Success Criteria

✅ TypeScript compiles clean
✅ All existing tests pass (148 tests)
✅ Manual testing shows clean "Thinking..." animation
✅ No instruction boilerplate visible in completed responses
✅ File/tool/diff/command panels still work for complex tasks
