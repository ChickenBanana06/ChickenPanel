export declare function encryptSecret(plaintext: string, masterSecret: string): string;
export declare function decryptSecret(payload: string, masterSecret: string): string;
/** Mask an API key for display: keep first 4 and last 3 characters. */
export declare function maskSecret(value: string): string;
export declare function constantTimeEqual(a: string, b: string): boolean;
//# sourceMappingURL=crypto.d.ts.map