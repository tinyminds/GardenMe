import { create } from "zustand";

type SelectedGardenState = {
  selectedGardenId: string | null;
  setSelectedGardenId: (gardenId: string | null) => void;
};

export const useSelectedGardenStore = create<SelectedGardenState>((set) => ({
  selectedGardenId: null,
  setSelectedGardenId: (gardenId) =>
    set((state) => {
      if (state.selectedGardenId === gardenId) return state;
      return { selectedGardenId: gardenId };
    }),
}));
