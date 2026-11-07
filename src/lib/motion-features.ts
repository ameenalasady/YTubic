// Loaded through a dynamic import by <LazyMotion> in main.tsx, so the
// animation engine lands in its own chunk instead of the startup bundle.
// domMax (not domAnimation) because the pills and tabs use layoutId.
export { domMax as default } from "motion/react";
