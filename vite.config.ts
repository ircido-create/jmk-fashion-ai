import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { seoPlugin } from "./vite-plugin-seo";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // O plugin de SEO lê o catálogo público no fim do build, para escrever o
  // sitemap e a prévia de cada peça. São as mesmas variáveis que o app usa —
  // loadEnv porque process.env não enxerga o .env sozinho.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [
      react(),
      seoPlugin({
        supabaseUrl: env.VITE_SUPABASE_URL,
        supabaseKey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  };
});
