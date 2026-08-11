import Foundation
import FoundationModelsCore
import NodeAPI

private let sharedService = FoundationModelsService()
private let napiAutoLength = -1

private final class AsyncContext: @unchecked Sendable {
    struct NativeAvailability: Sendable {
        let available: Bool
        let reason: String?
    }

    enum Operation {
        case availability
        case suggestion(String)
    }

    enum Result: Sendable {
        case availability(NativeAvailability)
        case suggestion(String?)
        case failure(String)
    }

    let operation: Operation
    var deferred: napi_deferred?
    var work: napi_async_work?
    var result: Result?

    init(operation: Operation, deferred: napi_deferred?) {
        self.operation = operation
        self.deferred = deferred
    }
}

private func waitForAsync<T: Sendable>(_ body: @escaping @Sendable () async throws -> T) throws -> T {
    let semaphore = DispatchSemaphore(value: 0)
    let box = LockedBox<Result<T, Error>?>(nil)

    Task {
        do {
            box.value = .success(try await body())
        } catch {
            box.value = .failure(error)
        }
        semaphore.signal()
    }

    semaphore.wait()
    return try box.value!.get()
}

private final class LockedBox<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: T

    init(_ value: T) {
        self.stored = value
    }

    var value: T {
        get {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        set {
            lock.lock()
            stored = newValue
            lock.unlock()
        }
    }
}

@_cdecl("napi_register_module_v1")
public func registerModule(_ env: napi_env?, _ exports: napi_value?) -> napi_value? {
    setFunction(env, exports, "getAvailability", getAvailabilityCallback)
    setFunction(env, exports, "suggest", suggestCallback)
    setFunction(env, exports, "dispose", disposeCallback)
    return exports
}

private func setFunction(
    _ env: napi_env?,
    _ exports: napi_value?,
    _ name: String,
    _ callback: napi_callback?
) {
    var function: napi_value?
    name.withCString { cName in
        napi_create_function(env, cName, napiAutoLength, callback, nil, &function)
        napi_set_named_property(env, exports, cName, function)
    }
}

private let getAvailabilityCallback: napi_callback = { env, _ in
    makePromise(env, operation: .availability)
}

private let suggestCallback: napi_callback = { env, info in
    var argc: Int = 1
    var argv = [napi_value?](repeating: nil, count: 1)
    napi_get_cb_info(env, info, &argc, &argv, nil, nil)

    guard argc == 1, let inputValue = argv[0] else {
        napi_throw_type_error(env, nil, "suggest(input) requires a string")
        return nil
    }

    var valueType = napi_valuetype(0)
    napi_typeof(env, inputValue, &valueType)
    guard valueType == napi_string else {
        napi_throw_type_error(env, nil, "suggest(input) requires a string")
        return nil
    }

    guard let input = stringValue(env, inputValue) else {
        napi_throw_type_error(env, nil, "suggest(input) could not read the string")
        return nil
    }

    return makePromise(env, operation: .suggestion(input))
}

private let disposeCallback: napi_callback = { _, _ in
    Task {
        await sharedService.dispose()
    }
    return nil
}

private func makePromise(_ env: napi_env?, operation: AsyncContext.Operation) -> napi_value? {
    var promise: napi_value?
    var deferred: napi_deferred?
    guard napi_create_promise(env, &deferred, &promise) == napi_ok else {
        napi_throw_error(env, nil, "Failed to create Promise")
        return nil
    }

    let context = AsyncContext(operation: operation, deferred: deferred)
    let contextPointer = Unmanaged.passRetained(context).toOpaque()

    var resourceName: napi_value?
    napi_create_string_utf8(env, "foundation_models", napiAutoLength, &resourceName)

    guard napi_create_async_work(
        env,
        nil,
        resourceName,
        executeAsyncWork,
        completeAsyncWork,
        contextPointer,
        &context.work
    ) == napi_ok else {
        Unmanaged<AsyncContext>.fromOpaque(contextPointer).release()
        rejectPromise(env, deferred, message: "Failed to create async work")
        return promise
    }

    guard napi_queue_async_work(env, context.work) == napi_ok else {
        napi_delete_async_work(env, context.work)
        Unmanaged<AsyncContext>.fromOpaque(contextPointer).release()
        rejectPromise(env, deferred, message: "Failed to queue async work")
        return promise
    }

    return promise
}

private let executeAsyncWork: napi_async_execute_callback = { _, data in
    guard let data else { return }
    let context = Unmanaged<AsyncContext>.fromOpaque(data).takeUnretainedValue()

    switch context.operation {
    case .availability:
        context.result = .availability(waitForAvailability())
    case .suggestion(let input):
        do {
            let suggestion = try waitForAsync {
                try await sharedService.suggest(for: input)
            }
            context.result = .suggestion(suggestion)
        } catch {
            context.result = .failure(error.localizedDescription)
        }
    }
}

private let completeAsyncWork: napi_async_complete_callback = { env, _, data in
    guard let data else { return }
    let context = Unmanaged<AsyncContext>.fromOpaque(data).takeRetainedValue()
    defer {
        napi_delete_async_work(env, context.work)
    }

    guard let deferred = context.deferred else { return }

    switch context.result {
    case .availability(let availability):
        resolvePromise(env, deferred, value: makeAvailabilityObject(env, availability))
    case .suggestion(let suggestion):
        resolvePromise(env, deferred, value: makeOptionalString(env, suggestion))
    case .failure(let message):
        rejectPromise(env, deferred, message: message)
    case nil:
        rejectPromise(env, deferred, message: "Foundation Models operation did not complete")
    }
}

private func waitForAvailability() -> AsyncContext.NativeAvailability {
    let semaphore = DispatchSemaphore(value: 0)
    let box = LockedBox<AsyncContext.NativeAvailability?>(nil)

    Task {
        let availability = await sharedService.availability()
        box.value = AsyncContext.NativeAvailability(
            available: availability.available,
            reason: availability.reason?.rawValue
        )
        semaphore.signal()
    }

    semaphore.wait()
    return box.value ?? AsyncContext.NativeAvailability(
        available: false,
        reason: AvailabilityReason.modelUnavailable.rawValue
    )
}

private func makeAvailabilityObject(_ env: napi_env?, _ availability: AsyncContext.NativeAvailability) -> napi_value? {
    var object: napi_value?
    napi_create_object(env, &object)
    setBool(env, object, "available", availability.available)
    setString(env, object, "platform", "macos")
    setString(env, object, "minimumOS", "26.0")
    if let reason = availability.reason {
        setString(env, object, "reason", reason)
    }
    return object
}

private func makeOptionalString(_ env: napi_env?, _ value: String?) -> napi_value? {
    guard let value else {
        var nullValue: napi_value?
        napi_get_null(env, &nullValue)
        return nullValue
    }

    var string: napi_value?
    _ = value.withCString { cString in
        napi_create_string_utf8(env, cString, napiAutoLength, &string)
    }
    return string
}

private func setBool(_ env: napi_env?, _ object: napi_value?, _ name: String, _ value: Bool) {
    var jsValue: napi_value?
    napi_get_boolean(env, value, &jsValue)
    setProperty(env, object, name, jsValue)
}

private func setString(_ env: napi_env?, _ object: napi_value?, _ name: String, _ value: String) {
    var jsValue: napi_value?
    _ = value.withCString { cValue in
        napi_create_string_utf8(env, cValue, napiAutoLength, &jsValue)
    }
    setProperty(env, object, name, jsValue)
}

private func setProperty(_ env: napi_env?, _ object: napi_value?, _ name: String, _ value: napi_value?) {
    _ = name.withCString { cName in
        napi_set_named_property(env, object, cName, value)
    }
}

private func resolvePromise(_ env: napi_env?, _ deferred: napi_deferred?, value: napi_value?) {
    napi_resolve_deferred(env, deferred, value)
}

private func rejectPromise(_ env: napi_env?, _ deferred: napi_deferred?, message: String) {
    var errorMessage: napi_value?
    _ = message.withCString { cMessage in
        napi_create_string_utf8(env, cMessage, napiAutoLength, &errorMessage)
    }
    napi_reject_deferred(env, deferred, errorMessage)
}

private func stringValue(_ env: napi_env?, _ value: napi_value?) -> String? {
    var length = 0
    guard napi_get_value_string_utf8(env, value, nil, 0, &length) == napi_ok else {
        return nil
    }

    var buffer = [CChar](repeating: 0, count: length + 1)
    guard napi_get_value_string_utf8(env, value, &buffer, buffer.count, &length) == napi_ok else {
        return nil
    }
    return String(decoding: buffer.prefix(length).map { UInt8(bitPattern: $0) }, as: UTF8.self)
}
