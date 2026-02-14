import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useTheme } from "@/ui/theme/ThemeProvider";
import { AppButton } from "./AppButton";

/**
 * Skeleton loading component for list items
 */
export function SkeletonLoader({ count = 3 }: { count?: number }) {
  const { theme } = useTheme();
  
  return (
    <View style={styles.skeletonContainer}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[
            styles.skeletonCard,
            {
              backgroundColor: theme.surfaceBackground,
              borderColor: theme.borderColor,
            },
          ]}
        >
          <View style={[styles.skeletonBar, styles.skeletonTitle, { backgroundColor: theme.chipBackground }]} />
          <View style={[styles.skeletonBar, styles.skeletonText, { backgroundColor: theme.chipBackground }]} />
          <View style={[styles.skeletonBar, styles.skeletonText, { backgroundColor: theme.chipBackground, width: '60%' }]} />
        </View>
      ))}
    </View>
  );
}

/**
 * Loading indicator with optional text
 */
export function LoadingIndicator({ 
  text = "Loading...", 
  size = "small" 
}: { 
  text?: string; 
  size?: "small" | "large";
}) {
  const { theme } = useTheme();
  
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size={size} color={theme.primaryActionBackground} />
      <Text style={[styles.loadingText, { color: theme.textMuted }]}>{text}</Text>
    </View>
  );
}

/**
 * Reusable empty state component
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { theme } = useTheme();
  
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>{subtitle}</Text>
      {actionLabel && onAction && (
        <AppButton
          label={actionLabel}
          variant="primary"
          onPress={onAction}
          style={styles.emptyAction}
        />
      )}
    </View>
  );
}

/**
 * Empty state variants for common scenarios
 */
export const EmptyStateVariants = {
  Beds: ({ onAction }: { onAction?: () => void }) => (
    <EmptyState
      icon="🏡"
      title="No beds yet"
      subtitle="Create beds in Garden Design to start planning what to grow where."
      {...(onAction && { actionLabel: "Design Garden", onAction })}
    />
  ),
  
  Plants: ({ onAction }: { onAction?: () => void }) => (
    <EmptyState
      icon="🌱"
      title="No plants yet"
      subtitle="Add plants to your grow list to get personalized bed suggestions."
      {...(onAction && { actionLabel: "Browse Plants", onAction })}
    />
  ),
  
  Photos: ({ onAction }: { onAction?: () => void }) => (
    <EmptyState
      icon="📸"
      title="No photos yet"
      subtitle="Take photos to document your bed progress over time."
      {...(onAction && { actionLabel: "Take Photo", onAction })}
    />
  ),
  
  Suggestions: () => (
    <EmptyState
      icon="💡"
      title="No suggestions"
      subtitle="Add more crops to your grow list to get planting recommendations."
    />
  ),
  
  Gardens: ({ onAction }: { onAction?: () => void }) => (
    <EmptyState
      icon="🌿"
      title="No gardens yet"
      subtitle="Create your first garden to start planning and tracking your plants."
      {...(onAction && { actionLabel: "Create Garden", onAction })}
    />
  ),
  
  History: () => (
    <EmptyState
      icon="📅"
      title="No history yet"
      subtitle="Plant and harvest data will appear here as you use your beds."
    />
  ),
};

/**
 * Error state component
 */
export function ErrorState({
  title = "Something went wrong",
  subtitle = "Please try again in a moment.",
  onRetry,
}: {
  title?: string;
  subtitle?: string;
  onRetry?: () => void;
}) {
  const { theme } = useTheme();
  
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>⚠️</Text>
      <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>{subtitle}</Text>
      {onRetry && (
        <AppButton
          label="Try Again"
          variant="secondary"
          onPress={onRetry}
          style={styles.emptyAction}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Skeleton styles
  skeletonContainer: {
    gap: 12,
  },
  skeletonCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    gap: 8,
  },
  skeletonBar: {
    height: 16,
    borderRadius: 8,
    opacity: 0.6,
  },
  skeletonTitle: {
    height: 20,
    width: '80%',
  },
  skeletonText: {
    height: 14,
    width: '100%',
  },
  
  // Loading styles
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "500",
  },
  
  // Empty state styles
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 280,
  },
  emptyAction: {
    marginTop: 8,
  },
});