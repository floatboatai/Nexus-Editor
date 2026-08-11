// swift-tools-version: 6.2

import Foundation
import PackageDescription

func requireNodeInclude() -> String {
    let value = ProcessInfo.processInfo.environment["NODE_INCLUDE"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !value.isEmpty else {
        fatalError("NODE_INCLUDE must point to the directory that contains node_api.h")
    }
    return value
}

let nodeInclude = requireNodeInclude()

let package = Package(
    name: "FoundationModelsAddon",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "foundation_models", type: .dynamic, targets: ["NodeAddon"])
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
            dependencies: [],
            path: "Sources/FoundationModelsCore"
        ),
        .target(
            name: "NodeAddon",
            dependencies: ["FoundationModelsCore", "NodeAPI"],
            path: "Sources/NodeAddon",
            swiftSettings: [.unsafeFlags(["-I", nodeInclude])],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup"])
            ]
        ),
        .testTarget(
            name: "FoundationModelsCoreTests",
            dependencies: ["FoundationModelsCore"],
            path: "Tests/FoundationModelsCoreTests"
        )
    ]
)
