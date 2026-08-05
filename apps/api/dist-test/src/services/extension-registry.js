export class ExtensionRegistry {
    extensions = new Map();
    register(ext) {
        if (this.extensions.has(ext.type)) {
            throw new Error(`Extension type already registered: ${ext.type}`);
        }
        this.extensions.set(ext.type, ext);
    }
    get(type) {
        return this.extensions.get(type);
    }
    require(type) {
        const ext = this.extensions.get(type);
        if (!ext)
            throw new Error(`Unknown application type: ${type}`);
        return ext;
    }
    list() {
        return [...this.extensions.values()].map((e) => ({
            type: e.type,
            displayName: e.displayName,
            description: e.description,
        }));
    }
}
//# sourceMappingURL=extension-registry.js.map