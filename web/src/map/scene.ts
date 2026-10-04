import { create } from "zustand";

import type { Building, NearbyPoi, Walk } from "../lib/types";

/**
 * What the shared map shows. Views (officer, walker, demo) write here; MapStage
 * reads it and turns it into building colours, deck.gl layers and markers.
 */
export type ColorMode =
  /** officer: each surveyed building in its display-status colour */
  | "status"
  /** walker: the walker's own captures in one colour, never an AI status */
  | "captured"
  /** nothing highlighted: a quiet city */
  | "none";

export type Replay = { walkId: string; t: number };

export type SceneState = {
  buildings: Building[];
  colorMode: ColorMode;
  /** Demo: only these ids show their status yet; the rest show as captured. null = all. */
  revealed: Set<string> | null;
  /** Demo: only these ids are lit at all. null = all. */
  visibleIds: Set<string> | null;
  selectedId: string | null;
  hoverId: string | null;
  walks: Walk[];
  focusWalkId: string | null;
  replay: Replay | null;
  services: { buildingId: string; pois: NearbyPoi[] } | null;
  photoPins: boolean;
  onSelect: ((id: string) => void) | null;
  set: (partial: Partial<Omit<SceneState, "set" | "reset">>) => void;
  reset: () => void;
};

const empty = {
  buildings: [],
  colorMode: "none" as ColorMode,
  revealed: null,
  visibleIds: null,
  selectedId: null,
  hoverId: null,
  walks: [],
  focusWalkId: null,
  replay: null,
  services: null,
  photoPins: false,
  onSelect: null,
};

export const useScene = create<SceneState>((set) => ({
  ...empty,
  set: (partial) => set(partial),
  reset: () => set(empty),
}));

export const scene = {
  get: () => useScene.getState(),
  set: (partial: Partial<Omit<SceneState, "set" | "reset">>) => useScene.getState().set(partial),
};
