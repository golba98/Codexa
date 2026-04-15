const ESC = "\u001b";
const CSI = `${ESC}[`;
const SS3 = `${ESC}O`;
const BRACKETED_PASTE_START = `${CSI}200~`;
const BRACKETED_PASTE_END = `${CSI}201~`;
const DELETE_ESCAPE_SEQUENCE = /^\u001b\[3(?:[;:]\d+(?::\d+)*)?~$/;
const CTRL_M_ESCAPE_SEQUENCE = /^\u001b\[(?:(?:109|13)(?:;|:)?5u|27;5;13~)$/;
const SGR_MOUSE_SEQUENCE = /^\u001b\[<\d+;\d+;\d+[Mm]$/;
const X10_MOUSE_SEQUENCE = /^\u001b\[M[\s\S]{3}$/;
const FOCUS_SEQUENCE = /^\u001b\[[IO]$/;

export type TerminalControlKind =
  | "backspace"
  | "delete"
  | "shift_tab"
  | "ctrl_m"
  | "mouse"
  | "focus"
  | "ignored_sequence";

export type TerminalInputEvent =
  | { type: "text"; text: string }
  | { type: "paste"; text: string }
  | { type: "control"; control: TerminalControlKind; leakedText?: string };

function isCsiFinalByte(charCode: number): boolean {
  return charCode >= 0x40 && charCode <= 0x7e;
}

function isEscapeFinalByte(charCode: number): boolean {
  return charCode >= 0x30 && charCode <= 0x7e;
}

function isPrintableCodePoint(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint !== 0x7f && !(codePoint >= 0x80 && codePoint <= 0x9f);
}

function getTrailingPartialLength(source: string, target: string): number {
  const maxLength = Math.min(source.length, target.length - 1);

  for (let length = maxLength; length > 0; length -= 1) {
    if (source.endsWith(target.slice(0, length))) {
      return length;
    }
  }

  return 0;
}

function classifyCsiSequence(sequence: string): TerminalInputEvent {
  const leakedText = sequence.slice(1);

  if (sequence === `${CSI}Z`) {
    return { type: "control", control: "shift_tab", leakedText };
  }

  if (DELETE_ESCAPE_SEQUENCE.test(sequence)) {
    return { type: "control", control: "delete", leakedText };
  }

  if (CTRL_M_ESCAPE_SEQUENCE.test(sequence)) {
    return { type: "control", control: "ctrl_m", leakedText };
  }

  if (SGR_MOUSE_SEQUENCE.test(sequence) || X10_MOUSE_SEQUENCE.test(sequence)) {
    return { type: "control", control: "mouse", leakedText };
  }

  if (FOCUS_SEQUENCE.test(sequence)) {
    return { type: "control", control: "focus", leakedText };
  }

  return { type: "control", control: "ignored_sequence", leakedText };
}

function pushTextEvent(events: TerminalInputEvent[], text: string) {
  if (!text) {
    return;
  }

  const lastEvent = events[events.length - 1];
  if (lastEvent?.type === "text") {
    lastEvent.text += text;
    return;
  }

  events.push({ type: "text", text });
}

export interface TerminalInputParser {
  push: (chunk: string) => TerminalInputEvent[];
  reset: () => void;
  clearPendingSequence: () => void;
}

export function createTerminalInputParser(): TerminalInputParser {
  let pendingSequence = "";
  let bracketedPasteBuffer: string | null = null;

  return {
    push(chunk: string) {
      if (!chunk) {
        return [];
      }

      const events: TerminalInputEvent[] = [];
      let buffer = pendingSequence + chunk;
      pendingSequence = "";
      let index = 0;

      while (index < buffer.length) {
        if (bracketedPasteBuffer !== null) {
          const remaining = buffer.slice(index);
          const endIndex = remaining.indexOf(BRACKETED_PASTE_END);

          if (endIndex === -1) {
            const partialLength = getTrailingPartialLength(remaining, BRACKETED_PASTE_END);
            const contentLength = remaining.length - partialLength;
            bracketedPasteBuffer += remaining.slice(0, contentLength);
            pendingSequence = remaining.slice(contentLength);
            break;
          }

          bracketedPasteBuffer += remaining.slice(0, endIndex);
          events.push({ type: "paste", text: bracketedPasteBuffer });
          events.push({
            type: "control",
            control: "ignored_sequence",
            leakedText: BRACKETED_PASTE_END.slice(1),
          });
          bracketedPasteBuffer = null;
          index += endIndex + BRACKETED_PASTE_END.length;
          continue;
        }

        if (buffer.startsWith(BRACKETED_PASTE_START, index)) {
          bracketedPasteBuffer = "";
          events.push({
            type: "control",
            control: "ignored_sequence",
            leakedText: BRACKETED_PASTE_START.slice(1),
          });
          index += BRACKETED_PASTE_START.length;
          continue;
        }

        const char = buffer[index]!;

        if (char === ESC) {
          if (index + 1 >= buffer.length) {
            pendingSequence = buffer.slice(index);
            break;
          }

          const next = buffer[index + 1]!;

          if (next === "\u007f") {
            events.push({ type: "control", control: "backspace" });
            index += 2;
            continue;
          }

          if (next === "[") {
            let cursor = index + 2;

            while (cursor < buffer.length && !isCsiFinalByte(buffer.charCodeAt(cursor))) {
              cursor += 1;
            }

            if (cursor >= buffer.length) {
              pendingSequence = buffer.slice(index);
              break;
            }

            const sequence = buffer.slice(index, cursor + 1);
            events.push(classifyCsiSequence(sequence));
            index = cursor + 1;
            continue;
          }

          if (next === "O") {
            if (index + 2 >= buffer.length) {
              pendingSequence = buffer.slice(index);
              break;
            }

            const sequence = buffer.slice(index, index + 3);
            events.push({
              type: "control",
              control: "ignored_sequence",
              leakedText: sequence.slice(1),
            });
            index += 3;
            continue;
          }

          if (!isEscapeFinalByte(buffer.charCodeAt(index + 1))) {
            pendingSequence = buffer.slice(index);
            break;
          }

          const sequence = buffer.slice(index, index + 2);
          events.push({
            type: "control",
            control: "ignored_sequence",
            leakedText: sequence.slice(1),
          });
          index += 2;
          continue;
        }

        if (char === "\b" || char === "\x08" || char === "\u007f") {
          events.push({ type: "control", control: "backspace" });
          index += 1;
          continue;
        }

        if (char === "\n") {
          pushTextEvent(events, "\n");
          index += 1;
          continue;
        }

        if (char === "\r" || char === "\t") {
          index += 1;
          continue;
        }

        const codePoint = buffer.codePointAt(index);
        if (codePoint === undefined) {
          index += 1;
          continue;
        }

        if (!isPrintableCodePoint(codePoint)) {
          index += codePoint > 0xffff ? 2 : 1;
          continue;
        }

        const start = index;
        index += codePoint > 0xffff ? 2 : 1;

        while (index < buffer.length) {
          const nextCodePoint = buffer.codePointAt(index);
          if (
            nextCodePoint === undefined
            || buffer[index] === ESC
            || buffer[index] === "\b"
            || buffer[index] === "\x08"
            || buffer[index] === "\u007f"
            || buffer[index] === "\r"
            || buffer[index] === "\t"
            || !isPrintableCodePoint(nextCodePoint)
          ) {
            break;
          }

          index += nextCodePoint > 0xffff ? 2 : 1;
        }

        pushTextEvent(events, buffer.slice(start, index));
      }

      return events;
    },

    reset() {
      pendingSequence = "";
      bracketedPasteBuffer = null;
    },

    clearPendingSequence() {
      pendingSequence = "";
    },
  };
}
