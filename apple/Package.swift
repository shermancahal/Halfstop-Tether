// swift-tools-version: 5.9
//
// Opening this file in Xcode gives you the probe as a real project — build,
// run, breakpoints, the debugger — with no .xcodeproj to hand-maintain and,
// more to the point, no paid developer account.
//
//     open Package.swift
//
// Then press Run. Xcode signs a local macOS tool with nothing but your Apple
// ID, or with no team at all.
//
import PackageDescription

let package = Package(
    name: "TetherProbe",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "TetherProbe",
            path: "Sources/TetherProbe"
        ),
        .executableTarget(
            name: "TetherApp",
            path: "Sources/TetherApp"
        ),
    ]
)
