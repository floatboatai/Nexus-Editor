import XCTest
@testable import FoundationModelsCore

final class FoundationModelsCoreTests: XCTestCase {
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
}
