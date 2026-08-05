export class ToolExecutionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolExecutionError';
    }
}
export class ToolRegistry {
    tools = new Map();
    register(tool) {
        if (this.tools.has(tool.name))
            throw new Error(`Tool already registered: ${tool.name}`);
        this.tools.set(tool.name, tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    /** Tool definitions visible to a user, filtered by their permissions. */
    listFor(permissions) {
        return [...this.tools.values()].filter((t) => permissions.has(t.permission));
    }
}
//# sourceMappingURL=registry.js.map