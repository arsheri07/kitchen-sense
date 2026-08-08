// Typed errors for the upload/vision pipeline so the route handler can
// give each failure mode its own clear, user-facing message instead of
// leaking raw upstream errors or falling through to a generic 500.

export class UnsupportedFileTypeError extends Error {
  mimeType: string;

  constructor(mimeType: string) {
    super(`Unsupported file type${mimeType ? ` (${mimeType})` : ''}. Please upload a JPEG, PNG, WEBP, or GIF photo.`);
    this.name = 'UnsupportedFileTypeError';
    this.mimeType = mimeType;
  }
}

// The upload passed the mimetype check but sharp couldn't actually decode
// it — a corrupted file, a truncated upload, or a mislabeled non-image.
export class ImageProcessingError extends Error {
  constructor(
    message = 'Could not process this image — the file may be corrupted or not a valid photo. Please try a different photo.',
  ) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

// The vision API call itself failed (network, auth, rate limit, non-2xx).
export class VisionAPIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionAPIError';
  }
}

// The vision API responded, but its content didn't parse into the
// expected shape.
export class VisionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionParseError';
  }
}
