const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const DATA_IMAGE_REGEX = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i;

export const MAX_PRODUCT_IMAGE_URL_LENGTH = 2048;
export const MAX_PRODUCT_IMAGE_UPLOAD_BYTES = 1_500_000;

function buildImageError(message, errorCode = 'INVALID_IMAGE_URL') {
    const err = new Error(message);
    err.statusCode = 400;
    err.status = 'fail';
    err.errorCode = errorCode;
    return err;
}

export function normalizeProductImageUrl(rawValue) {
    if (rawValue == null) return null;
    if (typeof rawValue !== 'string') {
        throw buildImageError('Formato de imagen invalido.');
    }

    const sanitized = rawValue.trim();
    if (!sanitized) return null;

    if (sanitized.length > MAX_PRODUCT_IMAGE_URL_LENGTH) {
        throw buildImageError('La URL de imagen excede el tamano permitido.', 'IMAGE_URL_TOO_LONG');
    }

    if (sanitized.toLowerCase().startsWith('data:image/')) {
        throw buildImageError(
            'La imagen debe cargarse mediante el endpoint de uploads. No se admiten data URL en productos.',
            'DATA_URL_NOT_ALLOWED'
        );
    }

    let parsed;
    try {
        parsed = new URL(sanitized);
    } catch {
        throw buildImageError('La URL de imagen no es valida.');
    }

    if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
        throw buildImageError('La URL de imagen debe usar http o https.');
    }

    return parsed.toString();
}

export function parseProductImageDataUrl(rawValue) {
    if (typeof rawValue !== 'string') {
        throw buildImageError('El contenido de imagen es invalido.', 'INVALID_IMAGE_UPLOAD_PAYLOAD');
    }

    const sanitized = rawValue.trim();
    const match = sanitized.match(DATA_IMAGE_REGEX);
    if (!match) {
        throw buildImageError(
            'Formato de imagen no soportado. Use PNG, JPG, WEBP o GIF en base64.',
            'INVALID_IMAGE_UPLOAD_FORMAT'
        );
    }

    const format = match[1].toLowerCase();
    const base64Payload = match[2];
    const extension = format === 'jpeg' ? 'jpg' : format;
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;

    let buffer;
    try {
        buffer = Buffer.from(base64Payload, 'base64');
    } catch {
        throw buildImageError('No se pudo decodificar la imagen.', 'INVALID_IMAGE_UPLOAD_ENCODING');
    }

    if (!buffer || buffer.length === 0) {
        throw buildImageError('La imagen esta vacia.', 'EMPTY_IMAGE_UPLOAD');
    }

    if (buffer.length > MAX_PRODUCT_IMAGE_UPLOAD_BYTES) {
        throw buildImageError('La imagen supera el limite de 1.5MB.', 'IMAGE_UPLOAD_TOO_LARGE');
    }

    return { buffer, extension, mimeType };
}

