final class TRPCClient {
    private struct CreateTaskInput: Codable {
        let title: String
        let price: Int
    }

    private struct TaskResponse: Codable {
        let id: String
        let state: String
    }

    private struct SendMessageInput: Codable {
        let conversationId: String
        let body: String
    }

    private struct MessageResponse: Codable {
        let id: String
        let body: String
        let delivered: Bool
    }

    func createTask() {
        let _: TaskResponse = try await trpc.call(
            router: "task",
            procedure: "create",
            input: CreateTaskInput(title: "test", price: 100)
        )
    }

    func sendMessage() {
        let _: MessageResponse = try await trpc.call(
            router: "messaging",
            procedure: "sendMessage",
            input: SendMessageInput(conversationId: "1", body: "hello")
        )
    }

    func legacyCall() {
        let _: MessageResponse = try await trpc.call(
            router: "legacy",
            procedure: "oldProcedure",
            input: SendMessageInput(conversationId: "1", body: "hello")
        )
    }
}
