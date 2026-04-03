import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "./theme.js";

// ─── WaveBar ─────────────────────────────────────────────────────────────────
// Audio-visualizer style wave. Renders as a single <Text> node to minimise
// the React element tree — important for keeping Ink re-renders cheap.

const WAVE_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const WAVE_COLS = 12;
const WAVE_SPEED = 0.38;  // radians per tick
const WAVE_SPREAD = 0.6;  // phase offset between adjacent columns

interface WaveBarProps {
  tick: number;
  color?: string;
}

export function WaveBar({ tick, color }: WaveBarProps) {
  const theme = useTheme();
  const activeColor = color ?? theme.ACCENT;

  let str = "";
  for (let c = 0; c < WAVE_COLS; c++) {
    const phase = tick * WAVE_SPEED + c * WAVE_SPREAD;
    const normalized = (Math.sin(phase) + 1) / 2; // [0, 1]
    const idx = Math.round(normalized * (WAVE_CHARS.length - 1));
    str += WAVE_CHARS[idx] ?? "▄";
  }

  return <Text color={activeColor}>{str}</Text>;
}

// ─── PulseBar ─────────────────────────────────────────────────────────────────
// Indeterminate progress bar. Renders as 3 <Text> nodes (before / fill / after).

const PULSE_TOTAL = 20;
const PULSE_FILL = 6;
const PULSE_MAX_POS = PULSE_TOTAL - PULSE_FILL; // 14
const PULSE_PERIOD = PULSE_MAX_POS * 2;          // 28
const PULSE_SPEED = 2;                            // ticks per position step

interface PulseBarProps {
  tick: number;
  color?: string;
  dimColor?: string;
}

export function PulseBar({ tick, color, dimColor }: PulseBarProps) {
  const theme = useTheme();
  const activeColor = color ?? theme.ACCENT;
  const inactiveColor = dimColor ?? theme.DIM;

  const raw = Math.floor(tick / PULSE_SPEED) % PULSE_PERIOD;
  const pos = raw < PULSE_MAX_POS ? raw : PULSE_PERIOD - raw;

  const before = "░".repeat(pos);
  const fill   = "█".repeat(PULSE_FILL);
  const after  = "░".repeat(PULSE_TOTAL - pos - PULSE_FILL);

  return (
    <Box>
      <Text color={inactiveColor}>{before}</Text>
      <Text color={activeColor}>{fill}</Text>
      <Text color={inactiveColor}>{after}</Text>
    </Box>
  );
}
