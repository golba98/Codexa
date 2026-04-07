import stringWidth from "string-width";

const ANSI_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

interface DisplayUnit {
  text: string;
  width: number;
}

export interface FittedRow {
  left: string;
  right: string;
  gap: string;
}

function getDisplayUnits(text: string): DisplayUnit[] {
  return Array.from(stripAnsi(text)).map((char) => ({
    text: char,
    width: Math.max(1, stringWidth(char)),
  }));
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function getDisplayWidth(text: string): number {
  return stringWidth(stripAnsi(text));
}

function takeFromStart(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  let width = 0;
  let output = "";

  for (const unit of getDisplayUnits(text)) {
    if (width + unit.width > maxWidth) break;
    output += unit.text;
    width += unit.width;
  }

  return output;
}

function takeFromEnd(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  let width = 0;
  const units = getDisplayUnits(text);
  const kept: DisplayUnit[] = [];

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    if (width + unit.width > maxWidth) break;
    kept.unshift(unit);
    width += unit.width;
  }

  return kept.map((unit) => unit.text).join("");
}

export function truncateEnd(text: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  if (getDisplayWidth(text) <= maxWidth) return stripAnsi(text);

  const cleanText = stripAnsi(text);
  const cleanEllipsis = stripAnsi(ellipsis);
  const ellipsisWidth = getDisplayWidth(cleanEllipsis);

  if (ellipsisWidth >= maxWidth) {
    return takeFromStart(cleanEllipsis, maxWidth);
  }

  return `${takeFromStart(cleanText, maxWidth - ellipsisWidth)}${cleanEllipsis}`;
}

export function truncateMiddle(text: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  if (getDisplayWidth(text) <= maxWidth) return stripAnsi(text);

  const cleanText = stripAnsi(text);
  const cleanEllipsis = stripAnsi(ellipsis);
  const ellipsisWidth = getDisplayWidth(cleanEllipsis);

  if (ellipsisWidth >= maxWidth) {
    return takeFromStart(cleanEllipsis, maxWidth);
  }

  const remainingWidth = maxWidth - ellipsisWidth;
  const leadingWidth = Math.ceil(remainingWidth / 2);
  const trailingWidth = Math.floor(remainingWidth / 2);

  return `${takeFromStart(cleanText, leadingWidth)}${cleanEllipsis}${takeFromEnd(cleanText, trailingWidth)}`;
}

export function truncatePath(path: string, maxWidth: number): string {
  if (!path || maxWidth <= 8 || getDisplayWidth(path) <= maxWidth) return stripAnsi(path) || "";
  const cleanPath = stripAnsi(path);

  // Strategy: Try to keep the drive letter (if Windows) and the tail.
  const hasDrive = /^[a-zA-Z]:\\/.test(cleanPath);
  const prefix = hasDrive ? cleanPath.slice(0, 3) : "";
  const ellipsis = "…";
  const sep = cleanPath.includes("/") ? "/" : "\\";

  const remainingWidth = maxWidth - getDisplayWidth(prefix) - getDisplayWidth(ellipsis);
  if (remainingWidth <= 0) {
    return truncateMiddle(cleanPath, maxWidth);
  }

  // Find a segment-aligned tail if possible, otherwise just take from end
  const segments = cleanPath.slice(prefix.length).split(sep).filter(Boolean);
  let tail = "";
  for (let i = segments.length - 1; i >= 0; i--) {
    const next = (tail ? sep : "") + segments[i]!;
    if (getDisplayWidth(tail + next) > remainingWidth) break;
    tail = next + tail;
  }

  if (!tail) {
    tail = takeFromEnd(cleanPath.slice(prefix.length), remainingWidth);
  } else {
    // Add the leading separator if we took a segment and it wasn't the very first thing after drive
    if (cleanPath.slice(prefix.length).startsWith(sep) && !tail.startsWith(sep)) {
      if (getDisplayWidth(tail) + 1 <= remainingWidth) {
        tail = sep + tail;
      }
    }
  }

  return prefix + ellipsis + tail;
}

function truncateByStrategy(text: string, maxWidth: number, strategy: "end" | "middle"): string {
  return strategy === "middle"
    ? truncateMiddle(text, maxWidth)
    : truncateEnd(text, maxWidth);
}

export function fitLeftRightRow(params: {
  left: string;
  right?: string;
  width: number;
  gap?: number;
  leftStrategy?: "end" | "middle";
  rightStrategy?: "end" | "middle";
}): FittedRow {
  const safeWidth = Math.max(0, params.width);
  const requestedGap = Math.max(0, params.gap ?? 1);
  const rightText = params.right ?? "";

  if (safeWidth === 0) {
    return { left: "", right: "", gap: "" };
  }

  if (!rightText) {
    return {
      left: truncateByStrategy(params.left, safeWidth, params.leftStrategy ?? "end"),
      right: "",
      gap: "",
    };
  }

  const fittedRight = truncateByStrategy(rightText, safeWidth, params.rightStrategy ?? "end");
  const rightWidth = getDisplayWidth(fittedRight);
  let gapWidth = rightWidth > 0 ? Math.min(requestedGap, Math.max(0, safeWidth - rightWidth)) : 0;
  let availableLeft = Math.max(0, safeWidth - rightWidth - gapWidth);
  let fittedLeft = truncateByStrategy(params.left, availableLeft, params.leftStrategy ?? "end");

  if (getDisplayWidth(fittedLeft) === 0 && gapWidth > 0 && getDisplayWidth(params.left) > 0) {
    gapWidth = 0;
    availableLeft = Math.max(0, safeWidth - rightWidth);
    fittedLeft = truncateByStrategy(params.left, availableLeft, params.leftStrategy ?? "end");
  }

  return {
    left: fittedLeft,
    right: fittedRight,
    gap: " ".repeat(gapWidth),
  };
}
