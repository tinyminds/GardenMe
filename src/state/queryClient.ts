import { QueryClient } from "@tanstack/react-query";

// Optimized query client configuration for better performance
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000, // 2 minutes - data stays fresh longer
      gcTime: 15 * 60 * 1000, // 15 minutes - cache lasts longer
      refetchOnWindowFocus: false, // Don't refetch when switching back to app
      refetchOnMount: true, // Still refetch when component mounts
      retry: 2, // Limit retries to avoid endless loading
    },
    mutations: {
      retry: 1, // Single retry for mutations
    },
  },
});
