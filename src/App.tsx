import { RouterProvider, createRouter } from "@tanstack/react-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ThemeProvider } from "next-themes";
import {
  PERSIST_MAX_AGE,
  fitsInPersistBudget,
  persister,
  queryClient,
  shouldPersistQuery,
} from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { isFloatingPlayerWindow } from "@/lib/floating-player";
import FloatingPlayerApp from "@/components/layout/floating-player-app";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  context: { queryClient },
  // Remember scroll position per history entry and restore it on
  // back/forward. The app scrolls a single custom <main> (not the
  // window), so point the "scroll to top on a fresh navigation" logic
  // at it by its data-scroll-restoration-id.
  scrollRestoration: true,
  scrollToTopSelectors: ['[data-scroll-restoration-id="main-scroll"]'],
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  // The same Vite bundle is loaded in both windows; the standalone
  // floating player skips routing/shell entirely.
  if (isFloatingPlayerWindow()) {
    return <FloatingPlayerApp />;
  }
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      storageKey="ytm-theme"
      disableTransitionOnChange
    >
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE,
          dehydrateOptions: {
            shouldDehydrateQuery: (q) =>
              q.state.status === "success" &&
              shouldPersistQuery(q.queryKey) &&
              fitsInPersistBudget(q.state.data),
          },
        }}
      >
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </ThemeProvider>
  );
}
