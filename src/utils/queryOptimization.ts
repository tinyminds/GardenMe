import { queryClient } from "@/state/queryClient";

/**
 * Optimized query invalidation helpers to avoid unnecessary refetches
 */

type InvalidationTarget = 
  | "beds"
  | "garden-grow-list" 
  | "garden-plantings"
  | "garden-features"
  | "garden"
  | "companion-relations"
  | "plant-catalog"
  | "bed-photo-log-settings"
  | "garden-bed-planner-settings";

/**
 * Invalidate specific queries for a garden with proper targeting
 */
export async function invalidateGardenQueries(
  gardenId: string, 
  targets: InvalidationTarget[]
): Promise<void> {
  const invalidations = targets.map(target => {
    if (target === "companion-relations" || target === "bed-photo-log-settings" || target === "garden-bed-planner-settings") {
      // Global queries without gardenId
      return queryClient.invalidateQueries({ 
        queryKey: [target], 
        exact: true 
      });
    } else {
      // Garden-specific queries
      return queryClient.invalidateQueries({ 
        queryKey: [target, gardenId], 
        exact: true 
      });
    }
  });

  await Promise.all(invalidations);
}

/**
 * Common invalidation patterns for frequent operations
 */
export const QueryInvalidationPatterns = {
  // When a plant is added/removed from grow list
  growListChange: (gardenId: string) => 
    invalidateGardenQueries(gardenId, ["garden-grow-list"]),
  
  // When a plant is marked as planted/finished
  plantingStatusChange: (gardenId: string) => 
    invalidateGardenQueries(gardenId, ["garden-grow-list", "garden-plantings"]),
  
  // When bed assignments change
  bedPlanningChange: (gardenId: string) => 
    invalidateGardenQueries(gardenId, ["garden-grow-list", "beds"]),
  
  // When garden design changes (beds/features added/removed)
  gardenDesignChange: (gardenId: string) => 
    invalidateGardenQueries(gardenId, ["beds", "garden-features", "garden"]),
  
  // When only bed properties change (not structure)
  bedPropertiesChange: (gardenId: string) => 
    invalidateGardenQueries(gardenId, ["beds"]),
  
  // When garden settings change
  gardenSettingsChange: (gardenId: string) => 
    invalidateGardenQueries(gardenId, ["garden"]),
};

/**
 * Query configuration with optimized stale times and cache durations
 */
export const QueryConfig = {
  // Fast-changing data (user interactions)
  userInteractions: {
    staleTime: 30 * 1000, // 30 seconds
    cacheTime: 5 * 60 * 1000, // 5 minutes
  },
  
  // Medium-changing data (garden state)
  gardenData: {
    staleTime: 2 * 60 * 1000, // 2 minutes
    cacheTime: 15 * 60 * 1000, // 15 minutes
  },
  
  // Slow-changing data (plant catalog, companions)
  staticData: {
    staleTime: 10 * 60 * 1000, // 10 minutes
    cacheTime: 60 * 60 * 1000, // 1 hour
  },
  
  // Settings and preferences
  settings: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 30 * 60 * 1000, // 30 minutes
  },
};