import { create } from "zustand";

type UIState = {
  selectedGardenId: string | null;
  setSelectedGardenId: (id: string | null) => void;
};

export const useUIStore = create<UIState>((set) => ({
  selectedGardenId: null,
  setSelectedGardenId: (id) => set({ selectedGardenId: id }),
}));
