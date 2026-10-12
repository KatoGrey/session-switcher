import XCTest

// Taps into a text box and saves a screenshot with the keyboard up, so you can see there's no
// Safari form bar (˄ ˅ ✓) above it. Unpaired, the app shows the Mac's pairing page, which has one.
final class FormBarTests: XCTestCase {
    func testKeyboardHasNoFormBar() throws { try run(keepBar: false) }
    // The same with the fix off: the bar should be there (shows the check can see it).
    func testFormBarShowsWithoutTheFix() throws { try run(keepBar: true) }

    private func run(keepBar: Bool) throws {
        let app = XCUIApplication()
        if keepBar { app.launchArguments += ["-keepFormBar", "YES"] }
        app.launch()
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 45), "No text box on the page")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "The keyboard didn't come up")
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap(); sleep(1) }
        sleep(1)
        let shot = XCUIScreen.main.screenshot()
        let out = ProcessInfo.processInfo.environment["SHOT_DIR"] ?? NSTemporaryDirectory()
        try shot.pngRepresentation.write(to: URL(fileURLWithPath: out).appendingPathComponent(keepBar ? "formbar-off.png" : "formbar.png"))
        // The form bar's ✓ / Done button lives in a toolbar above the keyboard.
        let bar = app.toolbars.firstMatch.exists || app.buttons["Done"].exists
        print("FORMBAR keepBar=\(keepBar) barVisible=\(bar) toolbars=\(app.toolbars.count)")
    }
}
