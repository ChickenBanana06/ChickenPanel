export declare class ApiError extends Error {
    readonly statusCode: number;
    readonly code?: string | undefined;
    constructor(statusCode: number, message: string, code?: string | undefined);
    static badRequest(msg: string, code?: string): ApiError;
    static unauthorized(msg?: string): ApiError;
    static forbidden(msg?: string): ApiError;
    static notFound(msg?: string): ApiError;
    static conflict(msg: string): ApiError;
    static unavailable(msg: string): ApiError;
}
//# sourceMappingURL=errors.d.ts.map