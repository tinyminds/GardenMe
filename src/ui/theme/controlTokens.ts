import type { ThemeTokens } from "@/ui/theme/themeTokens";

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function getControlShape(theme: ThemeTokens) {
  return {
    borderWidth: toNumber(theme.controlBorderWidth, 1),
    buttonRadius: toNumber(theme.controlButtonRadius, 10),
    filterRadius: toNumber(theme.controlFilterRadius, 10),
    chipLeftRadius: toNumber(theme.controlChipLeftRadius, 8),
    chipRightRadius: toNumber(theme.controlChipRightRadius, 999),
    segmentRadius: toNumber(theme.controlSegmentRadius, 12),
    segmentOptionRadius: toNumber(theme.controlSegmentOptionRadius, 8),
  };
}

