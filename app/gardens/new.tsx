import { router } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, TextInput, View } from "react-native";
import { SqliteGardenRepository } from "@/infra/repositories/sqlite/SqliteGardenRepository";
import type { Garden } from "@/domain/entities/Garden";
import { makeId } from "@/utils/id";
import { queryClient } from "@/state/queryClient";

const repository = new SqliteGardenRepository();

export default function NewGardenScreen() {
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
    <View style={styles.container}>
      <TextInput
        value={name}
        onChangeText={setName}
        style={styles.input}
        placeholder="Garden name"
      />
      <Button title="Save garden" onPress={onSave} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  input: { borderWidth: 1, borderColor: "#CEDBCB", borderRadius: 10, padding: 12 },
});
