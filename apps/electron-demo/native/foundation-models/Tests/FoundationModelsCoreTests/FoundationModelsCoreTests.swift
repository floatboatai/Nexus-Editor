import XCTest
@testable import FoundationModelsCore

final class FoundationModelsCoreTests: XCTestCase {
    func testPromptRequestsOnePlainTextNextSentence() {
        let prompt = CompletionPrompt.make(for: "Draft notes about native APIs.")

        XCTAssertTrue(prompt.contains("one short next sentence"))
        XCTAssertTrue(prompt.contains("plain text"))
        XCTAssertTrue(prompt.contains("Draft notes about native APIs."))
    }

    func testPromptUsesBoundedParagraphSuffix() {
        let longPrefix = String(repeating: "prefix ", count: 200)
        let suffix = "The final sentence should remain available."
        let prompt = CompletionPrompt.make(for: longPrefix + suffix)

        XCTAssertFalse(prompt.contains(longPrefix.trimmingCharacters(in: .whitespaces)))
        XCTAssertTrue(prompt.contains(suffix))
        XCTAssertLessThanOrEqual(prompt.unicodeScalars.count, 900)
    }

    func testUnavailableModelDoesNotProduceACompletion() async {
        let service = FoundationModelsService(modelProvider: .unavailable(.modelUnavailable))
        let suggestion = try? await service.suggest(for: "A paragraph.")

        XCTAssertNil(suggestion)
    }

    func testEmptyOrWhitespaceSuggestionBecomesNil() {
        XCTAssertNil(SuggestionNormalization.normalize(" \n  "))
    }

    func testSuggestionRemovesWrappingCodeFenceAndNewlines() {
        XCTAssertEqual(
            SuggestionNormalization.normalize("```\nA short sentence.\n```") ,
            "A short sentence."
        )
    }

    func testAvailabilityEncodesStableReasonValue() throws {
        let value = AvailabilityResult(available: false, reason: .unsupportedOS)
        let data = try JSONEncoder().encode(value)
        XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("unsupported-os"))
    }

    func testAppleSiliconWithoutFoundationModelsDoesNotReportUnsupportedArchitecture() async {
        #if os(macOS) && arch(arm64) && !canImport(FoundationModels)
        let availability = await FoundationModelsService().availability()

        XCTAssertFalse(availability.available)
        XCTAssertEqual(availability.reason, .modelUnavailable)
        #endif
    }

    func testSuggestionCollapsesLineBreaksToSpaces() {
        XCTAssertEqual(
            SuggestionNormalization.normalize("First\n\nsecond\r\nthird"),
            "First second third"
        )
    }

    func testSuggestionTruncatesAtWordBoundaryWithinThreeHundredScalars() {
        let raw = String(repeating: "word ", count: 70)
        let normalized = SuggestionNormalization.normalize(raw)

        XCTAssertNotNil(normalized)
        XCTAssertLessThanOrEqual(normalized!.unicodeScalars.count, 300)
        XCTAssertFalse(normalized!.hasSuffix(" "))
    }

    func testSuggestionKeepsOnlyOneShortSentence() {
        XCTAssertEqual(
            SuggestionNormalization.normalize("First sentence. Second sentence with extra explanation."),
            "First sentence."
        )
    }

    func testServiceExposesCancellationEntryPoint() async {
        let service = FoundationModelsService(modelProvider: .unavailable(.modelUnavailable))

        await service.cancelSuggestion()
    }
}
