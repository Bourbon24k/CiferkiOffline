import Foundation
import Network

/// Serves only bundled resources on loopback. Gameplay never needs Internet.
final class LocalWebServer {
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "ciferki.local-web")
    private let root: URL
    static let port: UInt16 = 18742
    init(root: URL) { self.root = root.standardizedFileURL }

    func start(completion: @escaping (Result<URL, Error>) -> Void) {
        do {
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: Self.port)!)
            parameters.allowLocalEndpointReuse = true
            let listener = try NWListener(using: parameters)
            self.listener = listener
            var delivered = false
            listener.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    guard !delivered else { return }; delivered = true
                    DispatchQueue.main.async { completion(.success(URL(string: "http://127.0.0.1:\(Self.port)/")!)) }
                case .failed(let error):
                    guard !delivered else { return }; delivered = true
                    DispatchQueue.main.async { completion(.failure(error)) }
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { connection.cancel(); return }
                connection.start(queue: self.queue)
                self.receive(connection, accumulated: Data())
            }
            listener.start(queue: queue)
        } catch { completion(.failure(error)) }
    }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, complete, error in
            guard let self else { connection.cancel(); return }
            var request = accumulated
            if let data { request.append(data) }
            if request.count > 32768 || error != nil { connection.cancel(); return }
            if request.range(of: Data("\r\n\r\n".utf8)) != nil { self.reply(connection, request: request) }
            else if complete { connection.cancel() }
            else { self.receive(connection, accumulated: request) }
        }
    }

    private func reply(_ connection: NWConnection, request: Data) {
        guard let text = String(data: request, encoding: .utf8), let first = text.components(separatedBy: "\r\n").first else { connection.cancel(); return }
        let parts = first.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else { send(connection, status: "405 Method Not Allowed", body: Data(), type: "text/plain"); return }
        let target = String(parts[1]).components(separatedBy: "?")[0].removingPercentEncoding ?? "/"
        let segments = target.split(separator: "/")
        guard !segments.contains(".."), !target.contains("\0"), !target.hasPrefix("/v1/") else { send(connection, status: "404 Not Found", body: Data(), type: "text/plain"); return }
        var file = root.appendingPathComponent(target.trimmingCharacters(in: CharacterSet(charactersIn: "/"))).standardizedFileURL
        guard file.path == root.path || file.path.hasPrefix(root.path + "/") else { connection.cancel(); return }
        // BrowserRouter pages use the same entry point, but missing assets are errors.
        if target == "/" || !FileManager.default.fileExists(atPath: file.path) && file.pathExtension.isEmpty { file = root.appendingPathComponent("index.html") }
        guard let body = try? Data(contentsOf: file) else { send(connection, status: "404 Not Found", body: Data(), type: "text/plain"); return }
        let types = ["html":"text/html; charset=utf-8","js":"text/javascript; charset=utf-8","css":"text/css; charset=utf-8","svg":"image/svg+xml","png":"image/png","webp":"image/webp","woff":"font/woff","woff2":"font/woff2","json":"application/json"]
        send(connection, status: "200 OK", body: body, type: types[file.pathExtension] ?? "application/octet-stream", headOnly: parts[0] == "HEAD")
    }

    private func send(_ connection: NWConnection, status: String, body: Data, type: String, headOnly: Bool = false) {
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        var response = Data(header.utf8)
        if !headOnly { response.append(body) }
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
    deinit { listener?.cancel() }
}
