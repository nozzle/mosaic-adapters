import { defineConfig, mergeConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { tanstackViteConfig } from "@tanstack/config/vite";

const packageConfig = defineConfig({
	plugins: [svelte()],
});

export default mergeConfig(
	packageConfig,
	tanstackViteConfig({
		cjs: false,
		entry: ["src/index.ts"],
		srcDir: "./src",
	})
);
