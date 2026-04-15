const ESC = "\u001b";
const CSI = `${ESC}[`;

const VK_BACK = 8;
const VK_TAB = 9;
const VK_RETURN = 13;
const VK_ESCAPE = 27;
const VK_PRIOR = 33;
const VK_NEXT = 34;
const VK_END = 35;
const VK_HOME = 36;
const VK_LEFT = 37;
const VK_UP = 38;
const VK_RIGHT = 39;
const VK_DOWN = 40;
const VK_INSERT = 45;
const VK_DELETE = 46;
const VK_M = 77;
const VK_SHIFT = 16;
const VK_CONTROL = 17;
const VK_MENU = 18;

const RIGHT_ALT_PRESSED = 0x1;
const LEFT_ALT_PRESSED = 0x2;
const RIGHT_CTRL_PRESSED = 0x4;
const LEFT_CTRL_PRESSED = 0x8;
const SHIFT_PRESSED = 0x10;

const ALT_PRESSED = RIGHT_ALT_PRESSED | LEFT_ALT_PRESSED;
const CTRL_PRESSED = RIGHT_CTRL_PRESSED | LEFT_CTRL_PRESSED;

const TRANSLATOR_STATE = Symbol("codexa.win32InputTranslator");

export const ENABLE_WIN32_INPUT_MODE = `${CSI}?9001h`;
export const DISABLE_WIN32_INPUT_MODE = `${CSI}?9001l`;

interface Win32KeyEvent {
  virtualKeyCode: number;
  unicodeChar: number;
  keyDown: boolean;
  controlKeyState: number;
  repeatCount: number;
}

function isCsiFinalByte(charCode: number): boolean {
  return charCode >= 0x40 && charCode <= 0x7e;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseWin32KeyEvent(sequence: string): Win32KeyEvent | null {
  const match = /^\u001b\[([0-9;]*)_$/.exec(sequence);
  if (!match) {
    return null;
  }

  const parts = match[1].split(";");
  return {
    virtualKeyCode: parseNumber(parts[0], 0),
    unicodeChar: parseNumber(parts[2], 0),
    keyDown: parseNumber(parts[3], 0) === 1,
    controlKeyState: parseNumber(parts[4], 0),
    repeatCount: Math.max(1, parseNumber(parts[5], 1)),
  };
}

function repeatOutput(value: string, count: number): string {
  if (!value || count <= 1) {
    return value;
  }

  return value.repeat(count);
}

export function translateWin32InputSequence(sequence: string): string {
  const event = parseWin32KeyEvent(sequence);
  if (!event || !event.keyDown) {
    return "";
  }

  const hasCtrl = (event.controlKeyState & CTRL_PRESSED) !== 0;
  const hasAlt = (event.controlKeyState & ALT_PRESSED) !== 0;
  const hasShift = (event.controlKeyState & SHIFT_PRESSED) !== 0;

  switch (event.virtualKeyCode) {
    case VK_SHIFT:
    case VK_CONTROL:
    case VK_MENU:
      return "";
    case VK_BACK:
      return repeatOutput("\u007f", event.repeatCount);
    case VK_TAB:
      return hasShift && !hasCtrl && !hasAlt
        ? repeatOutput(`${CSI}Z`, event.repeatCount)
        : repeatOutput("\t", event.repeatCount);
    case VK_RETURN:
      return hasCtrl
        ? repeatOutput(`${CSI}13;5u`, event.repeatCount)
        : repeatOutput("\r", event.repeatCount);
    case VK_ESCAPE:
      return repeatOutput(ESC, event.repeatCount);
    case VK_PRIOR:
      return repeatOutput(`${CSI}5~`, event.repeatCount);
    case VK_NEXT:
      return repeatOutput(`${CSI}6~`, event.repeatCount);
    case VK_END:
      return repeatOutput(`${CSI}F`, event.repeatCount);
    case VK_HOME:
      return repeatOutput(`${CSI}H`, event.repeatCount);
    case VK_LEFT:
      return repeatOutput(`${CSI}D`, event.repeatCount);
    case VK_UP:
      return repeatOutput(`${CSI}A`, event.repeatCount);
    case VK_RIGHT:
      return repeatOutput(`${CSI}C`, event.repeatCount);
    case VK_DOWN:
      return repeatOutput(`${CSI}B`, event.repeatCount);
    case VK_INSERT:
      return repeatOutput(`${CSI}2~`, event.repeatCount);
    case VK_DELETE:
      return repeatOutput(`${CSI}3~`, event.repeatCount);
    case VK_M:
      if (hasCtrl && !hasAlt) {
        return repeatOutput(`${CSI}109;5u`, event.repeatCount);
      }
      break;
  }

  if (event.unicodeChar > 0) {
    return repeatOutput(String.fromCodePoint(event.unicodeChar), event.repeatCount);
  }

  if (hasCtrl && !hasAlt && event.virtualKeyCode >= 65 && event.virtualKeyCode <= 90) {
    return repeatOutput(String.fromCharCode(event.virtualKeyCode & 0x1f), event.repeatCount);
  }

  return "";
}

export function createWin32InputTranslator() {
  let remainder = "";

  return {
    push(chunk: string): string[] {
      const output: string[] = [];
      let buffer = remainder + chunk;
      let index = 0;

      while (index < buffer.length) {
        const escapeIndex = buffer.indexOf(ESC, index);
        if (escapeIndex === -1) {
          if (index < buffer.length) {
            output.push(buffer.slice(index));
          }
          index = buffer.length;
          break;
        }

        if (escapeIndex > index) {
          output.push(buffer.slice(index, escapeIndex));
          index = escapeIndex;
        }

        if (index + 1 >= buffer.length) {
          break;
        }

        if (buffer[index + 1] !== "[") {
          output.push(ESC);
          index += 1;
          continue;
        }

        let cursor = index + 2;
        while (cursor < buffer.length && !isCsiFinalByte(buffer.charCodeAt(cursor))) {
          cursor += 1;
        }

        if (cursor >= buffer.length) {
          break;
        }

        const sequence = buffer.slice(index, cursor + 1);
        const isWin32Sequence = /^\u001b\[[0-9;]*_$/.test(sequence);
        if (isWin32Sequence) {
          const translated = translateWin32InputSequence(sequence);
          if (translated) {
            output.push(translated);
          }
        } else {
          output.push(sequence);
        }
        index = cursor + 1;
      }

      remainder = buffer.slice(index);
      return output.filter((item) => item.length > 0);
    },
  };
}

type DataEmitter = {
  emit(event: string | symbol, ...args: unknown[]): boolean;
};

type TranslatorState = {
  emit: DataEmitter["emit"];
};

export function installWin32InputTranslator(stdin: unknown): () => void {
  const stream = stdin as DataEmitter & { [TRANSLATOR_STATE]?: TranslatorState };
  if (!stream || typeof stream.emit !== "function") {
    return () => {};
  }

  if (stream[TRANSLATOR_STATE]) {
    return () => {};
  }

  const translator = createWin32InputTranslator();
  const originalEmit = stream.emit.bind(stream);
  stream[TRANSLATOR_STATE] = { emit: originalEmit };

  stream.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (event !== "data" || args.length === 0) {
      return originalEmit(event, ...args);
    }

    const first = args[0];
    const raw = typeof first === "string"
      ? first
      : Buffer.isBuffer(first)
        ? first.toString("utf8")
        : typeof first === "number"
          ? String.fromCharCode(first)
          : "";

    if (!raw) {
      return originalEmit(event, ...args);
    }

    const translatedChunks = translator.push(raw);
    if (translatedChunks.length === 0) {
      return true;
    }

    let handled = true;
    for (const translatedChunk of translatedChunks) {
      handled = originalEmit(event, Buffer.from(translatedChunk, "utf8"), ...args.slice(1)) && handled;
    }

    return handled;
  }) as DataEmitter["emit"];

  return () => {
    const current = stream[TRANSLATOR_STATE];
    if (!current) {
      return;
    }

    stream.emit = current.emit;
    delete stream[TRANSLATOR_STATE];
  };
}
