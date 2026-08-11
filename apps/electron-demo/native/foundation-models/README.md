# Foundation Models Addon

This directory contains the self-contained SwiftPM package for the Electron Foundation Models addon.

The package produces the dynamic library product `foundation_models` and targets macOS 26 on Apple Silicon. `Sources/NodeAddon/Addon.swift` registers a small pure Swift Node-API module that exports:

- `getAvailability(): Promise<{ available: boolean; platform: "macos"; minimumOS: "26.0"; reason?: string }>`
- `suggest(input: string): Promise<string | null>`
- `cancelSuggestion(): void`
- `dispose(): void`

The `NodeAPI` target includes the system Node-API header through a small wrapper. Set `NODE_INCLUDE` to the directory that contains `node_api.h` before invoking `build.sh` or SwiftPM directly:

```sh
export NODE_INCLUDE="$(node -p 'const path=require(\"node:path\"); path.join(path.dirname(process.execPath), \"..\", \"include\", \"node\")')"
```

`Package.swift` does not guess a fallback path; this keeps the build reproducible on machines where Node is not installed via Homebrew.

Run the core tests with:

```sh
swift test --package-path apps/electron-demo/native/foundation-models
```

Build the native addon with:

```sh
apps/electron-demo/native/foundation-models/build.sh
```

On non-darwin or non-Apple-Silicon hosts, the script prints a skip message and exits successfully. On supported hosts it writes `build/Release/foundation_models.node` and copies it to `apps/electron-demo/dist-electron/native/foundation_models.node`.
The build script uses temporary SwiftPM cache directories under the system temp folder so it can run in restricted environments without writing to the user cache.

After a successful build, run the native smoke test with:

```sh
node apps/electron-demo/native/foundation-models/smoke-test.mjs
```
