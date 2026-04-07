export type MouseFilterEvent = "scroll-up" | "scroll-down";

export interface MouseFilterResult {
  output: string;
  events: MouseFilterEvent[];
  hasPending: boolean;
}

const ESC = "\u001b";
const SGR_MOUSE_PATTERN = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/;

function decodeLegacyMouseButton(value: string): number {
  return value.charCodeAt(0) - 32;
}

function toScrollEvent(button: number): MouseFilterEvent | null {
  if (button === 64 || button === 96) return "scroll-up";
  if (button === 65 || button === 97) return "scroll-down";
  return null;
}

function isDigits(value: string): boolean {
  return value.length > 0 && /^\d+$/.test(value);
}

function parseSgrMousePacket(input: string): { length: number; event: MouseFilterEvent | null } | "incomplete" | null {
  const match = input.match(SGR_MOUSE_PATTERN);
  if (match) {
    return {
      length: match[0].length,
      event: toScrollEvent(Number.parseInt(match[1] ?? "", 10)),
    };
  }

  let index = 3; // ESC[<
  let section = 0;
  let token = "";

  while (index < input.length) {
    const char = input[index];

    if (char >= "0" && char <= "9") {
      token += char;
      index += 1;
      continue;
    }

    if (char === ";" && section < 2 && isDigits(token)) {
      token = "";
      section += 1;
      index += 1;
      continue;
    }

    if ((char === "M" || char === "m") && section === 2 && isDigits(token)) {
      return {
        length: index + 1,
        event: toScrollEvent(Number.parseInt(input.slice(3, input.indexOf(";")), 10)),
      };
    }

    return null;
  }

  return "incomplete";
}

function isIncompleteCsiPrefix(input: string): boolean {
  return input === ESC || input === `${ESC}[` || input === `${ESC}[<` || input === `${ESC}[M`;
}

export function createMouseInputFilter() {
  let pending = "";

  return {
    filterChunk(chunk: string): MouseFilterResult {
      const data = pending + chunk;
      pending = "";
      const events: MouseFilterEvent[] = [];
      let output = "";
      let index = 0;

      while (index < data.length) {
        if (data[index] !== ESC) {
          output += data[index];
          index += 1;
          continue;
        }

        const remaining = data.slice(index);

        if (remaining.startsWith(`${ESC}[<`)) {
          const parsed = parseSgrMousePacket(remaining);
          if (parsed === "incomplete") {
            pending = remaining;
            break;
          }
          if (parsed) {
            if (parsed.event) events.push(parsed.event);
            index += parsed.length;
            continue;
          }
        }

        if (remaining.startsWith(`${ESC}[M`)) {
          if (remaining.length < 6) {
            pending = remaining;
            break;
          }

          const event = toScrollEvent(decodeLegacyMouseButton(remaining[3] ?? ""));
          if (event) events.push(event);
          index += 6;
          continue;
        }

        if (isIncompleteCsiPrefix(remaining)) {
          pending = remaining;
          break;
        }

        output += ESC;
        index += 1;
      }

      return { output, events, hasPending: pending.length > 0 };
    },

    flushPending(): string {
      const output = pending;
      pending = "";
      return output;
    },
  };
}
