final class TRPCClient {
    func createTask() {
        trpc.call(router: "task", procedure: "create")
    }

    func sendMessage() {
        trpc.call(router: "messaging", procedure: "sendMessage")
    }

    func legacyCall() {
        trpc.call(router: "legacy", procedure: "oldProcedure")
    }
}
