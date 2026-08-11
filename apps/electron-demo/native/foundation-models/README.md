# Foundation Models Addon

This directory contains the self-contained SwiftPM package skeleton for the Electron Foundation Models addon.

The package produces the dynamic library product `foundation_models` and targets macOS 26. The `NodeAPI` target includes the system Node-API header through a small wrapper. Set `NODE_INCLUDE` to override the Node header directory; local builds default to `/opt/homebrew/include/node`.

Run the core tests with:

```sh
swift test --package-path apps/electron-demo/native/foundation-models
```
