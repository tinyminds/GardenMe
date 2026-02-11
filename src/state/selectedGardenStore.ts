import { create } from "zustand";

type SelectedGardenState = {
  selectedGardenId: string | null;
  setSelectedGardenId: (gardenId: string | null) => void;
};

export const useSelectedGardenStore = create<SelectedGardenState>((set) => ({
  selectedGardenId: null,
  setSelectedGardenId: (gardenId) => set({ selectedGardenId: gardenId }),
}));

