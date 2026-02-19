import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProductImageUrl, parseProductImageDataUrl } from '../utils/imagePolicy.js';

test('normalizeProductImageUrl accepts valid https URLs and trims spaces', () => {
    const result = normalizeProductImageUrl('  https://cdn.example.com/catalogo/pelota.jpg  ');
    assert.equal(result, 'https://cdn.example.com/catalogo/pelota.jpg');
});

test('normalizeProductImageUrl rejects non-http protocols', () => {
    assert.throws(
        () => normalizeProductImageUrl('javascript:alert(1)'),
        (error) => {
            assert.equal(error.statusCode, 400);
            return true;
        }
    );
});

test('parseProductImageDataUrl decodes valid PNG payload', () => {
    const sampleDataUrl = 'data:image/png;base64,aGVsbG8=';
    const parsed = parseProductImageDataUrl(sampleDataUrl);

    assert.equal(parsed.extension, 'png');
    assert.equal(parsed.mimeType, 'image/png');
    assert.equal(parsed.buffer.toString('utf8'), 'hello');
});

