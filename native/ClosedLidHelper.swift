import Foundation
import Darwin
import IOKit
import IOKit.ps

// Staged optional backend. There is deliberately no sudo, shell, PAM edit,
// download, or user-writable dependency in the installed execution path.
// disablesleep is a GLOBAL sleep kill switch; emergency sleep is NOT preserved.
// Its boolean value cannot reveal another app's same-value writes. The caller
// must obtain an explicit exclusive-use acknowledgement before install-start.
private enum Paths {
    static let label = "com.dreameater.closedlid"
    static let executable = "/Library/PrivilegedHelperTools/\(label)"
    static let daemon = "/Library/LaunchDaemons/\(label).plist"
    // Canonical /private paths avoid following the system /var symlink.
    static let directory = "/private/var/db/\(label)"
    static let journal = "\(directory)/journal.json"
    static let lock = "\(directory)/lock"
    static let summary = "/Library/PrivilegedHelperTools/\(label).status.json"
}

private struct Failure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

// Release eligibility governs creation of new leases only. Existing sessions
// must retain inspect/stop/guard/uninstall access after an OS downgrade or when
// hardware identification becomes unavailable. Never call this at process entry
// or from a recovery path.
private func startEligibilityFailure(nativeARM64: Bool, appleSilicon: Bool?, macOSMajorVersion: Int) -> String? {
    guard nativeARM64, appleSilicon != false else {
        return "Starting closed-lid mode requires the native Apple Silicon helper. Inspection and recovery remain available."
    }
    guard appleSilicon == true else {
        return "Apple Silicon hardware could not be verified. New sessions are disabled; inspection and recovery remain available."
    }
    guard macOSMajorVersion >= 26 else {
        return "Starting closed-lid mode requires macOS 26 or later. Inspection and recovery remain available."
    }
    return nil
}

private func requireSupportedStartEnvironment() throws {
    #if arch(arm64)
    let nativeARM64 = true
    #else
    let nativeARM64 = false
    #endif
    var arm64: Int32 = 0
    var size = MemoryLayout<Int32>.size
    let result = sysctlbyname("hw.optional.arm64", &arm64, &size, nil, 0)
    let appleSilicon: Bool? = result == 0 && size == MemoryLayout<Int32>.size && (arm64 == 0 || arm64 == 1)
        ? arm64 == 1 : nil
    if let message = startEligibilityFailure(nativeARM64: nativeARM64, appleSilicon: appleSilicon,
                                              macOSMajorVersion: ProcessInfo.processInfo.operatingSystemVersion.majorVersion) {
        throw Failure(message)
    }
}

private enum Phase: String, Codable {
    case preparing, ready, enabling, active, restoring, recovery, conflict, retired
}

private struct Journal: Codable {
    var version = 1
    var requestID: String
    var ownerUID: UInt32
    var boot: String
    var deadline: UInt64
    var expiresAt: Double
    var installerPID: Int32
    var preparationDeadline: UInt64
    var guardPID: Int32? = nil
    var guardSeen = false
    var phase: Phase = .preparing
    // Written durably BEFORE any command that could set disablesleep=1.
    var ownsMutation = false
    var originalValue = 0
    var exclusiveUseAcknowledged = true
    var message = "Waiting for the recovery watchdog."
}

private struct Observation {
    let persisted: Int?
    let live: Int?
    // Diagnostic only: power source never restricts an otherwise valid lease.
    let ac: Bool?
    var thermalSafe = true
    var isOff: Bool { persisted == 0 && live == 0 }
    var isOn: Bool { persisted == 1 && live == 1 }
    var anyOff: Bool { persisted == 0 || live == 0 }
    var verifiedValue: Int? { persisted == live ? persisted : nil }
}

private struct Status: Codable {
    var state: String
    var message: String
    var expiresAt: Double?
    var sleepDisabled: Int?
    var acPower: Bool?
    var requestId: String?
    var installed: Bool
    var boot: String?
    var sampledAt: UInt64?
    var deadline: UInt64?

    private enum CodingKeys: String, CodingKey {
        case state, message, expiresAt, sleepDisabled, acPower, requestId, installed, boot, sampledAt, deadline
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(state, forKey: .state); try values.encode(message, forKey: .message)
        try values.encode(installed, forKey: .installed)
        // Required wire fields are explicit null, never absent.
        try values.encode(expiresAt, forKey: .expiresAt); try values.encode(sleepDisabled, forKey: .sleepDisabled)
        try values.encode(acPower, forKey: .acPower); try values.encode(requestId, forKey: .requestId)
        try values.encode(boot, forKey: .boot); try values.encode(sampledAt, forKey: .sampledAt)
        try values.encode(deadline, forKey: .deadline)
    }
}

private enum Trigger { case firstLaunch, tick, stop, termination }
private enum Decision: Equatable { case acknowledge, wait, restore, retire, relinquish, retainConflict }

// The real guard and the inert test use this same transition reducer.
private func decide(_ record: Journal, _ observed: Observation, boot: String,
                    now: UInt64, trigger: Trigger, installerAlive: Bool) -> Decision {
    if record.phase == .conflict { return observed.isOff ? .retire : .retainConflict }
    if record.ownsMutation {
        // An external zero ends our ownership. Never reapply 1 or overwrite a
        // later actor's preferences. A mixed/unknown result keeps the journal.
        if observed.anyOff && record.phase == .active { return .relinquish }
        if observed.isOff { return .retire }
        if trigger == .firstLaunch || trigger == .stop || trigger == .termination { return .restore }
        if boot != record.boot || now >= record.deadline || !observed.thermalSafe { return .restore }
        if record.phase != .active || !observed.isOn { return .restore }
        return .wait
    }
    if !observed.isOff { return .relinquish }
    if trigger == .firstLaunch && !record.guardSeen && record.phase == .preparing
        && boot == record.boot && now < record.preparationDeadline
        && now < record.deadline && observed.thermalSafe && installerAlive {
        return .acknowledge
    }
    if trigger == .tick && (record.phase == .preparing || record.phase == .ready)
        && boot == record.boot && now < record.preparationDeadline
        && now < record.deadline && observed.thermalSafe && installerAlive { return .wait }
    return .retire
}

private func mayReclaimPreparation(_ record: Journal, observed: Observation, boot: String,
                                   now: UInt64, installerAlive: Bool) -> Bool {
    !record.ownsMutation && (record.phase == .preparing || record.phase == .ready)
        && observed.isOff && (boot != record.boot || now >= record.preparationDeadline || !installerAlive)
}
private func mayUninstall(journalPresent: Bool, observed: Observation) -> Bool {
    !journalPresent && observed.isOff
}

private func continuousNow() -> UInt64 { mach_continuous_time() }
private func ticks(_ seconds: Double) -> UInt64 {
    var info = mach_timebase_info_data_t()
    mach_timebase_info(&info)
    return UInt64(seconds * 1_000_000_000 * Double(info.denom) / Double(info.numer))
}
private func auditWait(deadline: UInt64?, now: UInt64, preparing: Bool) -> Double {
    if let deadline {
        return deadline > now ? min(2, Double(deadline - now) / Double(ticks(1))) : 0.001
    }
    return preparing ? 0.1 : 2
}
private func bootIdentifier() throws -> String {
    var size = 0
    guard sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 1, size < 256 else {
        throw Failure("Cannot determine the current boot identity.")
    }
    var bytes = [CChar](repeating: 0, count: size)
    guard sysctlbyname("kern.bootsessionuuid", &bytes, &size, nil, 0) == 0 else {
        throw Failure("Cannot read the current boot identity.")
    }
    return String(cString: bytes)
}

private func validateID(_ value: String) -> Bool {
    value.range(of: "^[A-Za-z0-9_-]{16,128}$", options: .regularExpression) != nil
}
private func emit(_ status: Status) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    if let bytes = try? encoder.encode(status) {
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
    }
}

private func metadata(_ path: String) throws -> stat {
    var value = stat()
    guard lstat(path, &value) == 0 else { throw Failure("Cannot inspect trusted path: \(path).") }
    return value
}
private func exists(_ path: String) -> Bool {
    var value = stat()
    return lstat(path, &value) == 0
}
private func noExtendedACL(_ path: String) throws {
    guard let acl = acl_get_file(path, ACL_TYPE_EXTENDED) else {
        if errno == ENOENT || errno == ENOTSUP { return }
        throw Failure("Cannot inspect access controls: \(path).")
    }
    defer { acl_free(UnsafeMutableRawPointer(acl)) }
    var entry: acl_entry_t? = nil
    let result = acl_get_entry(acl, Int32(ACL_FIRST_ENTRY.rawValue), &entry)
    guard result == -1 && errno == EINVAL else {
        throw Failure("Extended access controls are not accepted on trusted paths: \(path).")
    }
}
private func trusted(_ path: String, directory: Bool, exactMode: mode_t? = nil) throws {
    let s = try metadata(path)
    let expected = directory ? mode_t(S_IFDIR) : mode_t(S_IFREG)
    guard s.st_mode & S_IFMT == expected, s.st_uid == 0, s.st_mode & 0o022 == 0,
          directory || s.st_nlink == 1 else { throw Failure("Unsafe ownership, type, or permissions: \(path).") }
    if let mode = exactMode, s.st_mode & 0o777 != mode { throw Failure("Unexpected permissions: \(path).") }
    try noExtendedACL(path)
}
private func trustedParents() throws {
    for path in ["/", "/Library", "/Library/PrivilegedHelperTools", "/Library/LaunchDaemons", "/private", "/private/var", "/private/var/db"] {
        try trusted(path, directory: true)
    }
}
private func prepareDirectory() throws {
    try trustedParents()
    if !exists(Paths.directory) {
        guard mkdir(Paths.directory, 0o700) == 0 || errno == EEXIST else { throw Failure("Cannot create the recovery directory.") }
    }
    try trusted(Paths.directory, directory: true, exactMode: 0o700)
}
private func readTrusted(_ path: String, limit: Int = 65_536) throws -> Data {
    try trusted(path, directory: false)
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw Failure("Cannot open trusted file: \(path).") }
    defer { close(fd) }
    var s = stat()
    guard fstat(fd, &s) == 0, s.st_uid == 0, s.st_mode & S_IFMT == S_IFREG,
          s.st_mode & 0o022 == 0, s.st_nlink == 1, s.st_size >= 0, s.st_size <= limit else {
        throw Failure("Trusted file metadata changed: \(path).")
    }
    var data = Data(count: Int(s.st_size))
    let count = data.withUnsafeMutableBytes { buffer in Darwin.read(fd, buffer.baseAddress, buffer.count) }
    guard count == data.count else { throw Failure("Cannot read complete trusted file: \(path).") }
    return data
}
private func syncDirectory(_ path: String) throws {
    let fd = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw Failure("Cannot open recovery directory for synchronization.") }
    defer { close(fd) }
    guard fsync(fd) == 0 else { throw Failure("Cannot synchronize the recovery directory.") }
}
private func durableWrite(_ data: Data, to path: String, mode: mode_t, durable: Bool = true) throws {
    let directory = (path as NSString).deletingLastPathComponent
    try trusted(directory, directory: true)
    if exists(path) { try trusted(path, directory: false) }
    let temporary = "\(path).\(UUID().uuidString).tmp"
    let fd = open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode)
    guard fd >= 0 else { throw Failure("Cannot stage durable state.") }
    defer { close(fd); unlink(temporary) }
    guard fchmod(fd, mode) == 0 else { throw Failure("Cannot set durable state permissions.") }
    try data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count {
            let result = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            if result < 0 && errno == EINTR { continue }
            guard result > 0 else { throw Failure("Cannot write durable state.") }
            offset += result
        }
    }
    if durable {
        guard fsync(fd) == 0 else { throw Failure("Cannot synchronize staged state.") }
    }
    guard rename(temporary, path) == 0 else { throw Failure("Cannot commit durable state.") }
    if durable {
        try syncDirectory(directory)
        // Flush after the namespace change, not merely before rename. The
        // journal must survive power loss before an enable command can run.
        guard fcntl(fd, F_FULLFSYNC) == 0 else { throw Failure("Cannot durably commit the renamed state.") }
    }
}
private func save(_ record: Journal) throws {
    try durableWrite(try JSONEncoder().encode(record), to: Paths.journal, mode: 0o600)
}
private func loadJournal() throws -> Journal? {
    if !exists(Paths.journal) { return nil }
    let record = try JSONDecoder().decode(Journal.self, from: readTrusted(Paths.journal))
    guard record.version == 1, validateID(record.requestID), record.originalValue == 0,
          record.ownerUID > 0, record.exclusiveUseAcknowledged, record.deadline > 0,
          record.expiresAt.isFinite, !record.boot.isEmpty else { throw Failure("Recovery journal is invalid; it must be retained for diagnosis.") }
    return record
}
private func withLock<T>(abortOnTermination: Bool = false, _ action: () throws -> T) throws -> T {
    try prepareDirectory()
    let fd = open(Paths.lock, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { throw Failure("Cannot open the session lock.") }
    defer { close(fd) }
    var s = stat()
    guard fstat(fd, &s) == 0, s.st_uid == 0, s.st_mode & S_IFMT == S_IFREG,
          s.st_mode & 0o777 == 0o600, s.st_nlink == 1 else { throw Failure("Session lock is unsafe.") }
    try noExtendedACL(Paths.lock)
    let deadline = continuousNow() + ticks(20)
    while flock(fd, LOCK_EX | LOCK_NB) != 0 {
        if abortOnTermination && terminateRequested != 0 { throw Failure("Watchdog was terminated while waiting for the session lock.") }
        guard errno == EWOULDBLOCK || errno == EINTR else { throw Failure("Cannot lock the session.") }
        guard continuousNow() < deadline else { throw Failure("Session is busy; no power setting was changed by this command.") }
        usleep(50_000)
    }
    defer { flock(fd, LOCK_UN) }
    return try action()
}

private struct CommandResult { let code: Int32; let output: Data }
private final class OutputBox: @unchecked Sendable {
    let lock = NSLock()
    var data = Data()
    func append(_ chunk: Data) { lock.lock(); defer { lock.unlock() }; if data.count < 2_000_000 { data.append(chunk.prefix(2_000_000 - data.count)) } }
    func result() -> Data { lock.lock(); defer { lock.unlock() }; return data }
}
private func run(_ executable: String, _ arguments: [String], timeout: Double = 5) throws -> CommandResult {
    let allowed = ["/usr/bin/pmset", "/usr/sbin/ioreg", "/bin/launchctl"]
    guard allowed.contains(executable) else { throw Failure("Executable is not permitted.") }
    let process = Process(), pipe = Pipe(), output = OutputBox(), reader = DispatchGroup()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C", "LC_ALL": "C"]
    process.currentDirectoryURL = URL(fileURLWithPath: "/")
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = pipe
    process.standardError = pipe
    try process.run()
    reader.enter()
    DispatchQueue.global().async {
        while true {
            let data = pipe.fileHandleForReading.availableData
            if data.isEmpty { break }
            output.append(data)
        }
        reader.leave()
    }
    let deadline = continuousNow() + ticks(timeout)
    while process.isRunning && continuousNow() < deadline { usleep(20_000) }
    if process.isRunning { kill(process.processIdentifier, SIGKILL); process.waitUntilExit(); throw Failure("A system command timed out; verify recovery state.") }
    process.waitUntilExit()
    reader.wait()
    return CommandResult(code: process.terminationStatus, output: output.result())
}
private func parsePersisted(_ data: Data) -> Int? {
    guard let text = String(data: data, encoding: .utf8) else { return nil }
    let lines = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    // Do not filter malformed rows away: a valid row plus an invalid duplicate
    // is ambiguous, not a single successfully parsed value.
    let explicit = lines.filter { $0.hasPrefix("SleepDisabled") }
    if !explicit.isEmpty {
        guard explicit.count == 1 else { return nil }
        let words = explicit[0].split(whereSeparator: { $0.isWhitespace })
        guard words.count == 2, words[0] == "SleepDisabled", words[1] == "0" || words[1] == "1" else { return nil }
        return words[1] == "1" ? 1 : 0
    }
    // Apple pmset prints the global heading only after reading a dictionary.
    // PMSettings compares its SleepDisabled value to kCFBooleanTrue, so a
    // missing key in that successfully read dictionary means false. Require a
    // complete recognizable report, rather than equating empty/error output or
    // an entirely missing global dictionary with the default.
    guard text.hasSuffix("\n"), lines.first == "System-wide power settings:",
          lines.filter({ $0 == "System-wide power settings:" }).count == 1,
          lines.filter({ $0 == "Currently in use:" }).count == 1,
          let current = lines.firstIndex(of: "Currently in use:"), current >= 1 else { return nil }
    let otherGlobalKeys: Set<String> = ["DestroyFVKeyOnStandby", "VACTDisabled"]
    var globalSeen = Set<String>()
    for line in lines[1..<current] {
        let words = line.split(whereSeparator: { $0.isWhitespace })
        guard words.count == 2, otherGlobalKeys.contains(String(words[0])),
              globalSeen.insert(String(words[0])).inserted,
              words[1] == "0" || words[1] == "1" else { return nil }
    }
    var profile = [String: String]()
    for line in lines.dropFirst(current + 1) {
        let words = line.split(whereSeparator: { $0.isWhitespace })
        guard words.count >= 2, String(words[0]).range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression) != nil,
              profile.updateValue(String(words[1]), forKey: String(words[0])) == nil else { return nil }
    }
    guard let sleep = profile["sleep"], UInt64(sleep) != nil,
          let display = profile["displaysleep"], UInt64(display) != nil else { return nil }
    return 0
}
private func persistedValue(_ result: CommandResult?) -> Int? {
    guard let result, result.code == 0 else { return nil }
    return parsePersisted(result.output)
}
private func parseLive(_ data: Data) -> Int? {
    guard let list = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [[String: Any]],
          list.count == 1 else { return nil }
    return liveValue(properties: list[0], copySucceeded: true)
}
private func liveValue(properties: [String: Any]?, copySucceeded: Bool) -> Int? {
    guard copySucceeded, let properties else { return nil }
    // XNU initializes userDisabledAllSleep=false and publishes SleepDisabled
    // only on a validated write. A successful full snapshot distinguishes that
    // initial missing property from lookup/copy failure. An absent persisted
    // dictionary is still independently unknown and cannot authorize a start.
    guard let value = properties["SleepDisabled"] else { return 0 }
    return binaryValue(value)
}
private func binaryValue(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, number.doubleValue == 0 || number.doubleValue == 1 else { return nil }
    return number.intValue
}
private func acPower() -> Bool? {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
          let source = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() else { return nil }
    let type = source as String
    if type == (kIOPSACPowerValue as String) { return true }
    if type == (kIOPSBatteryPowerValue as String) || type == (kIOPMUPSPowerKey as String) { return false }
    return nil
}
private func observe() -> Observation {
    let persisted = try? run("/usr/bin/pmset", ["-g"])
    let entry = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
    var live: Int? = nil
    if entry != 0 {
        var copied: Unmanaged<CFMutableDictionary>?
        let result = IORegistryEntryCreateCFProperties(entry, &copied, kCFAllocatorDefault, 0)
        let properties = copied?.takeRetainedValue() as? [String: Any]
        live = liveValue(properties: properties, copySucceeded: result == KERN_SUCCESS)
        IOObjectRelease(entry)
    }
    let thermal = ProcessInfo.processInfo.thermalState
    return Observation(persisted: persistedValue(persisted),
                       live: live, ac: acPower(), thermalSafe: thermal != .serious && thermal != .critical)
}
private func installed() -> Bool {
    (try? trusted(Paths.executable, directory: false, exactMode: 0o755)) != nil
        && (try? trusted(Paths.daemon, directory: false, exactMode: 0o644)) != nil
}
private func status(_ record: Journal?, observed: Observation, state: String, message: String) -> Status {
    Status(state: state, message: message, expiresAt: record?.expiresAt,
           sleepDisabled: observed.verifiedValue, acPower: observed.ac, requestId: record?.requestID,
           installed: installed(), boot: try? bootIdentifier(), sampledAt: continuousNow(), deadline: record?.deadline)
}
private func publish(_ record: Journal?, observed: Observation, state: String, message: String) throws {
    let result = status(record, observed: observed, state: state, message: message)
    // This is a disposable public cache, never rollback authority. Atomic
    // replacement suffices; avoid disk flushes for each health observation.
    try durableWrite(try JSONEncoder().encode(result), to: Paths.summary, mode: 0o644, durable: false)
}
private func inspect() -> Status {
    let observed = observe()
    let boot = try? bootIdentifier()
    let summary = (try? trustedParents()) != nil
        ? (try? JSONDecoder().decode(Status.self, from: readTrusted(Paths.summary))) : nil
    guard let value = observed.verifiedValue else {
        if var saved = summary {
            saved.state = saved.requestId == nil ? "unavailable" : "recovery-required"
            saved.message = "Saved and live sleep state could not both be verified. An owned session can still request recovery."
            saved.sleepDisabled = nil; saved.acPower = observed.ac; saved.installed = installed()
            return saved
        }
        return status(nil, observed: observed, state: "unavailable", message: "Saved and live sleep state could not both be verified.")
    }
    if let saved = summary {
        var result = saved
        result.sleepDisabled = value; result.acPower = observed.ac; result.installed = installed()
        if value == 0 {
            if saved.state == "starting", saved.boot == boot,
               let sampled = saved.sampledAt, continuousNow() >= sampled,
               continuousNow() - sampled < ticks(20) { return result }
            if saved.requestId != nil {
                result.state = "stopping"
                result.message = "Normal sleep is verified; the watchdog must finish retiring its ownership record."
                return result
            }
            result.state = saved.state == "conflict" ? "conflict" : "off"
            result.message = saved.state == "conflict" ? saved.message : "Normal sleep is verified in saved and live settings."
            result.expiresAt = nil
            result.requestId = nil
            return result
        }
        if saved.state == "on", saved.boot == boot, observed.thermalSafe,
           let sampled = saved.sampledAt, let deadline = saved.deadline,
           continuousNow() >= sampled, continuousNow() - sampled < ticks(5), continuousNow() < deadline { return result }
        result.state = saved.state == "conflict" ? "conflict" : "recovery-required"
        result.message = "Sleep remains disabled without a freshly verified active watchdog. Recovery is required."
        return result
    }
    return status(nil, observed: observed, state: value == 0 ? "off" : "conflict",
                  message: value == 0 ? "Normal sleep is verified in saved and live settings." : "Sleep is already disabled by an unowned setting; this helper will not overwrite it.")
}

private func requireRootInstalled() throws {
    guard geteuid() == 0 else { throw Failure("This action requires an explicit administrator authorization.") }
    try trustedParents()
    try trusted(Paths.executable, directory: false, exactMode: 0o755)
    let selfPath = Bundle.main.executableURL?.resolvingSymlinksInPath().path
    guard selfPath == Paths.executable else { throw Failure("This action must use the installed root-owned helper.") }
}
private func installExecutable(owner: UInt32) throws {
    guard let path = Bundle.main.executableURL?.path else { throw Failure("Cannot locate this executable.") }
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw Failure("Cannot open the staging executable without following a symlink.") }
    defer { close(fd) }
    var before = stat(), after = stat()
    guard (path as NSString).deletingLastPathComponent == "/Library/PrivilegedHelperTools",
          (path as NSString).lastPathComponent.hasPrefix(".com.dreameater.closedlid-stage."),
          fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1,
          before.st_mode & 0o777 == 0o700, before.st_uid == 0,
          before.st_size > 0, before.st_size < 30_000_000 else { throw Failure("Staging executable has unsafe metadata.") }
    var data = Data(count: Int(before.st_size))
    let count = data.withUnsafeMutableBytes { bytes in Darwin.read(fd, bytes.baseAddress, bytes.count) }
    guard count == data.count, fstat(fd, &after) == 0, before.st_dev == after.st_dev,
          before.st_ino == after.st_ino, before.st_size == after.st_size,
          before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
          before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec, before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec else {
        throw Failure("Staging executable changed during installation.")
    }
    try durableWrite(data, to: Paths.executable, mode: 0o755)
    let plist: [String: Any] = ["Label": Paths.label, "ProgramArguments": [Paths.executable, "guard"],
                              "RunAtLoad": true, "KeepAlive": ["PathState": [Paths.journal: true]],
                              "ProcessType": "Background", "UserName": "root", "GroupName": "wheel",
                              "ThrottleInterval": 1, "ExitTimeOut": 20, "Umask": 0o077,
                              "WorkingDirectory": "/"]
    try durableWrite(try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0), to: Paths.daemon, mode: 0o644)
}

// Only the matching root journal permits a rollback. Deletion follows dual
// verification; failed verification retains the journal and launchd watchdog.
private func retire(_ record: Journal, observed: Observation, conflict: Bool = false) throws {
    guard observed.isOff else { throw Failure("Refusing to remove a recovery record before normal sleep is verified.") }
    var retired = record
    retired.phase = .retired; retired.ownsMutation = false
    // If an unlinked journal reappears after power loss, its durable terminal
    // state must never authorize restoration of a later actor's sleep setting.
    try save(retired)
    // A retired conflict is safe to start from again. Retain its explanation,
    // but no stale token or terminal Conflict state may strand the next start.
    try trusted(Paths.journal, directory: false, exactMode: 0o600)
    guard unlink(Paths.journal) == 0 else { throw Failure("Cannot retire the verified recovery record.") }
    try syncDirectory(Paths.directory)
    try publish(nil, observed: observed, state: "off", message: record.message)
}
private func restore(_ initial: Journal) throws {
    var record = initial
    guard record.ownsMutation, record.originalValue == 0 else { throw Failure("This helper does not own a power change to restore.") }
    record.phase = .restoring; record.message = "Restoring normal sleep."
    // Ownership was durably recorded before enabling. Disk-full, a blocked
    // fsync, or a broken summary must NEVER precede the actual rollback attempt.
    // A command error does not prove that a power mutation did not happen.
    _ = try? run("/usr/bin/pmset", ["-a", "disablesleep", "0"])
    var observed = observe()
    for _ in 0..<4 where !observed.isOff { usleep(100_000); observed = observe() }
    if observed.isOff {
        record.message = "Normal sleep was restored and verified in saved and live settings."
        try retire(record, observed: observed)
    } else {
        record.phase = .recovery; record.message = "Normal sleep could not be verified. The recovery watchdog and journal remain installed."
        try save(record)
        try publish(record, observed: observed, state: "recovery-required", message: record.message)
    }
}
private func applyDecision(_ decision: Decision, record initial: Journal, observed: Observation) throws -> Bool {
    var record = initial
    switch decision {
    case .acknowledge:
        record.guardSeen = true; record.guardPID = getpid(); record.phase = .ready
        record.message = "Recovery watchdog is ready."
        try save(record); try publish(record, observed: observed, state: "starting", message: record.message)
    case .wait:
        try publish(record, observed: observed, state: record.phase == .active ? "on" : "starting", message: record.message)
    case .restore:
        try restore(record)
    case .retire:
        record.message = record.phase == .conflict ? record.message : "Normal sleep is verified."
        try retire(record, observed: observed, conflict: record.phase == .conflict)
    case .relinquish:
        record.phase = .conflict; record.ownsMutation = false
        record.message = "The sleep setting changed outside this session. Ownership was relinquished; no setting will be reapplied."
        try save(record)
        if observed.isOff { try retire(record, observed: observed, conflict: true) }
        else { try publish(record, observed: observed, state: "conflict", message: record.message) }
    case .retainConflict:
        try publish(record, observed: observed, state: "conflict", message: record.message)
    }
    return exists(Paths.journal)
}

private func installStart(seconds: Int, owner: UInt32, requestID: String) throws {
    guard geteuid() == 0 else { throw Failure("Starting requires explicit administrator authorization.") }
    // Check before creating a lock/state directory, changing an installation,
    // reclaiming a journal, or modifying any power setting.
    try requireSupportedStartEnvironment()
    guard (1...86_400).contains(seconds), owner > 0, getpwuid(owner) != nil, validateID(requestID) else { throw Failure("Invalid duration, owner, or request ID.") }
    let boot = try bootIdentifier(), now = continuousNow()
    try withLock {
        let observed = observe()
        if let previous = try loadJournal() {
            guard mayReclaimPreparation(previous, observed: observed, boot: boot, now: continuousNow(),
                                        installerAlive: kill(previous.installerPID, 0) == 0) else {
                throw Failure("An existing session or recovery journal must be resolved before another start.")
            }
            // A crashed installer/failed bootstrap never owned a mutation.
            // Only verified dual-zero can retire this stale preparation.
            try retire(previous, observed: observed)
        }
        guard observed.isOff else { throw Failure("Refusing to start: saved and live sleep state must both be zero.") }
        guard observed.thermalSafe else { throw Failure("Closed-lid mode cannot start during a serious or critical thermal state.") }
        // No active session exists, so a prior idle job can be unloaded before
        // updating the binary. Never unload a job that owns a journal.
        if (try? run("/bin/launchctl", ["print", "system/\(Paths.label)"]))?.code == 0 {
            let unloaded = try run("/bin/launchctl", ["bootout", "system/\(Paths.label)"])
            guard unloaded.code == 0 else { throw Failure("Cannot retire the previous idle watchdog.") }
        }
        try installExecutable(owner: owner)
        var record = Journal(requestID: requestID, ownerUID: owner, boot: boot,
                             deadline: now + ticks(Double(seconds) + 15), expiresAt: floor((Date().timeIntervalSince1970 + Double(seconds) + 15) * 1000),
                             installerPID: getpid(), preparationDeadline: now + ticks(15))
        try save(record)
        try publish(record, observed: observed, state: "starting", message: record.message)
        do {
            let result = try run("/bin/launchctl", ["bootstrap", "system", Paths.daemon])
            guard result.code == 0 else { throw Failure("Watchdog bootstrap failed.") }
        } catch {
            // Durable cancellation permits a later authorized start to reclaim
            // only this non-owning record, even if no daemon ever started.
            record.preparationDeadline = 0
            record.message = "The watchdog could not be loaded. No enable command was issued."
            try? save(record)
            try? publish(record, observed: observed, state: "recovery-required", message: record.message)
            throw Failure(record.message)
        }
    }
    let handshakeDeadline = now + ticks(15)
    var enabled = false
    while !enabled && continuousNow() < handshakeDeadline {
        enabled = try withLock {
            guard var record = try loadJournal(), record.requestID == requestID else { throw Failure("The session was cancelled before activation.") }
            guard record.phase == .preparing || record.phase == .ready else { throw Failure("The recovery watchdog did not accept activation.") }
            guard record.phase == .ready, record.guardSeen, let guardPID = record.guardPID, kill(guardPID, 0) == 0 else { return false }
            let observed = observe()
            guard observed.isOff, observed.thermalSafe, record.boot == (try bootIdentifier()), continuousNow() < record.deadline else {
                throw Failure("Thermal or session eligibility changed before activation.")
            }
            record.phase = .enabling; record.ownsMutation = true; record.message = "Activating and verifying closed-lid mode."
            record.deadline = continuousNow() + ticks(Double(seconds))
            record.expiresAt = floor((Date().timeIntervalSince1970 + Double(seconds)) * 1000)
            try save(record)
            _ = try? run("/usr/bin/pmset", ["-a", "disablesleep", "1"])
            var verified = observe()
            for _ in 0..<4 where !verified.isOn { usleep(100_000); verified = observe() }
            guard verified.isOn, verified.thermalSafe, continuousNow() < record.deadline,
                  kill(guardPID, 0) == 0 else { try restore(record); throw Failure("Activation could not be verified; normal-sleep recovery was requested.") }
            record.phase = .active; record.message = "Closed-lid mode is active until the timer expires or normal sleep is restored."
            try save(record)
            try publish(record, observed: verified, state: "on", message: record.message)
            return true
        }
        if !enabled { usleep(50_000) }
    }
    guard enabled else { throw Failure("The watchdog did not acknowledge readiness in time; no enable command was issued.") }
}

private var terminateRequested: sig_atomic_t = 0
private func wakeGuard(_ context: UnsafeMutableRawPointer?) { CFRunLoopStop(CFRunLoopGetMain()) }
private func guardLoop() throws {
    try requireRootInstalled()
    signal(SIGTERM) { _ in terminateRequested = 1 }
    signal(SIGINT) { _ in terminateRequested = 1 }
    // Native power notifications refresh diagnostics promptly. The audit is
    // still needed to detect another app's global pmset write (no CAS exists).
    let source = IOPSNotificationCreateRunLoopSource(wakeGuard, nil)?.takeRetainedValue()
    if let source { CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode) }
    let thermalObserver = NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil) { _ in
        CFRunLoopStop(CFRunLoopGetMain())
    }
    defer {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .defaultMode) }
        NotificationCenter.default.removeObserver(thermalObserver)
    }
    var first = true
    while true {
        var nextDeadline: UInt64? = nil
        var preparing = false
        do {
            let remains = try withLock(abortOnTermination: true) {
                guard let record = try loadJournal() else { return false }
                preparing = record.phase == .preparing || record.phase == .ready
                let observed = observe()
                let trigger: Trigger = terminateRequested != 0 ? .termination : (first ? .firstLaunch : .tick)
                // Losing access to boot identity after activation cannot block
                // recovery; an unknown boot behaves as a changed boot.
                let decision = decide(record, observed, boot: (try? bootIdentifier()) ?? "", now: continuousNow(),
                                      trigger: trigger, installerAlive: kill(record.installerPID, 0) == 0)
                // Recovery and conflict retain the two-second backoff even
                // when a previous lease has expired; never create a hot loop.
                nextDeadline = decision == .wait && record.ownsMutation && record.phase == .active ? record.deadline : nil
                return try applyDecision(decision, record: record, observed: observed)
            }
            first = false
            if !remains { return }
            // A failed restore remains durable and is retried by launchd on exit.
            if terminateRequested != 0 { return }
        } catch {
            // Leave the journal and KeepAlive condition intact on every failure.
            FileHandle.standardError.write(Data("Closed-lid recovery requires attention: \(error)\n".utf8))
            throw error
        }
        CFRunLoopRunInMode(.defaultMode, auditWait(deadline: nextDeadline, now: continuousNow(), preparing: preparing), true)
    }
}
private func stop(requestID: String) throws {
    try requireRootInstalled()
    guard validateID(requestID) else { throw Failure("Invalid request ID.") }
    try withLock {
        guard let record = try loadJournal() else {
            let observed = observe()
            guard observed.isOff else { throw Failure("No owned session exists; an unowned setting will not be changed.") }
            // Retry after a crash between journal removal and public status
            // publication. This only repairs a cache, never a power setting.
            try publish(nil, observed: observed, state: "off", message: "Normal sleep is verified and no owned session remains.")
            return
        }
        guard record.requestID == requestID else { throw Failure("Request ID does not match the owned session; no power setting was changed.") }
        let observed = observe()
        let decision = decide(record, observed, boot: (try? bootIdentifier()) ?? "", now: continuousNow(), trigger: .stop, installerAlive: false)
        _ = try applyDecision(decision, record: record, observed: observed)
    }
}
private func uninstall() throws {
    try requireRootInstalled()
    try withLock {
        let record = try loadJournal(), observed = observe()
        guard mayUninstall(journalPresent: record != nil, observed: observed) else {
            throw Failure("Uninstall requires no recovery journal and saved and live normal sleep. Stop the owned session first.")
        }
        // No sleep mutation is owned here. Keep the same lock inode through
        // unload and deletion so uninstall cannot race an authorized start.
        let loaded = try run("/bin/launchctl", ["print", "system/\(Paths.label)"])
        if loaded.code == 0 {
            let unloaded = try run("/bin/launchctl", ["bootout", "system/\(Paths.label)"])
            guard unloaded.code == 0 else { throw Failure("Could not unload the idle watchdog; installation files were retained.") }
        } else {
            let output = String(data: loaded.output, encoding: .utf8) ?? ""
            guard output.contains("Could not find service") else { throw Failure("Cannot verify that the watchdog is unloaded; installation files were retained.") }
        }
        // Preflight every target before deleting any, including symlinks/ACLs.
        for path in [Paths.daemon, Paths.summary, Paths.executable] where exists(path) {
            try trusted(path, directory: false)
        }
        for path in [Paths.daemon, Paths.summary, Paths.executable] where exists(path) {
            guard unlink(path) == 0 else { throw Failure("Could not remove \(path); no power setting was changed.") }
        }
        try syncDirectory("/Library/LaunchDaemons")
        try syncDirectory("/Library/PrivilegedHelperTools")
        // Intentionally retain the root0700 directory and stable root0600 lock.
    }
}

private func selfTest() throws {
    // Never creates files, runs system commands, probes power, installs, or calls
    // privileged code. These cases exercise the real reducer with fake state.
    let off = Observation(persisted: 0, live: 0, ac: true)
    let on = Observation(persisted: 1, live: 1, ac: true)
    let unknown = Observation(persisted: nil, live: nil, ac: nil)
    let mismatch = Observation(persisted: 0, live: 1, ac: true)
    var record = Journal(requestID: "0123456789abcdef", ownerUID: 501, boot: "boot-a", deadline: 1000,
                         expiresAt: 1000, installerPID: 42, preparationDeadline: 50)
    var count = 0
    let eligibilityCases: [(Bool, Bool?, Int, Bool, String)] = [
        (true, true, 26, true, "supported minimum OS"),
        (true, true, 27, true, "supported newer OS"),
        (true, true, 25, false, "OS below release minimum"),
        (true, true, 13, false, "recovery deployment minimum does not permit new leases"),
        (true, true, 0, false, "invalid OS version"),
        (true, false, 26, false, "non-Apple-Silicon hardware"),
        (true, nil, 26, false, "hardware identification unavailable"),
        (false, true, 26, false, "translated x86 helper on Apple Silicon"),
        (false, false, 27, false, "Intel helper on Intel hardware"),
        (false, nil, 25, false, "unsupported helper and unknown hardware"),
    ]
    for (nativeARM64, appleSilicon, major, allowed, name) in eligibilityCases {
        let failure = startEligibilityFailure(nativeARM64: nativeARM64, appleSilicon: appleSilicon,
                                              macOSMajorVersion: major)
        guard (failure == nil) == allowed else { throw Failure("Self-test failed: \(name)") }
        count += 1
    }
    func expect(_ actual: Decision, _ expected: Decision, _ name: String) throws {
        guard actual == expected else { throw Failure("Self-test failed: \(name): \(actual) != \(expected)") }
        count += 1
    }
    func evaluate(_ observation: Observation, _ trigger: Trigger = .tick, _ boot: String = "boot-a", _ now: UInt64 = 10, _ alive: Bool = true) -> Decision {
        decide(record, observation, boot: boot, now: now, trigger: trigger, installerAlive: alive)
    }
    try expect(evaluate(off, .firstLaunch), .acknowledge, "guard before mutation")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: false), .firstLaunch), .acknowledge, "battery startup acknowledged")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: nil), .firstLaunch), .acknowledge, "unknown power startup acknowledged")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: false)), .wait, "battery preparation continues")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: nil)), .wait, "unknown power preparation continues")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: false, thermalSafe: false), .firstLaunch), .retire, "battery thermal state blocks startup")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: nil, thermalSafe: false), .firstLaunch), .retire, "unknown power thermal state blocks startup")
    try expect(evaluate(on, .firstLaunch), .relinquish, "preexisting enabled is unowned")
    try expect(evaluate(unknown, .firstLaunch), .relinquish, "unknown baseline refuses")
    try expect(evaluate(off, .firstLaunch, "boot-b"), .retire, "reboot before mutation")
    try expect(evaluate(off, .tick, "boot-a", 51), .retire, "installer handshake expires")
    try expect(evaluate(off, .tick, "boot-a", 10, false), .retire, "installer dies before mutation")
    guard mayReclaimPreparation(record, observed: off, boot: "boot-a", now: 51, installerAlive: true),
          mayReclaimPreparation(record, observed: off, boot: "boot-b", now: 10, installerAlive: true),
          !mayReclaimPreparation(record, observed: on, boot: "boot-a", now: 51, installerAlive: false),
          !mayReclaimPreparation(record, observed: off, boot: "boot-a", now: 10, installerAlive: true) else {
        throw Failure("Self-test failed: stale preparation admission")
    }
    count += 4
    var failedBootstrap = record; failedBootstrap.preparationDeadline = 0
    guard mayReclaimPreparation(failedBootstrap, observed: off, boot: "boot-a", now: 10, installerAlive: true),
          !mayReclaimPreparation(failedBootstrap, observed: mismatch, boot: "boot-a", now: 10, installerAlive: false) else {
        throw Failure("Self-test failed: bootstrap failure recovery")
    }
    count += 2
    guard auditWait(deadline: ticks(0.25), now: 0, preparing: false) <= 0.25,
          auditWait(deadline: 1, now: 2, preparing: false) == 0.001,
          auditWait(deadline: nil, now: 0, preparing: true) == 0.1 else { throw Failure("Self-test failed: finite audit wait") }
    count += 3
    guard mayUninstall(journalPresent: false, observed: off),
          !mayUninstall(journalPresent: true, observed: off),
          !mayUninstall(journalPresent: false, observed: mismatch),
          !mayUninstall(journalPresent: false, observed: unknown) else {
        throw Failure("Self-test failed: uninstall admission")
    }
    count += 4
    record.guardSeen = true; record.phase = .ready
    try expect(evaluate(off, .firstLaunch), .retire, "guard restart before mutation cancels")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: false)), .wait, "ready battery handshake continues")
    try expect(evaluate(Observation(persisted: 0, live: 0, ac: nil)), .wait, "ready unknown power handshake continues")
    record.ownsMutation = true; record.phase = .enabling
    try expect(evaluate(on), .restore, "installer crashes after write before active")
    try expect(evaluate(off), .retire, "installer crashes before write")
    try expect(evaluate(unknown), .restore, "uncertain activation rolls back")
    record.phase = .active
    try expect(evaluate(on), .wait, "verified active session")
    try expect(evaluate(on, .firstLaunch), .restore, "guard crash restart")
    try expect(evaluate(on, .termination), .restore, "SIGTERM")
    try expect(evaluate(on, .stop), .restore, "matching stop")
    try expect(evaluate(on, .tick, "boot-b"), .restore, "reboot with persistent setting")
    try expect(evaluate(on, .tick, ""), .restore, "boot identity becomes unavailable")
    try expect(evaluate(on, .tick, "boot-a", 1000), .restore, "continuous deadline")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: false)), .wait, "AC to battery transition keeps active lease")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: nil)), .wait, "unknown power source keeps active lease")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: true, thermalSafe: false)), .restore, "serious or critical thermal state")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: false, thermalSafe: false)), .restore, "battery thermal state restores")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: nil, thermalSafe: false)), .restore, "unknown power thermal state restores")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: false), .tick, "boot-a", 1000), .restore, "battery deadline restores")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: nil), .tick, "boot-a", 1000), .restore, "unknown power deadline restores")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: false), .stop), .restore, "battery stop restores")
    try expect(evaluate(Observation(persisted: 1, live: 1, ac: false), .firstLaunch), .restore, "battery watchdog restart restores")
    try expect(evaluate(off), .relinquish, "external zero")
    try expect(evaluate(mismatch), .relinquish, "mixed external zero")
    record.phase = .conflict; record.ownsMutation = false
    try expect(evaluate(on), .retainConflict, "external zero then one is not overwritten")
    try expect(evaluate(mismatch), .retainConflict, "conflict keeps journal until verified zero")
    try expect(evaluate(off), .retire, "conflict clears only after dual zero")
    record.phase = .recovery; record.ownsMutation = true
    try expect(evaluate(on), .restore, "failed rollback retries")
    try expect(evaluate(unknown), .restore, "unverifiable rollback retains recovery")
    try expect(evaluate(off), .retire, "verified rollback retires")
    record.phase = .retired; record.ownsMutation = false
    try expect(evaluate(on, .firstLaunch, "boot-b"), .relinquish, "retired journal resurrected after crash cannot restore another actor")
    try expect(evaluate(off, .firstLaunch, "boot-b"), .retire, "retired journal cleanup after crash")
    guard parsePersisted(Data("System-wide power settings:\n SleepDisabled 0\n".utf8)) == 0,
          parsePersisted(Data(" SleepDisabled 1\n SleepDisabled 0\n".utf8)) == nil,
          parsePersisted(Data(" SleepDisabled 2\n".utf8)) == nil,
          validateID("0123456789abcdef"), !validateID("../../untrusted") else { throw Failure("Self-test failed: input parsing") }
    count += 4
    // Source-shaped fixtures: global settings precede the active profile;
    // profile values can include an assertion annotation or a file path.
    let missingGlobalKey = """
    System-wide power settings:
     DestroyFVKeyOnStandby 0
    Currently in use:
     standby 1
     sleep 1 (sleep prevented by caffeinate)
     hibernatefile /var/vm/sleepimage
     displaysleep 10

    """
    let emptyGlobalDictionary = "System-wide power settings:\nCurrently in use:\n sleep 1\n displaysleep 10\n"
    let persistedCases: [(String, Int?, String)] = [
        (missingGlobalKey, 0, "known dictionary with absent sleep-disable key"),
        (emptyGlobalDictionary, 0, "empty known global dictionary"),
        ("Currently in use:\n sleep 1\n displaysleep 10\n", nil, "entire global dictionary unavailable"),
        ("System-wide power settings:\n", nil, "global heading only"),
        ("System-wide power settings:\nCurrently in use:\n", nil, "headings without a profile"),
        ("System-wide power settings:\nCurrently in use:\n sleep 1\n", nil, "incomplete profile"),
        (String(emptyGlobalDictionary.dropLast()), nil, "unterminated default report"),
        (emptyGlobalDictionary + "Error reading preferences\n", nil, "default report with an error"),
        ("System-wide power settings:\n DestroyFVKeyOnStandby invalid\nCurrently in use:\n sleep 1\n displaysleep 10\n", nil, "malformed other global value"),
        ("System-wide power settings:\n SleepDisabled 0\n SleepDisabled invalid\n", nil, "valid and malformed duplicate values"),
        ("System-wide power settings:\n SleepDisabled 1\n SleepDisabled 1\n", nil, "duplicate enabled values"),
        ("System-wide power settings:\n SleepDisabled\n", nil, "missing explicit value"),
        ("System-wide power settings:\n SleepDisabled 00\n", nil, "noncanonical explicit value"),
        ("", nil, "empty output"),
    ]
    for (output, expected, name) in persistedCases {
        guard parsePersisted(Data(output.utf8)) == expected else { throw Failure("Self-test failed: \(name)") }
        count += 1
    }
    guard persistedValue(CommandResult(code: 1, output: Data(missingGlobalKey.utf8))) == nil,
          persistedValue(nil) == nil,
          persistedValue(CommandResult(code: 0, output: Data(missingGlobalKey.utf8))) == 0 else {
        throw Failure("Self-test failed: failed reads never become a default value")
    }
    count += 3
    let livePlist = try PropertyListSerialization.data(fromPropertyList: [["SleepDisabled": true]], format: .xml, options: 0)
    guard parseLive(livePlist) == 1, parseLive(Data("invalid".utf8)) == nil else { throw Failure("Self-test failed: live parsing") }
    count += 2
    let noLiveKey = try PropertyListSerialization.data(fromPropertyList: [["IORegistryEntryName": "IOPMrootDomain"]], format: .xml, options: 0)
    guard parseLive(noLiveKey) == 0 else { throw Failure("Self-test failed: absent live property in a successful snapshot has the kernel default") }
    count += 1
    let liveCases: [([String: Any]?, Bool, Int?, String)] = [
        (["SleepDisabled": false], true, 0, "explicit live false"),
        (["SleepDisabled": true], true, 1, "explicit live true"),
        (["IORegistryEntryName": "IOPMrootDomain"], true, 0, "successful live snapshot with absent key"),
        (["IORegistryEntryName": "IOPMrootDomain"], false, nil, "failed copy with incidental dictionary"),
        (["SleepDisabled": false], false, nil, "failed copy with incidental false value"),
        (nil, true, nil, "successful code without snapshot"),
        (nil, false, nil, "failed live read"),
        (["SleepDisabled": "false"], true, nil, "malformed live string"),
        (["SleepDisabled": 2], true, nil, "nonbinary live number"),
    ]
    for (properties, succeeded, expected, name) in liveCases {
        guard liveValue(properties: properties, copySucceeded: succeeded) == expected else {
            throw Failure("Self-test failed: \(name)")
        }
        count += 1
    }
    let wire = Status(state: "off", message: "test", expiresAt: nil, sleepDisabled: 0, acPower: true,
                      requestId: nil, installed: false, boot: nil, sampledAt: nil, deadline: nil)
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(wire)) as? [String: Any]
    guard object?["expiresAt"] is NSNull, object?["requestId"] is NSNull else { throw Failure("Self-test failed: explicit null wire fields") }
    count += 2
    print("{\"selfTest\":\"passed\",\"cases\":\(count),\"mode\":\"in-memory-only\",\"powerCommandsExecuted\":0}")
}

umask(0o077)
do {
    let args = Array(CommandLine.arguments.dropFirst())
    switch args.first {
    case "--self-test" where args.count == 1: try selfTest()
    case "inspect" where args.count == 1: emit(inspect())
    case "install-start" where args.count == 4:
        guard let seconds = Int(args[1]), let uid = UInt32(args[2]) else { throw Failure("Invalid numeric arguments.") }
        try installStart(seconds: seconds, owner: uid, requestID: args[3]); emit(inspect())
    case "stop" where args.count == 2: try stop(requestID: args[1]); emit(inspect())
    case "uninstall" where args.count == 1: try uninstall(); emit(inspect())
    case "guard" where args.count == 1: try guardLoop()
    default: throw Failure("Usage: closed-lid-helper inspect | install-start <1..86400 seconds> <owner uid> <request id> | stop <request id> | uninstall | guard | --self-test")
    }
} catch {
    // No implicit root fallback or unowned rollback. A guard journal remains
    // authoritative after a CLI interruption or failed activation.
    emit(Status(state: "recovery-required", message: String(describing: error), expiresAt: nil,
                sleepDisabled: nil, acPower: nil, requestId: nil, installed: installed(),
                boot: nil, sampledAt: nil, deadline: nil))
    exit(1)
}
