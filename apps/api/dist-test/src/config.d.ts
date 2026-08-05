export interface ApiConfig {
    host: string;
    port: number;
    /** Master secret: cookie signing + AES key derivation for stored API keys. */
    secret: string;
    dataDir: string;
    cookieName: string;
    sessionTtlDays: number;
    trustProxy: boolean;
    devCorsOrigin: string | null;
}
export declare function loadConfig(): ApiConfig;
//# sourceMappingURL=config.d.ts.map