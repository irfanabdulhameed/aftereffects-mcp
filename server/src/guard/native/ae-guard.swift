// ae-guard: a small macOS helper for the After Effects MCP guard.
//
//   ae-guard scan    --pid <pid>                       windows, front app, Accessibility view of dialogs
//   ae-guard dismiss --pid <pid> [--button <title>] [--allow-front]
//
// It never activates After Effects and never moves the mouse. "scan" only reads
// the window server and the Accessibility tree. "dismiss" presses an allowed
// button through Accessibility, or posts Escape to the After Effects process
// only (CGEventPostToPid), and refuses when After Effects is the front app
// unless --allow-front is given, because a dialog in front may be the human's.
//
// Output is one JSON object on stdout. Built by scripts/build-guard.js.

import Cocoa
import ApplicationServices

func arg(_ name: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
    return a[i + 1]
}

func flag(_ name: String) -> Bool { CommandLine.arguments.contains(name) }

func emit(_ obj: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
}

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func frontApp() -> [String: Any] {
    guard let f = NSWorkspace.shared.frontmostApplication else { return [:] }
    return ["pid": Int(f.processIdentifier), "name": f.localizedName ?? "", "bundle": f.bundleIdentifier ?? ""]
}

func cgWindows(_ pid: pid_t) -> [[String: Any]] {
    guard let raw = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { return [] }
    var out: [[String: Any]] = []
    for w in raw where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        out.append([
            "number": w[kCGWindowNumber as String] as? Int ?? 0,
            "layer": w[kCGWindowLayer as String] as? Int ?? 0,
            "name": w[kCGWindowName as String] as? String ?? "",
            "onscreen": (w[kCGWindowIsOnscreen as String] as? Bool) ?? false,
            "x": b["X"] as? Double ?? 0, "y": b["Y"] as? Double ?? 0,
            "w": b["Width"] as? Double ?? 0, "h": b["Height"] as? Double ?? 0,
        ])
    }
    return out
}

// Controls that make a dialog a form the human may be filling in (a lone checkbox such as
// "Don't show again" does not count).
let inputRoles = ["AXTextField", "AXComboBox", "AXPopUpButton", "AXSlider", "AXRadioButton", "AXIncrementor"]

/// Collects button titles, static texts and the number of input controls under a window, depth limited.
func collect(_ el: AXUIElement, depth: Int, buttons: inout [String], texts: inout [String], inputs: inout Int, pressables: inout [(String, AXUIElement)]) {
    if depth > 6 { return }
    let role = attr(el, kAXRoleAttribute) as? String ?? ""
    if inputRoles.contains(role) { inputs += 1 }
    if role == (kAXButtonRole as String) {
        let t = (attr(el, kAXTitleAttribute) as? String) ?? (attr(el, kAXDescriptionAttribute) as? String) ?? ""
        if !t.isEmpty { buttons.append(t); pressables.append((t, el)) }
    } else if role == (kAXStaticTextRole as String) || role == (kAXTextAreaRole as String) {
        if let v = attr(el, kAXValueAttribute) as? String, !v.isEmpty, texts.count < 12 {
            texts.append(String(v.prefix(400)))
        }
    }
    if let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] {
        for k in kids { collect(k, depth: depth + 1, buttons: &buttons, texts: &texts, inputs: &inputs, pressables: &pressables) }
    }
}

struct AxWindow {
    let el: AXUIElement
    let info: [String: Any]
    let isDialog: Bool
    let pressables: [(String, AXUIElement)]
}

func axWindows(_ pid: pid_t) -> [AxWindow] {
    let app = AXUIElementCreateApplication(pid)
    guard let wins = attr(app, kAXWindowsAttribute) as? [AXUIElement] else { return [] }
    var out: [AxWindow] = []
    for w in wins {
        let subrole = attr(w, kAXSubroleAttribute) as? String ?? ""
        let modal = (attr(w, kAXModalAttribute) as? Bool) ?? false
        let title = attr(w, kAXTitleAttribute) as? String ?? ""
        var buttons: [String] = [], texts: [String] = []
        var inputs = 0
        var pressables: [(String, AXUIElement)] = []
        let isDialog = modal || subrole == "AXDialog" || subrole == "AXSystemDialog"
        if isDialog { collect(w, depth: 0, buttons: &buttons, texts: &texts, inputs: &inputs, pressables: &pressables) }
        out.append(AxWindow(el: w, info: [
            "title": title, "subrole": subrole, "modal": modal, "dialog": isDialog, "buttons": buttons, "texts": texts, "inputs": inputs,
        ], isDialog: isDialog, pressables: pressables))
    }
    return out
}

// Buttons the guard must never press, whatever it is asked.
let blocked = ["reset", "safe mode", "disable", "don't save", "dont save", "delete", "quit", "remove", "replace", "revert", "discard", "trash"]

func isBlocked(_ title: String) -> Bool {
    let t = title.lowercased()
    return blocked.contains { t.contains($0) }
}

let cmd = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "scan"
guard let pidText = arg("--pid"), let pidNum = Int32(pidText) else {
    emit(["ok": false, "error": "usage: ae-guard scan|dismiss --pid <pid> [--button <title>] [--allow-front]"])
}
let pid = pid_t(pidNum)
let trusted = AXIsProcessTrusted()
let front = frontApp()
let aeIsFront = (front["pid"] as? Int) == Int(pid)

if cmd == "scan" {
    let ax = trusted ? axWindows(pid) : []
    emit([
        "ok": true, "pid": Int(pid), "trusted": trusted, "front": front, "aeIsFront": aeIsFront,
        "windows": cgWindows(pid), "ax": ax.map { $0.info }, "dialogs": ax.filter { $0.isDialog }.map { $0.info },
    ])
}

if cmd == "dismiss" {
    if aeIsFront && !flag("--allow-front") {
        emit(["ok": false, "reason": "ae-is-front", "message": "After Effects is the front app; a dialog there may be the human's. Not touching it.", "front": front])
    }
    let wanted = arg("--button")
    if let w = wanted, isBlocked(w) {
        emit(["ok": false, "reason": "blocked-button", "message": "Refusing to press '\(w)'."])
    }
    if trusted, let w = wanted {
        for win in axWindows(pid) where win.isDialog {
            if let p = win.pressables.first(where: { $0.0 == w }) {
                let err = AXUIElementPerformAction(p.1, kAXPressAction as CFString)
                let after = frontApp()
                emit(["ok": err == .success, "action": "press", "button": w, "dialog": win.info, "axError": err.rawValue,
                      "frontBefore": front, "frontAfter": after])
            }
        }
    }
    // No visible button by that title (or none asked for): Escape to AE only.
    let src = CGEventSource(stateID: .privateState)
    let down = CGEvent(keyboardEventSource: src, virtualKey: 53, keyDown: true)
    let up = CGEvent(keyboardEventSource: src, virtualKey: 53, keyDown: false)
    down?.postToPid(pid)
    up?.postToPid(pid)
    let after = frontApp()
    emit(["ok": true, "action": "escape", "requestedButton": wanted ?? NSNull(), "frontBefore": front, "frontAfter": after])
}

emit(["ok": false, "error": "unknown command \(cmd)"])
