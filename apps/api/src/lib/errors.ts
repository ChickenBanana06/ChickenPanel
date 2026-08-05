export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(msg: string, code = 'bad_request') {
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
  static conflict(msg: string) {
    return new ApiError(409, msg, 'conflict');
  }
  static unavailable(msg: string) {
    return new ApiError(503, msg, 'unavailable');
  }
}
