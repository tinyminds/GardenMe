import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Slider from "@react-native-community/slider";
import ColorPicker from "react-native-wheel-color-picker";
import Svg, { Circle, ClipPath, Defs, G, Line, Polygon, Rect } from "react-native-svg";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from "@/ui/theme/themeTokens";
import { AppButton } from "@/ui/components/AppButton";
import { ChoiceChip } from "@/ui/components/ChoiceChip";
import { FilterPill } from "@/ui/components/FilterPill";
import { SegmentedChoice } from "@/ui/components/SegmentedChoice";
import { StatusChip } from "@/ui/components/StatusChip";

type TokenSpec = { key: keyof ThemeTokens; label: string };
type NumberTokenSpec = { key: keyof ThemeTokens; label: string; min: number; max: number; step: number };
type MapFeatureSpec = {
  key: string;
  label: string;
  fillKey: keyof ThemeTokens;
  strokeKey: keyof ThemeTokens;
  preview: "tree" | "shrub" | "lawn" | "deck" | "rect";
};

const appTokens: TokenSpec[] = [
  { key: "appBackground", label: "App Background" },
  { key: "surfaceBackground", label: "Card/Surface" },
  { key: "borderColor", label: "Border" },
  { key: "textPrimary", label: "Primary Text" },
  { key: "textMuted", label: "Muted Text" },
  { key: "infoText", label: "Info Text" },
  { key: "modalBackdrop", label: "Modal Backdrop" },
  { key: "modalSurfaceBackground", label: "Modal Surface" },
  { key: "modalSurfaceBorder", label: "Modal Border" },
];

const actionTokens: TokenSpec[] = [
  { key: "primaryActionBackground", label: "Primary Button" },
  { key: "primaryActionText", label: "Primary Text" },
  { key: "secondaryActionBackground", label: "Secondary Button" },
  { key: "secondaryActionText", label: "Secondary Text" },
  { key: "disabledActionBackground", label: "Disabled Button" },
  { key: "disabledActionText", label: "Disabled Text" },
  { key: "dangerActionBackground", label: "Delete Button" },
  { key: "dangerActionText", label: "Delete Text" },
  { key: "choiceControlBackground", label: "Choice Background" },
  { key: "choiceControlText", label: "Choice Text" },
  { key: "choiceControlActiveBackground", label: "Choice Active Bg" },
  { key: "choiceControlActiveText", label: "Choice Active Text" },
  { key: "statusChipBackground", label: "Status Chip Bg" },
  { key: "statusChipText", label: "Status Chip Text" },
  { key: "chipBackground", label: "Chip Bg" },
  { key: "chipActiveBackground", label: "Chip Active Bg" },
  { key: "chipText", label: "Chip Text" },
  { key: "chipActiveText", label: "Chip Active Text" },
  { key: "chipBorder", label: "Chip Border" },
  { key: "filterControlBackground", label: "Filter Background" },
  { key: "filterControlBorder", label: "Filter Border" },
  { key: "filterControlText", label: "Filter Text" },
  { key: "filterControlActiveBackground", label: "Filter Active Bg" },
  { key: "filterControlActiveBorder", label: "Filter Active Border" },
  { key: "filterControlActiveText", label: "Filter Active Text" },
  { key: "toggleOnBackground", label: "Toggle On" },
  { key: "toggleOffBackground", label: "Toggle Off" },
  { key: "toggleThumbColor", label: "Toggle Thumb" },
  { key: "checkboxBackground", label: "Checkbox Bg" },
  { key: "checkboxActiveBackground", label: "Checkbox Active Bg" },
  { key: "checkboxBorder", label: "Checkbox Border" },
  { key: "checkboxActiveBorder", label: "Checkbox Active Border" },
  { key: "checkboxCheckColor", label: "Checkbox Check" },
  { key: "gridLineColor", label: "Grid Line" },
  { key: "mapBoundaryFill", label: "Boundary Fill" },
  { key: "mapBoundaryStroke", label: "Boundary Stroke" },
];

const mapFeatures: MapFeatureSpec[] = [
  { key: "bed", label: "Bed", fillKey: "mapBedFill", strokeKey: "mapBedStroke", preview: "rect" },
  { key: "perennial-bed", label: "Perennial Bed", fillKey: "mapPerennialBedFill", strokeKey: "mapBedStroke", preview: "rect" },
  { key: "lawn", label: "Lawn", fillKey: "mapLawnFill", strokeKey: "mapLawnStroke", preview: "lawn" },
  { key: "tree", label: "Tree", fillKey: "mapTreeFill", strokeKey: "mapTreeStroke", preview: "tree" },
  { key: "shrub", label: "Shrub", fillKey: "mapShrubFill", strokeKey: "mapShrubStroke", preview: "shrub" },
  { key: "hedge", label: "Hedge", fillKey: "mapHedgeFill", strokeKey: "mapHedgeStroke", preview: "rect" },
  { key: "path", label: "Path", fillKey: "mapPathFill", strokeKey: "mapPathStroke", preview: "rect" },
  { key: "wall", label: "Wall", fillKey: "mapWallFill", strokeKey: "mapWallStroke", preview: "rect" },
  { key: "fence", label: "Fence", fillKey: "mapFenceFill", strokeKey: "mapFenceStroke", preview: "rect" },
  { key: "trellis", label: "Trellis", fillKey: "mapTrellisFill", strokeKey: "mapTrellisStroke", preview: "rect" },
  { key: "patio", label: "Patio", fillKey: "mapPatioFill", strokeKey: "mapPatioStroke", preview: "rect" },
  { key: "deck", label: "Deck", fillKey: "mapDeckFill", strokeKey: "mapDeckStroke", preview: "deck" },
];

const controlShapeTokens: NumberTokenSpec[] = [
  { key: "controlBorderWidth", label: "Control Border Width", min: 0, max: 3, step: 0.5 },
  { key: "controlButtonRadius", label: "Button Radius", min: 0, max: 24, step: 1 },
  { key: "controlFilterRadius", label: "Filter Radius", min: 0, max: 24, step: 1 },
  { key: "controlChipLeftRadius", label: "Chip Left Radius", min: 0, max: 24, step: 1 },
  { key: "controlChipRightRadius", label: "Chip Right Radius", min: 0, max: 999, step: 1 },
  { key: "controlSegmentRadius", label: "Segment Group Radius", min: 0, max: 24, step: 1 },
  { key: "controlSegmentOptionRadius", label: "Segment Option Radius", min: 0, max: 24, step: 1 },
];

const themePresets: Array<{ id: string; label: string; tokens: Partial<ThemeTokens> }> = [
  { id: "default", label: "Default", tokens: DEFAULT_THEME_TOKENS },
  {
    id: "coastal",
    label: "Coastal",
    tokens: {
      appBackground: "#EEF5FA",
      surfaceBackground: "#FFFFFF",
      borderColor: "#C8D7E2",
      textPrimary: "#143042",
      textMuted: "#4B6474",
      primaryActionBackground: "#DCEAF3",
      primaryActionText: "#1B4159",
      choiceControlBackground: "#EAF3F9",
      choiceControlText: "#1B4159",
      choiceControlActiveBackground: "#1E6A8A",
      choiceControlActiveText: "#FFFFFF",
      statusChipBackground: "#EEF6FB",
      statusChipText: "#1B4159",
      chipBackground: "#F0F7FC",
      chipActiveBackground: "#D6E7F0",
      chipText: "#2C5F75", 
      chipActiveText: "#1B4159",
      chipBorder: "#C0D4E0",
      filterControlBackground: "#F4F9FC",
      filterControlBorder: "#9EB7C9",
      filterControlText: "#1B4159",
      filterControlActiveBackground: "#1E6A8A",
      filterControlActiveBorder: "#1E6A8A",
      filterControlActiveText: "#FFFFFF",
      secondaryActionBackground: "#DCEAF3",
      secondaryActionText: "#1B4159",
      dangerActionBackground: "#C2513E",
      toggleOnBackground: "#2A6C89",
      toggleOffBackground: "#BFD3DF",
      gridLineColor: "#325D7545",
      mapBoundaryFill: "#2A5D7B1F",
      mapBoundaryStroke: "#2B6A8D",
      mapBedFill: "#4B9D8B4A",
      mapPerennialBedFill: "#3C7CB24A",
      mapLawnFill: "#7AB88B3A",
      mapTreeFill: "#2D7F5A4A",
      mapShrubFill: "#70B07A4A",
      mapDeckFill: "#9F7C594C",
      mapDeckStroke: "#7E5E41",
      mapPathFill: "#9AAAB74A",
      mapPathStroke: "#778A98",
    },
  },
  {
    id: "sunset",
    label: "Sunset Earth",
    tokens: {
      appBackground: "#F8EFE6",
      surfaceBackground: "#FFF9F3",
      borderColor: "#E3CDB7",
      textPrimary: "#4B2F22",
      textMuted: "#7A5B4A",
      primaryActionBackground: "#F2DFCF",
      primaryActionText: "#5E3B29",
      choiceControlBackground: "#F8EDE2",
      choiceControlText: "#5E3B29",
      choiceControlActiveBackground: "#B95E2D",
      choiceControlActiveText: "#FFFFFF",
      statusChipBackground: "#FBF2EA",
      statusChipText: "#5E3B29",
      chipBackground: "#FDF8F2",
      chipActiveBackground: "#F0E4D4", 
      chipText: "#7A5B45",
      chipActiveText: "#5E3B29",
      chipBorder: "#E0D0BC",
      filterControlBackground: "#FCF5EE",
      filterControlBorder: "#D3B59C",
      filterControlText: "#5E3B29",
      filterControlActiveBackground: "#B95E2D",
      filterControlActiveBorder: "#B95E2D",
      filterControlActiveText: "#FFFFFF",
      secondaryActionBackground: "#F2DFCF",
      secondaryActionText: "#5E3B29",
      dangerActionBackground: "#B43C2C",
      toggleOnBackground: "#A6542A",
      toggleOffBackground: "#DFC6B3",
      gridLineColor: "#6F4B3240",
      mapBoundaryFill: "#AA6D3A1E",
      mapBoundaryStroke: "#9E5F33",
      mapBedFill: "#C882514A",
      mapPerennialBedFill: "#8D5B9E4A",
      mapLawnFill: "#B9B36A3C",
      mapTreeFill: "#7E6A3F4D",
      mapShrubFill: "#A7905A4A",
      mapDeckFill: "#A66F424D",
      mapDeckStroke: "#845432",
      mapPathFill: "#B6A3944D",
      mapPathStroke: "#8D7A6C",
      mapFenceFill: "#A877534D",
      mapFenceStroke: "#855539",
    },
  },
];

export default function StyleguideScreen() {
  const { theme, setToken, resetTheme, applyThemePreset } = useTheme();
  const [activeToken, setActiveToken] = useState<keyof ThemeTokens | null>(null);
  const [hexDraftByToken, setHexDraftByToken] = useState<Record<string, string>>({});
  const activePresetId = useMemo(
    () => themePresets.find((preset) => isPresetActive(theme, preset.tokens))?.id ?? null,
    [theme]
  );

  const activeLabel = useMemo(() => {
    if (!activeToken) return "Tap any color swatch below";
    const all = [...appTokens, ...actionTokens];
    const top = all.find((item) => item.key === activeToken);
    if (top) return top.label;
    const feature = mapFeatures.find((item) => item.fillKey === activeToken || item.strokeKey === activeToken);
    if (feature) return `${feature.label} ${feature.fillKey === activeToken ? "Fill" : "Outline"}`;
    return String(activeToken);
  }, [activeToken]);

  const setActive = (token: keyof ThemeTokens) => {
    setActiveToken(token);
    setHexDraftByToken((prev) => ({ ...prev, [token]: normalizeHex(theme[token]) }));
  };

  const setTokenColor = (token: keyof ThemeTokens, input: string) => {
    const rgb = toRgbHex(input);
    if (!rgb) return;
    const alpha = alphaHexFromPercent(getOpacityPercent(theme[token]));
    const next = `${rgb}${alpha}`;
    setToken(token, next);
    setHexDraftByToken((prev) => ({ ...prev, [token]: next }));
  };

  const setTokenOpacity = (token: keyof ThemeTokens, percent: number) => {
    const rgb = toRgbHex(theme[token]) ?? "#888888";
    const next = `${rgb}${alphaHexFromPercent(percent)}`;
    setToken(token, next);
    setHexDraftByToken((prev) => ({ ...prev, [token]: next }));
  };

  const resetToken = (token: keyof ThemeTokens) => {
    const next = DEFAULT_THEME_TOKENS[token];
    setToken(token, next);
    setHexDraftByToken((prev) => ({ ...prev, [token]: normalizeHex(next) }));
  };

  return (
    <View style={[styles.page, { backgroundColor: theme.appBackground }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Theme Editor</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>Edit app theme tokens with inline previews and pickers.</Text>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.groupTitle, { color: theme.textPrimary }]}>Quick Preview</Text>
          <SegmentedChoice
            options={themePresets.map((preset) => ({ id: preset.id, label: preset.label }))}
            selectedId={activePresetId}
            onSelect={(id) => {
              const preset = themePresets.find((item) => item.id === id);
              if (preset) applyThemePreset(preset.tokens);
            }}
          />
          <View style={styles.previewRow}>
            <AppButton label="Primary" onPress={() => {}} variant="primary" size="sm" />
            <AppButton label="Secondary" onPress={() => {}} variant="secondary" size="sm" />
            <AppButton label="Delete" onPress={() => {}} variant="danger" size="sm" />
            <AppButton label="Disabled" onPress={() => {}} variant="secondary" size="sm" disabled />
          </View>
          <View style={styles.previewRow}>
            <TogglePreview label="On" on={true} theme={theme} />
            <TogglePreview label="Off" on={false} theme={theme} />
            <CheckboxPreview label="Unchecked" checked={false} theme={theme} />
            <CheckboxPreview label="Checked" checked={true} theme={theme} />
          </View>
          <View style={styles.previewRow}>
            <FilterPill label="Filter" selected={false} onPress={() => {}} />
            <FilterPill label="Filter On" selected={true} onPress={() => {}} />
            <ChoiceChip label="Chip" selected={false} />
            <StatusChip label="Status chip" />
          </View>
          <SegmentedChoice
            options={[
              { id: "one", label: "Choice One" },
              { id: "two", label: "Choice Two" },
              { id: "three", label: "Choice Three" },
            ]}
            selectedId="two"
            onSelect={() => {}}
          />
          <View style={[styles.modalPreviewWrap, { backgroundColor: theme.modalBackdrop }]}>
            <View style={[styles.modalPreviewCard, { backgroundColor: theme.modalSurfaceBackground, borderColor: theme.modalSurfaceBorder }]}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Delete area?</Text>
              <View style={styles.previewRow}>
                <AppButton label="Cancel" onPress={() => {}} variant="secondary" size="sm" />
                <AppButton label="Delete" onPress={() => {}} variant="danger" size="sm" />
              </View>
            </View>
          </View>
          <Text style={[styles.activeHint, { color: theme.textMuted }]}>Editing: {activeLabel}</Text>
          <AppButton label="Reset all to default" onPress={resetTheme} variant="secondary" size="sm" />
        </View>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.groupTitle, { color: theme.textPrimary }]}>App + Actions</Text>
          {[...appTokens, ...actionTokens].map((item) => (
            <TokenEditorRow
              key={item.key}
              label={item.label}
              token={item.key}
              theme={theme}
              activeToken={activeToken}
              draftHex={hexDraftByToken[item.key]}
              onSelect={() => setActive(item.key)}
              onReset={() => resetToken(item.key)}
              onColorChange={(color) => setTokenColor(item.key, color)}
              onOpacityChange={(opacity) => setTokenOpacity(item.key, opacity)}
              onHexDraftChange={(hex) => setHexDraftByToken((prev) => ({ ...prev, [item.key]: hex }))}
              onHexCommit={(hex) => {
                const next = normalizeHex(hex || theme[item.key]);
                setToken(item.key, next);
                setHexDraftByToken((prev) => ({ ...prev, [item.key]: next }));
              }}
            />
            ))}
        </View>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.groupTitle, { color: theme.textPrimary }]}>Control Shape</Text>
          {controlShapeTokens.map((item) => (
            <NumberTokenRow
              key={item.key}
              label={item.label}
              token={item.key}
              min={item.min}
              max={item.max}
              step={item.step}
              theme={theme}
              onChange={(value) => setToken(item.key, String(value))}
              onReset={() => setToken(item.key, DEFAULT_THEME_TOKENS[item.key])}
            />
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: theme.surfaceBackground, borderColor: theme.borderColor }]}>
          <Text style={[styles.groupTitle, { color: theme.textPrimary }]}>Map Features</Text>
          {mapFeatures.map((feature) => (
            <View key={feature.key} style={[styles.featureCard, { borderColor: theme.borderColor, backgroundColor: theme.appBackground }]}>
              <Text style={[styles.featureTitle, { color: theme.textPrimary }]}>{feature.label}</Text>
              <FeaturePreview feature={feature} theme={theme} />
              <TokenEditorRow
                label="Fill"
                token={feature.fillKey}
                theme={theme}
                activeToken={activeToken}
                draftHex={hexDraftByToken[feature.fillKey]}
                onSelect={() => setActive(feature.fillKey)}
                onReset={() => resetToken(feature.fillKey)}
                onColorChange={(color) => setTokenColor(feature.fillKey, color)}
                onOpacityChange={(opacity) => setTokenOpacity(feature.fillKey, opacity)}
                onHexDraftChange={(hex) => setHexDraftByToken((prev) => ({ ...prev, [feature.fillKey]: hex }))}
                onHexCommit={(hex) => {
                  const next = normalizeHex(hex || theme[feature.fillKey]);
                  setToken(feature.fillKey, next);
                  setHexDraftByToken((prev) => ({ ...prev, [feature.fillKey]: next }));
                }}
                compact
              />
              <TokenEditorRow
                label="Outline"
                token={feature.strokeKey}
                theme={theme}
                activeToken={activeToken}
                draftHex={hexDraftByToken[feature.strokeKey]}
                onSelect={() => setActive(feature.strokeKey)}
                onReset={() => resetToken(feature.strokeKey)}
                onColorChange={(color) => setTokenColor(feature.strokeKey, color)}
                onOpacityChange={(opacity) => setTokenOpacity(feature.strokeKey, opacity)}
                onHexDraftChange={(hex) => setHexDraftByToken((prev) => ({ ...prev, [feature.strokeKey]: hex }))}
                onHexCommit={(hex) => {
                  const next = normalizeHex(hex || theme[feature.strokeKey]);
                  setToken(feature.strokeKey, next);
                  setHexDraftByToken((prev) => ({ ...prev, [feature.strokeKey]: next }));
                }}
                compact
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function TokenEditorRow(props: {
  label: string;
  token: keyof ThemeTokens;
  theme: ThemeTokens;
  activeToken: keyof ThemeTokens | null;
  draftHex: string | undefined;
  onSelect: () => void;
  onReset: () => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  onHexDraftChange: (hex: string) => void;
  onHexCommit: (hex: string) => void;
  compact?: boolean;
}) {
  const isActive = props.activeToken === props.token;
  const rowStyle = props.compact ? styles.tokenRowCompact : styles.tokenRow;
  return (
    <View style={[styles.tokenBlock, props.compact && styles.tokenBlockCompact]}>
      <View style={[rowStyle, { borderColor: props.theme.borderColor, backgroundColor: props.theme.surfaceBackground }]}>
        <Text style={[styles.tokenLabel, { color: props.theme.textPrimary }]}>{props.label}</Text>
        <View style={styles.tokenRowActions}>
          <Pressable
            onPress={props.onSelect}
            style={[
              styles.editSwatch,
              {
                backgroundColor: props.theme[props.token],
                borderColor: isActive ? props.theme.primaryActionBackground : props.theme.borderColor,
              },
            ]}
          />
          <Pressable onPress={props.onReset} style={[styles.defaultCircle, { backgroundColor: DEFAULT_THEME_TOKENS[props.token], borderColor: props.theme.borderColor }]}>
            <Text style={[styles.defaultCircleText, { color: props.theme.textPrimary }]}>D</Text>
          </Pressable>
        </View>
      </View>
      {isActive && (
        <InlinePickerEditor
          theme={props.theme}
          tokenValue={props.theme[props.token]}
          draftHex={props.draftHex}
          onHexDraftChange={props.onHexDraftChange}
          onHexCommit={props.onHexCommit}
          onColorChange={props.onColorChange}
          onOpacityChange={props.onOpacityChange}
        />
      )}
    </View>
  );
}

function NumberTokenRow(props: {
  label: string;
  token: keyof ThemeTokens;
  min: number;
  max: number;
  step: number;
  theme: ThemeTokens;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const current = Number(props.theme[props.token]);
  const value = Number.isFinite(current) ? current : 0;
  return (
    <View style={[styles.numberRow, { borderColor: props.theme.borderColor, backgroundColor: props.theme.appBackground }]}>
      <Text style={[styles.tokenLabel, { color: props.theme.textPrimary, flex: 1 }]}>{props.label}</Text>
      <AppButton
        label="-"
        size="sm"
        variant="secondary"
        onPress={() => props.onChange(Math.max(props.min, Number((value - props.step).toFixed(2))))}
      />
      <Text style={[styles.numberValue, { color: props.theme.textPrimary }]}>{value}</Text>
      <AppButton
        label="+"
        size="sm"
        variant="secondary"
        onPress={() => props.onChange(Math.min(props.max, Number((value + props.step).toFixed(2))))}
      />
      <AppButton label="Default" size="sm" variant="neutral" onPress={props.onReset} />
    </View>
  );
}

function InlinePickerEditor(props: {
  theme: ThemeTokens;
  tokenValue: string;
  draftHex: string | undefined;
  onHexDraftChange: (hex: string) => void;
  onHexCommit: (hex: string) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}) {
  const currentHex = props.draftHex || normalizeHex(props.tokenValue);
  const opacity = getOpacityPercent(props.tokenValue);
  return (
    <View style={[styles.inlinePicker, { borderColor: props.theme.borderColor, backgroundColor: props.theme.appBackground }]}>
      <View style={styles.pickerTopRow}>
        <View style={[styles.pickerSwatch, { backgroundColor: props.tokenValue, borderColor: props.theme.borderColor }]} />
        <TextInput
          value={currentHex}
          onChangeText={props.onHexDraftChange}
          onBlur={() => props.onHexCommit(currentHex)}
          onSubmitEditing={() => props.onHexCommit(currentHex)}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.hexInput, { backgroundColor: props.theme.surfaceBackground, borderColor: props.theme.borderColor, color: props.theme.textPrimary }]}
        />
      </View>
      <ColorPicker
        color={toRgbHex(props.tokenValue) ?? "#888888"}
        thumbSize={24}
        sliderSize={20}
        noSnap
        row={false}
        swatches={false}
        onColorChange={props.onColorChange}
      />
      <View style={styles.opacityRow}>
        <Text style={[styles.opacityLabel, { color: props.theme.textMuted }]}>Opacity {opacity}%</Text>
        <Slider
          style={styles.opacitySlider}
          minimumValue={0}
          maximumValue={100}
          step={1}
          value={opacity}
          minimumTrackTintColor={props.theme.primaryActionBackground}
          maximumTrackTintColor={props.theme.borderColor}
          thumbTintColor={props.theme.primaryActionBackground}
          onValueChange={(value) => props.onOpacityChange(Math.round(value))}
        />
      </View>
    </View>
  );
}

function CheckboxPreview(props: { label: string; checked: boolean; theme: ThemeTokens }) {
  return (
    <View style={styles.togglePreviewWrap}>
      <View style={[
        styles.checkboxBox, 
        { 
          backgroundColor: props.theme.surfaceBackground,
          borderColor: props.checked ? props.theme.primaryActionBackground : props.theme.borderColor,
          borderWidth: props.checked ? 2 : 1,
        }
      ]}>
        {props.checked && (
          <View style={[styles.checkboxInner, { backgroundColor: props.theme.primaryActionText }]} />
        )}
      </View>
      <Text style={[styles.toggleLabel, { color: props.theme.textMuted }]}>{props.label}</Text>
    </View>
  );
}

function TogglePreview(props: { label: string; on: boolean; theme: ThemeTokens }) {
  return (
    <View style={styles.togglePreviewWrap}>
      <View style={[styles.toggleTrack, { backgroundColor: props.on ? props.theme.toggleOnBackground : props.theme.toggleOffBackground }]}>
        <View style={[styles.toggleThumb, { backgroundColor: props.theme.toggleThumbColor, marginLeft: props.on ? 20 : 2 }]} />
      </View>
      <Text style={[styles.toggleLabel, { color: props.theme.textMuted }]}>{props.label}</Text>
    </View>
  );
}

function FeaturePreview(props: { feature: MapFeatureSpec; theme: ThemeTokens }) {
  const fill = props.theme[props.feature.fillKey];
  const stroke = props.theme[props.feature.strokeKey];
  const clipId = `feature-clip-${props.feature.key}`;
  return (
    <View style={styles.featurePreviewWrap}>
      <Svg width={188} height={90}>
        <Rect x={2} y={2} width={184} height={86} rx={10} fill={props.theme.mapBoundaryFill} stroke={props.theme.mapBoundaryStroke} strokeWidth={2} />
        {buildGridLines(2, 2, 184, 86, 30).map((line) => (
          <Line key={line.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={props.theme.gridLineColor} strokeWidth={1.5} />
        ))}
        {props.feature.preview === "tree" && (
          <Polygon
            points={buildSpikyPoints(94, 45, 21, 14, 0.72)}
            fill={fill}
            stroke={stroke}
            strokeWidth={3}
          />
        )}
        {props.feature.preview === "shrub" && (
          <Polygon
            points={buildSpikyPoints(94, 45, 20, 12, 0.8)}
            fill={fill}
            stroke={stroke}
            strokeWidth={3}
          />
        )}
        {props.feature.preview === "lawn" && (
          <G>
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={34} y={22} width={120} height={46} rx={8} />
              </ClipPath>
            </Defs>
            <Rect x={34} y={22} width={120} height={46} rx={8} fill={fill} stroke={stroke} strokeWidth={3} />
            <G clipPath={`url(#${clipId})`}>
              {[-24, -12, 0, 12, 24, 36, 48, 60, 72].map((offset) => (
                <Line key={`l-${offset}`} x1={36 + offset} y1={20} x2={66 + offset} y2={72} stroke={stroke} strokeWidth={1.6} opacity={0.7} />
              ))}
            </G>
          </G>
        )}
        {props.feature.preview === "deck" && (
          <G>
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={34} y={22} width={120} height={46} rx={8} />
              </ClipPath>
            </Defs>
            <Rect x={34} y={22} width={120} height={46} rx={8} fill={fill} stroke={stroke} strokeWidth={3} />
            <G clipPath={`url(#${clipId})`}>
              {[-24, -16, -8, 0, 8, 16, 24, 32, 40, 48, 56, 64, 72].map((offset) => (
                <Line key={`d-${offset}`} x1={36 + offset} y1={20} x2={66 + offset} y2={72} stroke={stroke} strokeWidth={1.2} opacity={0.75} />
              ))}
            </G>
          </G>
        )}
        {props.feature.preview === "rect" && <Rect x={34} y={22} width={120} height={46} rx={8} fill={fill} stroke={stroke} strokeWidth={3} />}
      </Svg>
    </View>
  );
}

function buildSpikyPoints(cx: number, cy: number, radius: number, outerSegments: number, spikeFactor: number): string {
  const points: string[] = [];
  const segments = outerSegments * 2;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const factor = i % 2 === 1 ? spikeFactor : 1;
    points.push(`${cx + Math.cos(angle) * radius * factor},${cy + Math.sin(angle) * radius * factor}`);
  }
  return points.join(" ");
}

function buildGridLines(x: number, y: number, width: number, height: number, step: number): Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> {
  const lines: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = x + step; i < x + width; i += step) {
    lines.push({ id: `v-${i}`, x1: i, y1: y, x2: i, y2: y + height });
  }
  for (let i = y + step; i < y + height; i += step) {
    lines.push({ id: `h-${i}`, x1: x, y1: i, x2: x + width, y2: i });
  }
  return lines;
}

function isPresetActive(theme: ThemeTokens, tokens: Partial<ThemeTokens>): boolean {
  const keys = Object.keys(tokens) as Array<keyof ThemeTokens>;
  if (keys.length === 0) return false;
  return keys.every((key) => theme[key] === tokens[key]);
}

function normalizeHex(input: string): string {
  const text = input.trim();
  const hex = text.replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}FF`;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.toUpperCase()}`;
  const rgb = toRgbHex(text);
  if (rgb) return `${rgb}FF`;
  return "#808080FF";
}

function toRgbHex(input: string): string | null {
  const text = input.trim();
  const hex = text.replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(0, 6).toUpperCase()}`;

  const rgbaMatch = text.match(/rgba?\(([^)]+)\)/i);
  if (!rgbaMatch) return null;
  const body = rgbaMatch[1];
  if (!body) return null;
  const parts = body.split(",").map((part) => part.trim());
  if (parts.length < 3) return null;
  const r = clampNumber(Number(parts[0]), 0, 255);
  const g = clampNumber(Number(parts[1]), 0, 255);
  const b = clampNumber(Number(parts[2]), 0, 255);
  if ([r, g, b].some((value) => Number.isNaN(value))) return null;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function getOpacityPercent(input: string): number {
  const hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    const alpha = parseInt(hex.slice(6, 8), 16);
    return Math.round((alpha / 255) * 100);
  }
  return 100;
}

function alphaHexFromPercent(percent: number): string {
  const clamped = clampNumber(percent, 0, 100);
  return Math.round((clamped / 100) * 255).toString(16).padStart(2, "0").toUpperCase();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  container: { padding: 16, paddingBottom: 120, gap: 12 },
  title: { fontSize: 26, fontWeight: "800" },
  subtitle: { marginTop: -2, fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  groupTitle: { fontSize: 15, fontWeight: "800" },
  presetRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  presetButton: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  presetButtonText: { fontSize: 12, fontWeight: "700" },
  previewRow: { flexDirection: "row", gap: 10, flexWrap: "wrap", alignItems: "center" },
  previewButton: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  previewButtonText: { fontWeight: "700", fontSize: 12 },
  previewChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  previewChipText: { fontWeight: "700", fontSize: 12 },
  previewFilter: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  previewFilterText: { fontWeight: "700", fontSize: 12 },
  togglePreviewWrap: { alignItems: "center", gap: 4 },
  toggleTrack: { width: 42, height: 24, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 2, justifyContent: "center" },
  toggleThumb: { width: 18, height: 18, borderRadius: 999 },
  toggleLabel: { fontSize: 11, fontWeight: "600" },
  checkboxBox: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  checkboxInner: { width: 12, height: 12, borderRadius: 2 },
  checkboxCheck: { fontSize: 14, fontWeight: "800" },
  modalPreviewWrap: { borderRadius: 12, padding: 10 },
  modalPreviewCard: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 8 },
  modalTitle: { fontWeight: "800", fontSize: 13 },
  activeHint: { fontSize: 12, fontWeight: "600" },
  resetAllButton: { borderWidth: 1, alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  resetText: { fontWeight: "700" },
  tokenBlock: { gap: 6 },
  tokenBlockCompact: { marginBottom: 4 },
  numberRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  numberValue: { minWidth: 34, textAlign: "center", fontWeight: "700" },
  tokenRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  tokenRowCompact: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  tokenLabel: { fontWeight: "700", fontSize: 12 },
  tokenRowActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  editSwatch: { width: 24, height: 24, borderRadius: 8, borderWidth: 2 },
  defaultCircle: { width: 24, height: 24, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  defaultCircleText: { fontSize: 10, fontWeight: "700" },
  inlinePicker: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 6 },
  pickerTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pickerSwatch: { width: 24, height: 24, borderRadius: 8, borderWidth: 1 },
  hexInput: { flex: 1, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: "700" },
  opacityRow: { gap: 4 },
  opacityLabel: { fontSize: 12, fontWeight: "700" },
  opacitySlider: { width: "100%", height: 24 },
  featureCard: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  featureTitle: { fontSize: 14, fontWeight: "800" },
  featurePreviewWrap: { alignItems: "center" },
});
