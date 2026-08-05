export class ApiError extends Error {
    statusCode;
    code;
    constructor(statusCode, message, code) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.name = 'ApiError';
    }
    static badRequest(msg, code = 'bad_request') {
        return new ApiError(400, msg, code);
    }
    static unauthorized(msg = 'Authentication required') {
        return new ApiError(401, msg, 'unauthorized');
    }
    static forbidden(msg = 'Insufficient permissions') {
        return new ApiError(403, msg, 'forbidden');
    }
    static notFound(msg = 'Not found') {
        return new ApiError(404, msg, 'not_found');
    }
    static conflict(msg) {
        return new ApiError(409, msg, 'conflict');
    }
    static unavailable(msg) {
        return new ApiError(503, msg, 'unavailable');
    }
}
//# sourceMappingURL=errors.js.map