import Foundation

public enum AvailabilityReason: String, Codable {
    case unsupportedOS = "unsupported-os"
    case unsupportedArchitecture = "unsupported-architecture"
    case appleIntelligenceUnavailable = "apple-intelligence-unavailable"
    case modelUnavailable = "model-unavailable"
}

public struct AvailabilityResult: Codable, Equatable {
    public let available: Bool
    public let reason: AvailabilityReason?

    public init(available: Bool, reason: AvailabilityReason?) {
        self.available = available
        self.reason = reason
    }
}

public enum SuggestionNormalization {
    public static func normalize(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        if value.hasPrefix("```") && value.hasSuffix("```") {
            value.removeFirst(3)
            value.removeLast(3)
            value = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if let firstNewline = value.firstIndex(where: { $0 == "\n" || $0 == "\r" }) {
                value = String(value[value.index(after: firstNewline)...])
            }
        }

        let collapsed = value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard !collapsed.isEmpty else { return nil }

        let scalars = Array(collapsed.unicodeScalars)
        guard scalars.count > 300 else { return collapsed }

        let prefix = String(String.UnicodeScalarView(scalars.prefix(300)))
        if let boundary = prefix.lastIndex(of: " ") {
            let shortened = String(prefix[..<boundary]).trimmingCharacters(in: .whitespacesAndNewlines)
            return shortened.isEmpty ? nil : shortened
        }
        return prefix
    }
}
