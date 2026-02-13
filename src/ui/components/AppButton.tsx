import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { getControlShape } from "@/ui/theme/controlTokens";

type AppButtonVariant = "primary" | "secondary" | "danger" | "neutral";
type AppButtonSize = "sm" | "md";

type AppButtonProps = {
  label: string;
  onPress: () => void;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function AppButton(props: AppButtonProps) {
  const { theme } = useTheme();
  const variant = props.variant ?? "secondary";
  const size = props.size ?? "md";
  const disabled = Boolean(props.disabled);
  const shape = getControlShape(theme);

  const palette =
    variant === "primary"
      ? {
          backgroundColor: theme.primaryActionBackground,
          textColor: theme.primaryActionText,
          borderColor: theme.borderColor,
        }
      : variant === "danger"
        ? {
            backgroundColor: theme.dangerActionBackground,
            textColor: theme.dangerActionText,
            borderColor: theme.borderColor,
          }
        : variant === "neutral"
          ? {
              backgroundColor: theme.appBackground,
              textColor: theme.textPrimary,
              borderColor: theme.borderColor,
            }
          : {
              backgroundColor: theme.secondaryActionBackground,
              textColor: theme.secondaryActionText,
              borderColor: theme.borderColor,
            };

  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      style={[
        styles.button,
        size === "sm" ? styles.small : styles.medium,
        {
          borderWidth: shape.borderWidth,
          borderRadius: shape.buttonRadius,
          backgroundColor: disabled ? theme.disabledActionBackground : palette.backgroundColor,
          borderColor: disabled ? theme.disabledActionBackground : palette.borderColor,
          opacity: disabled ? 0.7 : 1,
        },
        props.style,
      ]}
    >
      <Text
        style={[
          styles.text,
          size === "sm" ? styles.smallText : styles.mediumText,
          { color: disabled ? theme.disabledActionText : palette.textColor },
          props.textStyle,
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  medium: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  small: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  text: {
    fontWeight: "700",
  },
  mediumText: {
    fontSize: 13,
  },
  smallText: {
    fontSize: 12,
  },
});
