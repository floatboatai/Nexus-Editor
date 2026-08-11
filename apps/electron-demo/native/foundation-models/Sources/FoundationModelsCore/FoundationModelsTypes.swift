import Foundation

public enum AvailabilityReason: String, Codable, Sendable {
    case unsupportedOS = "unsupported-os"
    case unsupportedArchitecture = "unsupported-architecture"
    case appleIntelligenceUnavailable = "apple-intelligence-unavailable"
    case modelUnavailable = "model-unavailable"
}

public struct AvailabilityResult: Codable, Equatable, Sendable {
    public let available: Bool
    public let reason: AvailabilityReason?

    public init(available: Bool, reason: AvailabilityReason?) {
        self.available = available
        self.reason = reason
    }
}

public enum SuggestionNormalization {
    private static let maxScalars = 160

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
        let oneSentence = firstSentence(in: collapsed)

        let scalars = Array(oneSentence.unicodeScalars)
        guard scalars.count > maxScalars else { return oneSentence }

        let prefix = String(String.UnicodeScalarView(scalars.prefix(maxScalars)))
        if let boundary = prefix.lastIndex(of: " ") {
            let shortened = String(prefix[..<boundary]).trimmingCharacters(in: .whitespacesAndNewlines)
            return shortened.isEmpty ? nil : shortened
        }
        return prefix
    }

    private static func firstSentence(in value: String) -> String {
        for index in value.indices {
            guard ".!?。！？".contains(value[index]) else { continue }
            let end = value.index(after: index)
            return String(value[..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return value
    }
}
