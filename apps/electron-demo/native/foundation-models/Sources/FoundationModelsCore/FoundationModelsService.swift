import Foundation

#if os(macOS) && arch(arm64) && canImport(FoundationModels)
import FoundationModels
#endif

internal enum CompletionPrompt {
    private static let maxContextScalars = 700

    static func make(for paragraph: String) -> String {
        let bounded = boundedContext(paragraph)
        return """
        Continue with one short next sentence in plain text.

        Current paragraph suffix:
        \(bounded)
        """
    }

    private static func boundedContext(_ paragraph: String) -> String {
        let scalars = Array(paragraph.unicodeScalars)
        guard scalars.count > maxContextScalars else {
            return paragraph
        }

        let suffix = String(String.UnicodeScalarView(scalars.suffix(maxContextScalars)))
        if let boundary = suffix.firstIndex(where: { $0.isWhitespace }) {
            let bounded = String(suffix[suffix.index(after: boundary)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !bounded.isEmpty {
                return bounded
            }
        }
        return suffix
    }
}

internal enum ModelProvider: Sendable {
    case system
    case unavailable(AvailabilityReason)
}

public actor FoundationModelsService {
    private let modelProvider: ModelProvider

    #if os(macOS) && arch(arm64) && canImport(FoundationModels)
    @available(macOS 26.0, *)
    private var session: LanguageModelSession?
    @available(macOS 26.0, *)
    private var generationTask: Task<String?, Never>?
    #endif

    public init() {
        self.modelProvider = .system
    }

    internal init(modelProvider: ModelProvider) {
        self.modelProvider = modelProvider
    }

    public func availability() -> AvailabilityResult {
        switch modelProvider {
        case .unavailable(let reason):
            return AvailabilityResult(available: false, reason: reason)
        case .system:
            return systemAvailability()
        }
    }

    public func suggest(for paragraph: String) async throws -> String? {
        guard availability().available else { return nil }

        #if os(macOS) && arch(arm64) && canImport(FoundationModels)
        guard #available(macOS 26.0, *) else { return nil }

        cancelSuggestion()
        let session = session ?? LanguageModelSession(
            model: .default,
            instructions: """
            Provide concise inline text completions. Continue only the supplied paragraph suffix.
            Return one short next sentence as plain text, without explanations, quotation marks,
            Markdown syntax, or multiple alternatives.
            """
        )
        self.session = session

        let prompt = CompletionPrompt.make(for: paragraph)
        let task = Task<String?, Never> { [session] in
            guard !Task.isCancelled else { return nil }

            do {
                let response = try await session.respond(to: prompt)
                guard !Task.isCancelled else { return nil }
                return SuggestionNormalization.normalize(response.content)
            } catch {
                return nil
            }
        }
        generationTask = task
        return await task.value
        #else
        return nil
        #endif
    }

    public func cancelSuggestion() {
        #if os(macOS) && arch(arm64) && canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            generationTask?.cancel()
            generationTask = nil
        }
        #endif
    }

    public func dispose() {
        #if os(macOS) && arch(arm64) && canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            cancelSuggestion()
            session = nil
        }
        #endif
    }

    private func systemAvailability() -> AvailabilityResult {
        #if os(macOS) && arch(arm64) && canImport(FoundationModels)
        guard #available(macOS 26.0, *) else {
            return AvailabilityResult(available: false, reason: .unsupportedOS)
        }

        switch SystemLanguageModel.default.availability {
        case .available:
            return AvailabilityResult(available: true, reason: nil)
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible, .appleIntelligenceNotEnabled:
                return AvailabilityResult(available: false, reason: .appleIntelligenceUnavailable)
            case .modelNotReady:
                return AvailabilityResult(available: false, reason: .modelUnavailable)
            @unknown default:
                return AvailabilityResult(available: false, reason: .modelUnavailable)
            }
        }
        #elseif os(macOS)
        #if arch(arm64)
        return AvailabilityResult(available: false, reason: .modelUnavailable)
        #else
        return AvailabilityResult(available: false, reason: .unsupportedArchitecture)
        #endif
        #else
        return AvailabilityResult(available: false, reason: .unsupportedOS)
        #endif
    }
}
