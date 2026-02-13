import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import type { Garden } from "@/domain/entities/Garden";
import { makeId } from "@/utils/id";
import { queryClient } from "@/state/queryClient";
import { useTheme } from "@/ui/theme/ThemeProvider";

const repository = new SqliteGardenRepository();

export default function NewGardenScreen() {
  const { theme } = useTheme();
  const [name, setName] = useState("");

  const onSave = async () => {
    if (!name.trim()) return;

    const now = new Date().toISOString();
    const id = makeId("garden");
    const garden: Garden = {
      id,
      name: name.trim(),
      latitude: 0,
      longitude: 0,
      createdAt: now,
      updatedAt: now,
    };

    await repository.create(garden);
    await queryClient.invalidateQueries({ queryKey: ["gardens"] });
    router.replace(`/gardens/${id}/setup`);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.appBackground }]}>
      <TextInput
        value={name}
        onChangeText={setName}
        style={[
          styles.input,
          {
            borderColor: theme.borderColor,
            backgroundColor: theme.surfaceBackground,
            color: theme.textPrimary,
          },
        ]}
        placeholder="Garden name"
        placeholderTextColor={theme.textMuted}
      />
      <Pressable
        disabled={!name.trim()}
        onPress={() => void onSave()}
        style={[
          styles.button,
          {
            backgroundColor: name.trim() ? theme.secondaryActionBackground : theme.disabledActionBackground,
            borderColor: name.trim() ? theme.borderColor : theme.disabledActionBackground,
          },
        ]}
      >
        <Text style={[styles.buttonText, { color: name.trim() ? theme.secondaryActionText : theme.disabledActionText }]}>
          Save garden
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  input: { borderWidth: 1, borderRadius: 10, padding: 12 },
  button: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, alignItems: "center" },
  buttonText: { fontWeight: "700" },
});

