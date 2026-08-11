// swift-tools-version: 6.2

import Foundation
import PackageDescription

let nodeInclude = ProcessInfo.processInfo.environment["NODE_INCLUDE"] ?? "/opt/homebrew/include/node"

let package = Package(
    name: "FoundationModelsAddon",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "foundation_models", type: .dynamic, targets: ["FoundationModelsCore"])
    ],
    targets: [
        .target(
            name: "NodeAPI",
            path: "Sources/NodeAPI",
            publicHeadersPath: "include",
            cSettings: [.unsafeFlags(["-I", nodeInclude])]
        ),
        .target(
            name: "FoundationModelsCore",
            dependencies: ["NodeAPI"],
            path: "Sources/FoundationModelsCore"
        ),
        .testTarget(
            name: "FoundationModelsCoreTests",
            dependencies: ["FoundationModelsCore"],
            path: "Tests/FoundationModelsCoreTests"
        )
    ]
)
