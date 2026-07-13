import { ViteReactSSG } from "vite-react-ssg/single-page";
import App from "./App";
import "./index.css";

// Single-page SSG: the whole site is pre-rendered to static HTML at build time
// (great for SEO and first paint), then hydrated for the interactive checker.
export const createRoot = ViteReactSSG(<App />);
