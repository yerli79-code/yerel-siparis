// Node's native type stripping does not add TypeScript extensions to ESM
// specifiers. Keep application imports compatible with Next.js while allowing
// the repository's node:test suites to run without adding a test dependency.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }

    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      throw error;
    }

    for (const extension of [".ts", ".tsx"]) {
      try {
        return await nextResolve(`${specifier}${extension}`, context);
      } catch {
        // Try the next TypeScript extension before surfacing the original error.
      }
    }

    throw error;
  }
}
